// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  DecryptionError,
  inspectEncryptedTripletHeader,
  inspectMxf,
  MemoryRandomAccessSource,
  openTrack
} from '../../src/index.js';
import { deriveSmpteMicKey } from '../../src/asdcp/crypto.js';
import { readKlvHeader } from '../../src/mxf/klv.js';
import { NodeFileRandomAccessSource } from '../../src/node.js';

const fixtureRoot = resolve(import.meta.dirname, '../fixtures/encrypted-mxf');
const fixture = resolve(fixtureRoot, 'j2c_d57a3994-f9ba-4596-b50c-c6c21aa6651e.mxf');
const keyFile = resolve(fixtureRoot, 'j2c_d57a3994-f9ba-4596-b50c-c6c21aa6651e.key');
const expectedHash = 'aa9af588ff71a4fdf3896e8679f82ebc726874659ed1cd56a16af30e923be950';

test('SMPTE MIC-key derivation matches AS-DCP Lib 2.13.3', () => {
  const key = Uint8Array.from(
    '01852e66a9d2a2ae26c59a2e85a4ea4c'.match(/../gu),
    (byte) => Number.parseInt(byte, 16)
  );
  assert.equal(
    Buffer.from(deriveSmpteMicKey(key)).toString('hex'),
    '7a98c16cb6ca2aedbae8318d9aceb2a6'
  );
});

test('encrypted triplet headers expose a keyless plaintext source range', () => {
  const sourceKey = Uint8Array.from(
    '060e2b34010201010d01030115010801'.match(/../gu),
    (byte) => Number.parseInt(byte, 16)
  );
  const value = encryptedTripletPrefix({
    plaintextOffset: 23n,
    sourceLength: 100n,
    sourceKey,
    encryptedSourceValueLength: 96n
  });

  assert.deepEqual(
    inspectEncryptedTripletHeader(value.subarray(0, 12), { valueLength: 200n }),
    { status: 'need-more' }
  );
  const header = inspectEncryptedTripletHeader(value, { valueLength: 200n });
  assert.equal(header.status, 'parsed');
  assert.equal(header.plaintextOffset, 23n);
  assert.equal(header.sourceLength, 100n);
  assert.equal(header.sourceKey, '060e2b34010201010d01030115010801');
  assert.equal(header.plaintextValueOffset, header.encryptedSourceValueOffset + 32n);
  assert.equal(header.plaintextValueLength, 23n);
});

test('encrypted triplet header inspection rejects impossible plaintext ranges', () => {
  const value = encryptedTripletPrefix({
    plaintextOffset: 101n,
    sourceLength: 100n,
    sourceKey: new Uint8Array(16),
    encryptedSourceValueLength: 160n
  });
  assert.throws(
    () => inspectEncryptedTripletHeader(value, { valueLength: 200n }),
    (error) => error instanceof DecryptionError && error.code === 'ERR_ENCRYPTED_TRIPLET'
  );
});

test('encrypted triplet metadata can be inspected from a real frame without its key', async () => {
  const source = await NodeFileRandomAccessSource.open(fixture);
  try {
    const inspection = await inspectMxf(source, { includeIndex: true });
    const bodyPartition = inspection.structure.bodyPartitions[0];
    const headerPartition = inspection.structure.headerPartition;
    const bodyOffset = bodyPartition?.klv.endOffset ??
      headerPartition.klv.endOffset + headerPartition.headerByteCount;
    const klv = await readKlvHeader(source, bodyOffset);
    const prefix = await source.read(klv.valueOffset, 128n);
    const header = inspectEncryptedTripletHeader(prefix, { valueLength: klv.length });

    assert.equal(header.status, 'parsed');
    assert.equal(header.sourceKey, '060e2b34010201010d01030115010801');
    assert.equal(header.sourceLength, 499548n);
    assert.equal(header.plaintextOffset, 0n);
  } finally {
    await source.close();
  }
});

test('encrypted frame extraction decrypts and verifies HMAC', async () => {
  const key = (await readFile(keyFile, 'utf8')).trim();
  const source = await NodeFileRandomAccessSource.open(fixture);
  try {
    const track = await openTrack(source, { key, verifyHmac: true });
    const frame = await track.readFrame(0);
    assert.equal(frame.data.byteLength, 499548);
    assert.equal(createHash('sha256').update(frame.data).digest('hex'), expectedHash);
    assert.equal(frame.encrypted, true);
    assert.equal(frame.hmacVerified, true);
    assert.equal(frame.plaintextOffset, 0n);
    assert.equal(frame.sourceKey, '060e2b34010201010d01030115010801');

    const lastFrame = await track.readFrame(124);
    assert.deepEqual(lastFrame.data.subarray(0, 2), Uint8Array.of(0xff, 0x4f));
    assert.equal(lastFrame.hmacVerified, true);
  } finally {
    await source.close();
  }
});

test('encrypted frame extraction rejects an incorrect key', async () => {
  const source = await NodeFileRandomAccessSource.open(fixture);
  try {
    const track = await openTrack(source, {
      key: '00000000000000000000000000000000'
    });
    await assert.rejects(
      track.readFrame(0),
      (error) => error instanceof DecryptionError && error.code === 'ERR_DECRYPTION_CHECK'
    );
  } finally {
    await source.close();
  }
});

test('encrypted stereoscopic eye pairs use consecutive left and right integrity sequences', async () => {
  const key = (await readFile(keyFile, 'utf8')).trim();
  const source = await NodeFileRandomAccessSource.open(fixture);
  try {
    const inspection = await inspectMxf(source, { includeIndex: true });
    const sourceTrack = await openTrack(source, { inspection, key, verifyHmac: true });
    const first = await sourceTrack.readFrame(0);
    const second = await sourceTrack.readFrame(1);
    const firstPacket = await source.read(first.fileOffset, first.klv.totalLength);
    const secondPacket = await source.read(second.fileOffset, second.klv.totalLength);
    const pairSource = new MemoryRandomAccessSource(Uint8Array.from([
      ...firstPacket, ...secondPacket
    ]));
    const pairInspection = {
      ...inspection,
      essence: {
        ...inspection.essence,
        type: 'jpeg-2000-stereoscopic',
        editUnitCount: 1n
      },
      structure: {
        ...inspection.structure,
        headerPartition: { klv: { endOffset: 0n }, headerByteCount: 0n },
        bodyPartitions: []
      },
      footerIndex: {
        ...inspection.footerIndex,
        duration: 1n,
        entryCount: 1,
        segments: [{
          ...inspection.footerIndex.segments[0],
          indexStartPosition: 0n,
          indexDuration: 1n,
          indexEntries: [{ streamOffset: 0n }]
        }]
      }
    };
    const pairTrack = await openTrack(pairSource, {
      inspection: pairInspection,
      key,
      verifyHmac: true
    });

    const pair = await pairTrack.readStereoscopicFramePair(0);
    assert.equal(pair.left.hmacVerified, true);
    assert.equal(pair.right.hmacVerified, true);
    assert.deepEqual(pair.left.data, first.data);
    assert.deepEqual(pair.right.data, second.data);
    assert.deepEqual(
      (await pairTrack.readStereoscopicFrame(0, { eye: 'right' })).data,
      second.data
    );
  } finally {
    await source.close();
  }
});

function encryptedTripletPrefix({
  plaintextOffset,
  sourceLength,
  sourceKey,
  encryptedSourceValueLength
}) {
  return concat(
    field(new Uint8Array(16)),
    field(uint64(plaintextOffset)),
    field(sourceKey),
    field(uint64(sourceLength)),
    ber(encryptedSourceValueLength)
  );
}

function field(value) {
  return concat(ber(BigInt(value.byteLength)), value);
}

function ber(value) {
  if (value < 0x80n) return Uint8Array.of(Number(value));
  const body = [];
  while (value > 0n) {
    body.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  return Uint8Array.of(0x80 | body.length, ...body);
}

function uint64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function concat(...arrays) {
  const bytes = new Uint8Array(arrays.reduce((sum, array) => sum + array.byteLength, 0));
  let offset = 0;
  for (const array of arrays) {
    bytes.set(array, offset);
    offset += array.byteLength;
  }
  return bytes;
}

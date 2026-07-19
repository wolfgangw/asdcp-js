// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { DecryptionError, openTrack } from '../../src/index.js';
import { deriveSmpteMicKey } from '../../src/asdcp/crypto.js';
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

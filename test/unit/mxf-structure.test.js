// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRandomAccessSource } from '../../src/io/random-access-source.js';
import { readGenericStreamPartitionPayload } from '../../src/mxf/generic-stream.js';
import { readPartitionPack } from '../../src/mxf/partition.js';
import { readRandomIndexPack, RandomIndexPackError } from '../../src/mxf/random-index-pack.js';
import { openMxfStructure } from '../../src/mxf/structure.js';

const keys = {
  header: hex('060e2b34020501010d01020101020400'),
  body: hex('060e2b34020501010d01020101030400'),
  genericStream: hex('060e2b34020501010d01020101031100'),
  genericStreamData: hex('060e2b340101010c0d01050901000000'),
  footer: hex('060e2b34020501010d01020101040400'),
  rip: hex('060e2b34020501010d01020101110100')
};

test('openMxfStructure parses partitions referenced by a valid RIP', async () => {
  const file = makeMxf();
  const structure = await openMxfStructure(new MemoryRandomAccessSource(file));

  assert.equal(structure.randomIndexPack.entries.length, 3);
  assert.deepEqual(structure.randomIndexPack.entries, [
    { bodySid: 0, byteOffset: 0n },
    { bodySid: 1, byteOffset: 256n },
    { bodySid: 0, byteOffset: 512n }
  ]);
  assert.equal(structure.headerPartition.name, 'ClosedCompleteHeader');
  assert.equal(structure.bodyPartitions[0].name, 'ClosedCompleteBodyPartition');
  assert.equal(structure.footerPartition.name, 'CompleteFooter');
  assert.equal(structure.headerPartition.footerPartition, 512n);
  assert.equal(structure.issues.length, 0);
});

test('readPartitionPack preserves typed fields and essence-container ULs', async () => {
  const packet = makePartition(keys.header, { offset: 0n, footerOffset: 512n, bodySid: 0 });
  const partition = await readPartitionPack(new MemoryRandomAccessSource(packet), 0);
  assert.equal(partition.majorVersion, 1);
  assert.equal(partition.minorVersion, 2);
  assert.equal(partition.kagSize, 1);
  assert.equal(partition.headerByteCount, 4096n);
  assert.equal(partition.operationalPatternUrn, 'urn:smpte:ul:060e2b34.04010102.0d010201.10000000');
  assert.deepEqual(partition.essenceContainers.map(({ urn }) => urn), [
    'urn:smpte:ul:060e2b34.04010103.0d010301.027f0100'
  ]);
});

test('Generic Stream Partitions remain separate from frame-bearing body partitions', async () => {
  const source = new MemoryRandomAccessSource(makeMxfWithGenericStream());
  const structure = await openMxfStructure(source);

  assert.equal(structure.bodyPartitions.length, 1);
  assert.equal(structure.genericStreamPartitions.length, 1);
  assert.equal(structure.genericStreamPartitions[0].name, 'GenericStreamPartition');
  assert.equal(structure.genericStreamPartitions[0].bodySid, 10);
  assert.equal(structure.issues.length, 0);

  const payload = await readGenericStreamPartitionPayload(source, structure, 10);
  assert.deepEqual(payload.data, Uint8Array.of(0, 1, 2, 3));
  assert.equal(payload.klv.keyHex, '060e2b340101010c0d01050901000000');
});

test('RIP parsing rejects impossible sizes, wrong keys, and malformed pairs', async () => {
  await assert.rejects(
    readRandomIndexPack(new MemoryRandomAccessSource(new Uint8Array(20))),
    RandomIndexPackError
  );

  const wrongKey = makeMxf();
  wrongKey[wrongKey.length - 57] = 0x05;
  await assert.rejects(
    readRandomIndexPack(new MemoryRandomAccessSource(wrongKey)),
    /wrong key/
  );

  const malformedValue = Uint8Array.from([...keys.rip, 0x05, 0, 0, 0, 0, 22]);
  await assert.rejects(
    readRandomIndexPack(new MemoryRandomAccessSource(malformedValue)),
    /disagrees|multiple/
  );
});

test('partition discrepancies become issues rather than hiding parsed data', async () => {
  const packet = makePartition(keys.header, { offset: 99n, footerOffset: 512n, bodySid: 0 });
  const partition = await readPartitionPack(new MemoryRandomAccessSource(packet), 0);
  assert.deepEqual(partition.issues.map(({ code }) => code), [
    'mxf.partition.this-offset-mismatch'
  ]);
});

function makeMxf() {
  const header = makePartition(keys.header, { offset: 0n, footerOffset: 512n, bodySid: 0 });
  const body = makePartition(keys.body, { offset: 256n, footerOffset: 512n, bodySid: 1 });
  const footer = makePartition(keys.footer, { offset: 512n, footerOffset: 512n, bodySid: 0 });
  const rip = makeRip([
    { bodySid: 0, byteOffset: 0n },
    { bodySid: 1, byteOffset: 256n },
    { bodySid: 0, byteOffset: 512n }
  ]);
  const file = new Uint8Array(768 + rip.length);
  file.set(header, 0);
  file.set(body, 256);
  file.set(footer, 512);
  file.set(rip, 768);
  return file;
}

function makeMxfWithGenericStream() {
  const header = makePartition(keys.header, { offset: 0n, footerOffset: 768n, bodySid: 0 });
  const body = makePartition(keys.body, { offset: 256n, footerOffset: 768n, bodySid: 1 });
  const genericStream = makePartition(keys.genericStream, {
    offset: 512n,
    footerOffset: 0n,
    bodySid: 10
  });
  const genericStreamData = concat(keys.genericStreamData, ber(4), Uint8Array.of(0, 1, 2, 3));
  const footer = makePartition(keys.footer, { offset: 768n, footerOffset: 768n, bodySid: 0 });
  const rip = makeRip([
    { bodySid: 0, byteOffset: 0n },
    { bodySid: 1, byteOffset: 256n },
    { bodySid: 10, byteOffset: 512n },
    { bodySid: 0, byteOffset: 768n }
  ]);
  const file = new Uint8Array(1024 + rip.length);
  file.set(header, 0);
  file.set(body, 256);
  file.set(genericStream, 512);
  file.set(genericStreamData, 512 + genericStream.length);
  file.set(footer, 768);
  file.set(rip, 1024);
  return file;
}

function makePartition(key, { offset, footerOffset, bodySid }) {
  const value = concat(
    u16(1), u16(2), u32(1),
    u64(offset), u64(offset === 0n ? 0n : offset - 256n), u64(footerOffset),
    u64(4096n), u64(0n), u32(0), u64(0n), u32(bodySid),
    hex('060e2b34040101020d01020110000000'),
    u32(1), u32(16), hex('060e2b34040101030d010301027f0100')
  );
  return concat(key, ber(value.length), value);
}

function makeRip(entries) {
  const pairs = entries.flatMap(({ bodySid, byteOffset }) => [u32(bodySid), u64(byteOffset)]);
  const valueLength = entries.length * 12 + 4;
  const totalLength = 16 + ber(valueLength).length + valueLength;
  return concat(keys.rip, ber(valueLength), ...pairs, u32(totalLength));
}

function ber(length) {
  if (length < 0x80) return Uint8Array.of(length);
  return Uint8Array.of(0x82, length >>> 8, length & 0xff);
}

function u16(value) {
  return Uint8Array.of(value >>> 8, value & 0xff);
}

function u32(value) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function u64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function hex(value) {
  return Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
}

function concat(...parts) {
  const flat = parts.flat();
  const length = flat.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of flat) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

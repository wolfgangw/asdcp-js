// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRandomAccessSource } from '../../src/io/random-access-source.js';
import { isSmpteUniversalLabel, KlvError, readKlvHeader, readKlvValue } from '../../src/mxf/klv.js';

const key = Uint8Array.from([
  0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01,
  0x0d, 0x01, 0x02, 0x01, 0x01, 0x02, 0x04, 0x00
]);

test('readKlvHeader parses a short-form KLV and reads its value', async () => {
  const packet = Uint8Array.from([...key, 0x03, 0xaa, 0xbb, 0xcc]);
  const source = new MemoryRandomAccessSource(packet);
  const header = await readKlvHeader(source, 0);

  assert.equal(header.keyHex, '060e2b34020501010d01020101020400');
  assert.equal(header.keyUrn, 'urn:smpte:ul:060e2b34.02050101.0d010201.01020400');
  assert.equal(header.length, 3n);
  assert.equal(header.headerLength, 17n);
  assert.equal(header.valueOffset, 17n);
  assert.equal(header.endOffset, 20n);
  assert.deepEqual(await readKlvValue(source, header), Uint8Array.of(0xaa, 0xbb, 0xcc));
});

test('readKlvHeader parses a long-form 64-bit-safe length', async () => {
  const value = new Uint8Array(256);
  const packet = Uint8Array.from([...key, 0x82, 0x01, 0x00, ...value]);
  const header = await readKlvHeader(new MemoryRandomAccessSource(packet), 0);
  assert.equal(header.length, 256n);
  assert.equal(header.headerLength, 19n);
  assert.equal(header.totalLength, 275n);
});

test('readKlvHeader accepts AS-DCP fixed-width padded BER lengths', async () => {
  const value = new Uint8Array(40);
  const packet = Uint8Array.from([...key, 0x83, 0x00, 0x00, 0x28, ...value]);
  const source = new MemoryRandomAccessSource(packet);
  const header = await readKlvHeader(source, 0);
  assert.equal(header.length, 40n);
  assert.equal(header.headerLength, 20n);
  await assert.rejects(readKlvHeader(source, 0, { strictBer: true }), /leading zero/);
});

test('readKlvHeader rejects truncated headers and out-of-bounds values', async () => {
  await assert.rejects(
    readKlvHeader(new MemoryRandomAccessSource(new Uint8Array(16)), 0),
    KlvError
  );
  await assert.rejects(
    readKlvHeader(new MemoryRandomAccessSource(Uint8Array.from([...key, 0x04, 1, 2])), 0),
    /exceeds source bounds/
  );
});

test('SMPTE UL recognition requires the complete UL prefix and size', () => {
  assert.equal(isSmpteUniversalLabel(key), true);
  assert.equal(isSmpteUniversalLabel(Uint8Array.from(key, (byte, index) => index === 0 ? 0x05 : byte)), false);
  assert.equal(isSmpteUniversalLabel(key.subarray(0, 15)), false);
});

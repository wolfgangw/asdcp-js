// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRandomAccessSource } from '../../src/io/random-access-source.js';
import { readHeaderMetadata } from '../../src/mxf/header-metadata.js';
import { LocalSetError, parseLocalSet } from '../../src/mxf/local-set.js';
import { parsePrimerPack, PRIMER_PACK_KEY, PrimerPackError } from '../../src/mxf/primer.js';

const ul = Uint8Array.from({ length: 16 }, (_, index) => index + 1);

test('Primer Pack maps tags and ULs in both directions', () => {
  const primer = parsePrimerPack(Uint8Array.of(
    0, 0, 0, 1,
    0, 0, 0, 18,
    0x3c, 0x01,
    ...ul
  ));

  assert.equal(primer.count, 1);
  assert.equal(primer.itemSize, 18);
  assert.equal(primer.byTag.get(0x3c01).ulHex, '0102030405060708090a0b0c0d0e0f10');
  assert.equal(primer.byUl.get('0102030405060708090a0b0c0d0e0f10').tag, 0x3c01);
});

test('Primer Pack rejects a batch length mismatch', () => {
  assert.throws(
    () => parsePrimerPack(Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 18)),
    PrimerPackError
  );
});

test('Local Set uses fixed two-byte tag and length fields', () => {
  const primer = parsePrimerPack(Uint8Array.of(
    0, 0, 0, 1,
    0, 0, 0, 18,
    0x3c, 0x01,
    ...ul
  ));
  const localSet = parseLocalSet(Uint8Array.of(
    0x3c, 0x01, 0, 3, 0x61, 0x62, 0x63,
    0x7f, 0x01, 0, 1, 0xff
  ), primer);

  assert.equal(localSet.items.length, 2);
  assert.deepEqual(localSet.byTag.get(0x3c01).value, Uint8Array.of(0x61, 0x62, 0x63));
  assert.equal(localSet.byUl.get('0102030405060708090a0b0c0d0e0f10').tag, 0x3c01);
  assert.equal(localSet.byTag.get(0x7f01).ul, null);
});

test('Local Set rejects a value extending beyond its enclosing KLV', () => {
  assert.throws(
    () => parseLocalSet(Uint8Array.of(0x3c, 0x01, 0, 2, 0xff)),
    LocalSetError
  );
});

test('Header metadata recognizes KLV Fill with a different registry version', async () => {
  const primer = klv(fromHex(PRIMER_PACK_KEY), Uint8Array.of(
    0, 0, 0, 0,
    0, 0, 0, 18
  ));
  const fill = klv(
    fromHex('060e2b34010101010301021001000000'),
    new Uint8Array(6)
  );
  const bytes = concat(primer, fill);
  const source = new MemoryRandomAccessSource(bytes);
  const metadata = await readHeaderMetadata(source, {
    klv: { endOffset: 0n },
    headerByteCount: BigInt(bytes.byteLength)
  });

  assert.deepEqual(metadata.packets.map(({ kind }) => kind), ['primer', 'fill']);
  assert.equal(metadata.localSets.length, 0);
});

function klv(key, value) {
  assert.ok(value.byteLength < 0x80);
  return concat(key, Uint8Array.of(value.byteLength), value);
}

function concat(...values) {
  const output = new Uint8Array(values.reduce((sum, value) => sum + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function fromHex(value) {
  return Uint8Array.from(value.match(/../gu), (byte) => Number.parseInt(byte, 16));
}

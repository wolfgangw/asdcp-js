// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { IndexTableError, parseIndexTableSegmentValue } from '../../src/mxf/index-table.js';

test('IndexTableSegment decodes scalar fields and entry batches', () => {
  const value = localSet([
    [0x3c0a, new Uint8Array(16)],
    [0x3f0b, concat(i32(25), i32(1))],
    [0x3f0c, i64(0n)],
    [0x3f0d, i64(2n)],
    [0x3f05, u32(0)],
    [0x3f06, u32(129)],
    [0x3f07, u32(1)],
    [0x3f08, Uint8Array.of(0)],
    [0x3f09, concat(u32(1), u32(6), Uint8Array.of(0, 0), u32(0))],
    [0x3f0a, concat(
      u32(2), u32(11),
      Uint8Array.of(0, 0, 0x80), i64(0n),
      Uint8Array.of(0, 0, 0x80), i64(100n)
    )]
  ]);

  const segment = parseIndexTableSegmentValue(value);
  assert.deepEqual(segment.editRate, { numerator: 25, denominator: 1 });
  assert.equal(segment.indexDuration, 2n);
  assert.deepEqual(segment.deltaEntries, [{ posTableIndex: 0, slice: 0, elementData: 0 }]);
  assert.equal(segment.indexEntries[1].streamOffset, 100n);
});

test('empty index arrays accept AS-DCP count-zero/item-size-zero encoding', () => {
  const value = localSet([
    [0x3c0a, new Uint8Array(16)],
    [0x3f0b, concat(i32(24), i32(1))],
    [0x3f0c, i64(0n)],
    [0x3f0d, i64(10n)],
    [0x3f05, u32(5760)],
    [0x3f06, u32(129)],
    [0x3f07, u32(1)],
    [0x3f08, Uint8Array.of(0)],
    [0x3f09, concat(u32(0), u32(0))],
    [0x3f0a, concat(u32(0), u32(0))]
  ]);
  assert.equal(parseIndexTableSegmentValue(value).indexEntries.length, 0);
});

test('omitted index arrays and count fields use native AS-DCP defaults', () => {
  const value = localSet([
    [0x3c0a, new Uint8Array(16)],
    [0x3f0b, concat(i32(25), i32(1))],
    [0x3f0c, i64(0n)],
    [0x3f0d, i64(0n)],
    [0x3f05, u32(11540)],
    [0x3f06, u32(129)],
    [0x3f07, u32(1)],
    [0x3f09, concat(u32(1), u32(6), Uint8Array.of(0, 0), u32(0))]
  ]);
  const segment = parseIndexTableSegmentValue(value);
  assert.equal(segment.sliceCount, 0);
  assert.equal(segment.posTableCount, 0);
  assert.deepEqual(segment.indexEntries, []);
  assert.deepEqual(segment.omittedRequiredProperties, ['IndexTableSegmentBase_SliceCount']);
});

test('IndexTableSegment rejects inconsistent populated batch sizes', () => {
  const value = localSet([
    [0x3c0a, new Uint8Array(16)],
    [0x3f0b, concat(i32(25), i32(1))],
    [0x3f0c, i64(0n)],
    [0x3f0d, i64(1n)],
    [0x3f05, u32(0)],
    [0x3f06, u32(129)],
    [0x3f07, u32(1)],
    [0x3f08, Uint8Array.of(0)],
    [0x3f09, concat(u32(0), u32(0))],
    [0x3f0a, concat(u32(1), u32(10), new Uint8Array(10))]
  ]);
  assert.throws(() => parseIndexTableSegmentValue(value), IndexTableError);
});

function localSet(items) {
  return concat(...items.map(([tag, value]) => concat(
    Uint8Array.of(tag >>> 8, tag & 0xff, value.byteLength >>> 8, value.byteLength & 0xff),
    value
  )));
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

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function i32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, false);
  return bytes;
}

function i64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, false);
  return bytes;
}

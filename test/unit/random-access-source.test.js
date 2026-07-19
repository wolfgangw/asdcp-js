// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BlobRandomAccessSource,
  MemoryRandomAccessSource,
  SourceRangeError,
  validateRange
} from '../../src/io/random-access-source.js';

test('MemoryRandomAccessSource reads bounded slices as copies', async () => {
  const source = new MemoryRandomAccessSource(Uint8Array.from([0, 1, 2, 3, 4]));
  const result = await source.read(1n, 3n);
  assert.deepEqual(result, Uint8Array.from([1, 2, 3]));
  result[0] = 99;
  assert.deepEqual(await source.read(1n, 1n), Uint8Array.from([1]));
});

test('BlobRandomAccessSource accepts number and bigint ranges', async () => {
  const source = new BlobRandomAccessSource(new Blob([Uint8Array.from([5, 6, 7, 8])]));
  assert.deepEqual(await source.read(1, 2n), Uint8Array.from([6, 7]));
});

test('sources reject out-of-range and oversized reads', async () => {
  const source = new MemoryRandomAccessSource(new Uint8Array(8), { maxReadBytes: 4 });
  await assert.rejects(source.read(6, 3), SourceRangeError);
  await assert.rejects(source.read(0, 5), /configured maximum/);
  assert.throws(() => validateRange(8, -1, 1), SourceRangeError);
});

test('sources honor an already-aborted signal', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const source = new MemoryRandomAccessSource(new Uint8Array(1));
  await assert.rejects(source.read(0, 1, { signal: controller.signal }), /cancelled/);
});

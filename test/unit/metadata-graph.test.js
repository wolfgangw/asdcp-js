// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeMetadataValue, MetadataGraphError } from '../../src/mxf/metadata-graph.js';

test('metadata values decode reference batches and versions', () => {
  const uuid = Uint8Array.from({ length: 16 }, (_, index) => index);
  assert.deepEqual(
    decodeMetadataValue('strongReferenceBatch', Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 16, ...uuid)),
    ['00010203-0405-0607-0809-0a0b0c0d0e0f']
  );
  assert.deepEqual(
    decodeMetadataValue('version', Uint8Array.of(0, 2, 0, 4, 0, 10, 0x6a, 0x68, 0, 1)),
    { major: 2, minor: 4, patch: 10, build: 27240, release: 1, text: '2.4.10.27240r1' }
  );
});

test('metadata batches reject inconsistent item sizes', () => {
  assert.throws(
    () => decodeMetadataValue('strongReferenceBatch', Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 15, ...new Uint8Array(15))),
    MetadataGraphError
  );
});

// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatUl, formatUuid } from '../../src/binary/identifiers.js';

test('formatUuid produces lower-case RFC 4122 layout', () => {
  const bytes = fromHex('2ad7253b554f4eb386d3fc0e3173ff1f');
  assert.equal(formatUuid(bytes), '2ad7253b-554f-4eb3-86d3-fc0e3173ff1f');
});

test('formatUl uses AS-DCP four-byte groups', () => {
  const bytes = fromHex('060e2b340401010d0e16020203010103');
  assert.equal(formatUl(bytes), '060e2b34.0401010d.0e160202.03010103');
});

test('identifier formatters enforce 16-byte inputs', () => {
  assert.throws(() => formatUuid(new Uint8Array(15)), /16 bytes/);
  assert.throws(() => formatUl(new Uint8Array(17)), /16 bytes/);
});

function fromHex(value) {
  return Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
}

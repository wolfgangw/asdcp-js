// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { BinaryReadError, ByteReader } from '../../src/binary/byte-reader.js';

test('ByteReader reads big-endian integer primitives', () => {
  const reader = new ByteReader(Uint8Array.from([
    0x7f, 0xff,
    0x01, 0x02, 0x03, 0x04,
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08
  ]));
  assert.equal(reader.readUint16(), 0x7fff);
  assert.equal(reader.readUint32(), 0x01020304);
  assert.equal(reader.readUint64(), 0x0102030405060708n);
  assert.equal(reader.remaining, 0);
});

test('ByteReader decodes short and long BER lengths', () => {
  const reader = new ByteReader(Uint8Array.from([0x7f, 0x82, 0x01, 0x00]));
  assert.deepEqual(reader.readBerLength(), { length: 127n, encodedLength: 1 });
  assert.deepEqual(reader.readBerLength(), { length: 256n, encodedLength: 3 });
});

test('ByteReader rejects indefinite, oversized, and non-minimal BER lengths', () => {
  assert.throws(() => new ByteReader(Uint8Array.of(0x80)).readBerLength(), /Indefinite/);
  assert.throws(() => new ByteReader(Uint8Array.of(0x89)).readBerLength(), /64 bits/);
  assert.throws(() => new ByteReader(Uint8Array.of(0x81, 0x7f)).readBerLength(), /non-minimal/);
  assert.throws(() => new ByteReader(Uint8Array.of(0x82, 0x00, 0x80)).readBerLength(), /leading zero/);
});

test('ByteReader reports bounded-buffer failures', () => {
  const reader = new ByteReader(Uint8Array.of(1, 2));
  assert.throws(() => reader.readUint32(), BinaryReadError);
  assert.equal(reader.offset, 0);
});

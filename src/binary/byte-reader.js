// SPDX-License-Identifier: BSD-3-Clause

export class BinaryReadError extends RangeError {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BinaryReadError';
    this.details = details;
  }
}

export class ByteReader {
  constructor(bytes, { offset = 0 } = {}) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.byteLength) {
      throw new BinaryReadError('Invalid initial offset', { offset, size: bytes.byteLength });
    }
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  get remaining() {
    return this.bytes.byteLength - this.offset;
  }

  readUint8() {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  readInt8() {
    this.ensure(1);
    return this.view.getInt8(this.offset++);
  }

  readUint16() {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readUint32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readInt32() {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readUint64() {
    this.ensure(8);
    const value = this.view.getBigUint64(this.offset, false);
    this.offset += 8;
    return value;
  }

  readInt64() {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return value;
  }

  readBytes(length, { copy = false } = {}) {
    this.ensure(length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return copy ? value.slice() : value;
  }

  skip(length) {
    this.ensure(length);
    this.offset += length;
  }

  readBerLength({ strict = true } = {}) {
    const start = this.offset;
    const first = this.readUint8();
    if (first < 0x80) {
      return { length: BigInt(first), encodedLength: 1 };
    }

    const byteCount = first & 0x7f;
    if (byteCount === 0) {
      throw new BinaryReadError('Indefinite BER lengths are not valid for MXF KLV', { offset: start });
    }
    if (byteCount > 8) {
      throw new BinaryReadError('BER length exceeds 64 bits', { offset: start, byteCount });
    }

    const encoded = this.readBytes(byteCount);
    if (strict && encoded[0] === 0) {
      throw new BinaryReadError('BER length has a leading zero', { offset: start });
    }

    let length = 0n;
    for (const byte of encoded) length = (length << 8n) | BigInt(byte);
    if (strict && length < 0x80n) {
      throw new BinaryReadError('BER length uses non-minimal long form', { offset: start, length });
    }

    return { length, encodedLength: 1 + byteCount };
  }

  ensure(length) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TypeError('length must be a non-negative safe integer');
    }
    if (this.offset + length > this.bytes.byteLength) {
      throw new BinaryReadError('Unexpected end of buffer', {
        offset: this.offset,
        requested: length,
        remaining: this.remaining
      });
    }
  }
}

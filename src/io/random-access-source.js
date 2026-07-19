// SPDX-License-Identifier: BSD-3-Clause

const DEFAULT_MAX_READ_BYTES = 64n * 1024n * 1024n;

export class SourceRangeError extends RangeError {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SourceRangeError';
    this.details = details;
  }
}

export class BlobRandomAccessSource {
  constructor(blob, { maxReadBytes = DEFAULT_MAX_READ_BYTES, name } = {}) {
    if (!(blob instanceof Blob)) throw new TypeError('blob must be a Blob');
    this.blob = blob;
    this.name = name ?? blob.name ?? '(blob)';
    this.size = BigInt(blob.size);
    this.maxReadBytes = toNonNegativeBigInt(maxReadBytes, 'maxReadBytes');
  }

  async read(offset, length, { signal } = {}) {
    throwIfAborted(signal);
    const range = validateRange(this.size, offset, length, this.maxReadBytes);
    const buffer = await this.blob
      .slice(toSafeNumber(range.offset), toSafeNumber(range.end))
      .arrayBuffer();
    throwIfAborted(signal);
    return new Uint8Array(buffer);
  }
}

export class MemoryRandomAccessSource {
  constructor(bytes, { maxReadBytes = DEFAULT_MAX_READ_BYTES, name = '(memory)' } = {}) {
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    if (!ArrayBuffer.isView(bytes)) throw new TypeError('bytes must be an ArrayBuffer view');
    this.bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.name = name;
    this.size = BigInt(this.bytes.byteLength);
    this.maxReadBytes = toNonNegativeBigInt(maxReadBytes, 'maxReadBytes');
  }

  async read(offset, length, { signal } = {}) {
    throwIfAborted(signal);
    const range = validateRange(this.size, offset, length, this.maxReadBytes);
    return this.bytes.slice(toSafeNumber(range.offset), toSafeNumber(range.end));
  }
}

export function validateRange(size, offset, length, maxReadBytes = DEFAULT_MAX_READ_BYTES) {
  const normalizedSize = toNonNegativeBigInt(size, 'size');
  const normalizedOffset = toNonNegativeBigInt(offset, 'offset');
  const normalizedLength = toNonNegativeBigInt(length, 'length');
  const normalizedMaximum = toNonNegativeBigInt(maxReadBytes, 'maxReadBytes');
  const end = normalizedOffset + normalizedLength;

  if (normalizedLength > normalizedMaximum) {
    throw new SourceRangeError('Read exceeds configured maximum', {
      length: normalizedLength,
      maxReadBytes: normalizedMaximum
    });
  }
  if (normalizedOffset > normalizedSize || end > normalizedSize) {
    throw new SourceRangeError('Read exceeds source bounds', {
      size: normalizedSize,
      offset: normalizedOffset,
      length: normalizedLength
    });
  }

  return { offset: normalizedOffset, length: normalizedLength, end };
}

function toNonNegativeBigInt(value, name) {
  let result;
  if (typeof value === 'bigint') result = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) result = BigInt(value);
  else throw new TypeError(`${name} must be a bigint or safe integer`);
  if (result < 0n) throw new SourceRangeError(`${name} must not be negative`, { [name]: result });
  return result;
}

function toSafeNumber(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SourceRangeError('Browser Blob offset exceeds safe integer range', { value });
  }
  return Number(value);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

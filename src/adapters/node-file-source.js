// SPDX-License-Identifier: BSD-3-Clause

import { open } from 'node:fs/promises';
import { validateRange } from '../io/random-access-source.js';

const DEFAULT_MAX_READ_BYTES = 64n * 1024n * 1024n;

export class NodeFileRandomAccessSource {
  static async open(path, { maxReadBytes = DEFAULT_MAX_READ_BYTES } = {}) {
    const handle = await open(path, 'r');
    try {
      const metadata = await handle.stat({ bigint: true });
      return new NodeFileRandomAccessSource(handle, path, metadata.size, maxReadBytes);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  constructor(handle, name, size, maxReadBytes) {
    this.handle = handle;
    this.name = name;
    this.size = size;
    this.maxReadBytes = typeof maxReadBytes === 'bigint' ? maxReadBytes : BigInt(maxReadBytes);
    this.readCount = 0;
    this.totalBytesRead = 0n;
    this.closed = false;
  }

  async read(offset, length, { signal } = {}) {
    this.assertOpen();
    signal?.throwIfAborted();
    const range = validateRange(this.size, offset, length, this.maxReadBytes);
    const byteLength = toSafeNumber(range.length, 'read length');
    const start = toSafeNumber(range.offset, 'file offset');
    const buffer = new Uint8Array(byteLength);
    let completed = 0;

    while (completed < byteLength) {
      signal?.throwIfAborted();
      const { bytesRead } = await this.handle.read(
        buffer,
        completed,
        byteLength - completed,
        start + completed
      );
      if (bytesRead === 0) {
        throw new Error(`Unexpected end of file while reading ${this.name}`);
      }
      completed += bytesRead;
    }

    this.readCount += 1;
    this.totalBytesRead += range.length;
    signal?.throwIfAborted();
    return buffer;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }

  assertOpen() {
    if (this.closed) throw new Error(`File source is closed: ${this.name}`);
  }
}

function toSafeNumber(value, name) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name} exceeds the JavaScript safe integer range`);
  }
  return Number(value);
}

// SPDX-License-Identifier: BSD-3-Clause

import { ByteReader } from '../binary/byte-reader.js';
import { readKlvHeader, readKlvValue } from './klv.js';
import { RANDOM_INDEX_PACK_KEY_HEX } from './labels.js';

const MINIMUM_RIP_SIZE = 21n;
const PARTITION_PAIR_SIZE = 12;

export class RandomIndexPackError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RandomIndexPackError';
    this.details = details;
  }
}

export async function readRandomIndexPack(source, { signal } = {}) {
  assertSource(source);
  if (source.size < MINIMUM_RIP_SIZE) {
    throw new RandomIndexPackError('File is smaller than an empty Random Index Pack', {
      size: source.size
    });
  }

  const trailer = new ByteReader(await source.read(source.size - 4n, 4n, { signal }));
  const ripSize = BigInt(trailer.readUint32());
  if (ripSize < MINIMUM_RIP_SIZE) {
    throw new RandomIndexPackError('Random Index Pack size is too small', { ripSize });
  }
  if (ripSize > source.size) {
    throw new RandomIndexPackError('Random Index Pack size exceeds file size', {
      ripSize,
      fileSize: source.size
    });
  }

  const offset = source.size - ripSize;
  const klv = await readKlvHeader(source, offset, { signal });
  if (klv.keyHex !== RANDOM_INDEX_PACK_KEY_HEX) {
    throw new RandomIndexPackError('KLV at Random Index Pack offset has the wrong key', {
      offset,
      expected: RANDOM_INDEX_PACK_KEY_HEX,
      actual: klv.keyHex
    });
  }
  if (klv.totalLength !== ripSize) {
    throw new RandomIndexPackError('Random Index Pack KLV length disagrees with trailing size', {
      klvLength: klv.totalLength,
      trailingSize: ripSize
    });
  }
  if (klv.length < 4n) {
    throw new RandomIndexPackError('Random Index Pack value is shorter than its trailing size');
  }

  const value = await readKlvValue(source, klv, { signal });
  const pairBytes = value.byteLength - 4;
  if (pairBytes % PARTITION_PAIR_SIZE !== 0) {
    throw new RandomIndexPackError('Random Index Pack partition array is not a multiple of 12 bytes', {
      pairBytes
    });
  }

  const reader = new ByteReader(value);
  const entries = [];
  while (reader.remaining > 4) {
    entries.push({ bodySid: reader.readUint32(), byteOffset: reader.readUint64() });
  }
  const repeatedSize = BigInt(reader.readUint32());
  if (repeatedSize !== ripSize) {
    throw new RandomIndexPackError('Random Index Pack repeated size disagrees with trailing size', {
      repeatedSize,
      trailingSize: ripSize
    });
  }

  const issues = validateEntries(entries, offset);
  return { offset, size: ripSize, klv, entries, issues };
}

function validateEntries(entries, ripOffset) {
  const issues = [];
  if (entries.length === 0) {
    issues.push({ code: 'mxf.rip.no-partitions' });
    return issues;
  }
  if (entries[0].byteOffset !== 0n) {
    issues.push({
      code: 'mxf.rip.first-partition-not-at-zero',
      byteOffset: entries[0].byteOffset
    });
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.byteOffset >= ripOffset) {
      issues.push({
        code: 'mxf.rip.partition-offset-outside-body',
        index,
        byteOffset: entry.byteOffset,
        ripOffset
      });
    }
    if (index > 0 && entry.byteOffset <= entries[index - 1].byteOffset) {
      issues.push({
        code: 'mxf.rip.partition-offset-not-increasing',
        index,
        previous: entries[index - 1].byteOffset,
        actual: entry.byteOffset
      });
    }
  }
  return issues;
}

function assertSource(source) {
  if (!source || typeof source.read !== 'function' || typeof source.size !== 'bigint') {
    throw new TypeError('source must expose bigint size and asynchronous read(offset, length)');
  }
}

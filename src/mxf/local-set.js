// SPDX-License-Identifier: BSD-3-Clause

import { ByteReader } from '../binary/byte-reader.js';

export class LocalSetError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LocalSetError';
    this.details = details;
  }
}

export function parseLocalSet(bytes, primer = null) {
  const reader = new ByteReader(bytes);
  const items = [];
  const byTag = new Map();
  const byUl = new Map();

  while (reader.remaining > 0) {
    const itemOffset = reader.offset;
    if (reader.remaining < 4) {
      throw new LocalSetError('Local Set item header is truncated', {
        offset: itemOffset,
        remaining: reader.remaining
      });
    }
    const tag = reader.readUint16();
    const length = reader.readUint16();
    if (length > reader.remaining) {
      throw new LocalSetError('Local Set item exceeds its enclosing value', {
        offset: itemOffset,
        tag,
        length,
        remaining: reader.remaining
      });
    }
    const value = reader.readBytes(length, { copy: true });
    const primerEntry = primer?.byTag.get(tag) ?? null;
    const item = {
      offset: itemOffset,
      tag,
      length,
      ul: primerEntry?.ul ?? null,
      ulHex: primerEntry?.ulHex ?? null,
      dictionaryEntry: primerEntry?.dictionaryEntry ?? null,
      value
    };
    items.push(item);
    byTag.set(tag, item);
    if (item.ulHex) byUl.set(item.ulHex, item);
  }

  return { items, byTag, byUl };
}

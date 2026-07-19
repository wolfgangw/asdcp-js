// SPDX-License-Identifier: BSD-3-Clause

import { ByteReader } from '../binary/byte-reader.js';
import { toHex } from '../binary/identifiers.js';
import { findAllMddByUl, findMddByUl, mdd } from './dictionary.js';

export const PRIMER_PACK_KEY = mdd('Primer').ulHex;
const COMPOSITE_TAG_OVERRIDES = new Map([
  [0x3b09, mdd('OperationalPattern')],
  [0x3b0a, mdd('EssenceContainers')],
  [0x3f06, mdd('IndexSID')],
  [0x3f07, mdd('BodySID')]
]);

export class PrimerPackError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PrimerPackError';
    this.details = details;
  }
}

export function parsePrimerPack(bytes) {
  const reader = new ByteReader(bytes);
  if (reader.remaining < 8) throw new PrimerPackError('Primer Pack batch header is truncated');

  const count = reader.readUint32();
  const itemSize = reader.readUint32();
  if (itemSize < 18 && count > 0) {
    throw new PrimerPackError('Primer Pack entries are smaller than the required 18 bytes', {
      count,
      itemSize
    });
  }
  const required = BigInt(count) * BigInt(itemSize);
  if (required !== BigInt(reader.remaining)) {
    throw new PrimerPackError('Primer Pack batch size does not match its value length', {
      count,
      itemSize,
      remaining: reader.remaining
    });
  }

  const entries = [];
  const byTag = new Map();
  const byUl = new Map();
  for (let index = 0; index < count; index += 1) {
    const tag = reader.readUint16();
    const ul = reader.readBytes(16, { copy: true });
    if (itemSize > 18) reader.skip(itemSize - 18);
    const ulHex = toHex(ul);
    const matchingEntries = findAllMddByUl(ulHex);
    const interopSubDescriptors = mdd('MXFInterop_GenericDescriptor_SubDescriptors');
    const dictionaryEntry = COMPOSITE_TAG_OVERRIDES.get(tag) ??
      (ulHex === interopSubDescriptors.ulHex ? interopSubDescriptors : null) ??
      matchingEntries[0] ?? findMddByUl(ulHex);
    const entry = { tag, ul, ulHex, dictionaryEntry };
    entries.push(entry);
    byTag.set(tag, entry);
    byUl.set(entry.ulHex, entry);
  }

  return { count, itemSize, entries, byTag, byUl };
}

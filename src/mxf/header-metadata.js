// SPDX-License-Identifier: BSD-3-Clause

import { MemoryRandomAccessSource } from '../io/random-access-source.js';
import { readKlvHeader, readKlvValue, ulHexMatchesIgnoringVersion } from './klv.js';
import { parseLocalSet } from './local-set.js';
import { parsePrimerPack, PRIMER_PACK_KEY } from './primer.js';
import { findMddByUl, mdd } from './dictionary.js';

export const KLV_FILL_KEY = mdd('KLVFill').ulHex;

export class HeaderMetadataError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HeaderMetadataError';
    this.details = details;
  }
}

export async function readHeaderMetadata(source, headerPartition, { signal } = {}) {
  if (!headerPartition?.klv || typeof headerPartition.headerByteCount !== 'bigint') {
    throw new TypeError('headerPartition must be returned by readPartitionPack');
  }
  const length = headerPartition.headerByteCount;
  if (length === 0n) throw new HeaderMetadataError('Header partition declares no metadata');

  const bytes = await source.read(headerPartition.klv.endOffset, length, { signal });
  const metadataSource = new MemoryRandomAccessSource(bytes, { name: 'MXF header metadata' });
  const packets = [];
  let primer = null;
  let offset = 0n;

  while (offset < metadataSource.size) {
    const klv = await readKlvHeader(metadataSource, offset, { signal });
    const value = await readKlvValue(metadataSource, klv, { signal });
    const packet = {
      ...klv,
      fileOffset: headerPartition.klv.endOffset + offset,
      value,
      dictionaryEntry: findMddByUl(klv.keyHex),
      kind: 'local-set',
      localSet: null
    };
    if (ulHexMatchesIgnoringVersion(klv.keyHex, PRIMER_PACK_KEY)) {
      primer = parsePrimerPack(value);
      packet.kind = 'primer';
      packet.primer = primer;
    } else if (ulHexMatchesIgnoringVersion(klv.keyHex, KLV_FILL_KEY)) {
      packet.kind = 'fill';
    } else {
      if (!primer) {
        throw new HeaderMetadataError('Local Set appears before the Primer Pack', {
          offset: packet.fileOffset,
          keyHex: klv.keyHex
        });
      }
      packet.localSet = parseLocalSet(value, primer);
    }
    packets.push(packet);
    offset = klv.endOffset;
  }

  if (!primer) throw new HeaderMetadataError('Header metadata has no Primer Pack');
  return {
    offset: headerPartition.klv.endOffset,
    length,
    primer,
    packets,
    localSets: packets.filter((packet) => packet.kind === 'local-set')
  };
}

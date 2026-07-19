// SPDX-License-Identifier: BSD-3-Clause

import { mdd } from './dictionary.js';
import { readKlvHeader, readKlvValue, ulHexMatchesIgnoringVersion } from './klv.js';

const GENERIC_STREAM_DATA_ELEMENT_KEY = mdd('GenericStream_DataElement').ulHex;
const KLV_FILL_KEY = mdd('KLVFill').ulHex;

export class GenericStreamError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'GenericStreamError';
    this.details = details;
  }
}

export async function readGenericStreamPartitionPayload(source, structure, bodySid, { signal } = {}) {
  const normalizedBodySid = normalizeBodySid(bodySid);
  const matches = structure.genericStreamPartitions.filter((partition) => (
    partition.bodySid === normalizedBodySid
  ));
  if (matches.length !== 1) {
    throw new GenericStreamError(
      matches.length === 0
        ? 'MXF has no Generic Stream Partition for BodySID'
        : 'MXF has multiple Generic Stream Partitions for BodySID',
      { bodySid: normalizedBodySid, count: matches.length }
    );
  }

  const partition = matches[0];
  const partitionIndex = structure.partitions.indexOf(partition);
  const endOffset = structure.partitions[partitionIndex + 1]?.offset
    ?? structure.randomIndexPack.offset;
  let packetOffset = partition.klv.endOffset;

  while (packetOffset < endOffset) {
    const klv = await readKlvHeader(source, packetOffset, { signal });
    if (klv.endOffset > endOffset) {
      throw new GenericStreamError('Generic Stream KLV exceeds its partition bounds', {
        bodySid: normalizedBodySid,
        packetOffset,
        packetEndOffset: klv.endOffset,
        partitionEndOffset: endOffset
      });
    }
    if (ulHexMatchesIgnoringVersion(klv.keyHex, KLV_FILL_KEY)) {
      packetOffset = klv.endOffset;
      continue;
    }
    if (!ulHexMatchesIgnoringVersion(klv.keyHex, GENERIC_STREAM_DATA_ELEMENT_KEY)) {
      throw new GenericStreamError('Unexpected KLV in Generic Stream Partition', {
        bodySid: normalizedBodySid,
        packetOffset,
        keyHex: klv.keyHex
      });
    }
    return {
      bodySid: normalizedBodySid,
      partition,
      klv,
      data: await readKlvValue(source, klv, { signal })
    };
  }

  throw new GenericStreamError('Generic Stream Partition has no data element', {
    bodySid: normalizedBodySid,
    partitionOffset: partition.offset
  });
}

function normalizeBodySid(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) {
    throw new TypeError('BodySID must be a positive 32-bit integer');
  }
  return value;
}

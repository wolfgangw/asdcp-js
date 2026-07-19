// SPDX-License-Identifier: BSD-3-Clause

import { ByteReader } from '../binary/byte-reader.js';
import { formatUuid } from '../binary/identifiers.js';
import { mdd } from './dictionary.js';
import { readKlvHeader, readKlvValue, ulHexMatchesIgnoringVersion } from './klv.js';
import { parseLocalSet } from './local-set.js';

const INDEX_TABLE_SEGMENT_KEY = mdd('IndexTableSegment').ulHex;
const KLV_FILL_KEY = mdd('KLVFill').ulHex;
const TAGS = {
  instanceUid: mdd('InterchangeObject_InstanceUID').tag,
  editRate: mdd('IndexTableSegmentBase_IndexEditRate').tag,
  startPosition: mdd('IndexTableSegmentBase_IndexStartPosition').tag,
  duration: mdd('IndexTableSegmentBase_IndexDuration').tag,
  editUnitByteCount: mdd('IndexTableSegmentBase_EditUnitByteCount').tag,
  indexSid: mdd('IndexTableSegmentBase_IndexSID').tag,
  bodySid: mdd('IndexTableSegmentBase_BodySID').tag,
  sliceCount: mdd('IndexTableSegmentBase_SliceCount').tag,
  posTableCount: mdd('IndexTableSegmentBase_PosTableCount').tag,
  deltaEntries: mdd('IndexTableSegment_DeltaEntryArray').tag,
  indexEntries: mdd('IndexTableSegment_IndexEntryArray').tag
};

export class IndexTableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IndexTableError';
    this.details = details;
  }
}

export async function readFooterIndex(source, footerPartition, { signal } = {}) {
  if (!footerPartition?.klv || typeof footerPartition.indexByteCount !== 'bigint') {
    throw new TypeError('footerPartition must be returned by readPartitionPack');
  }
  const offset = footerPartition.klv.endOffset;
  const endOffset = offset + footerPartition.indexByteCount;
  const segments = [];
  const issues = [];
  let packetOffset = offset;

  while (packetOffset < endOffset) {
    const klv = await readKlvHeader(source, packetOffset, { signal });
    if (klv.endOffset > endOffset) {
      throw new IndexTableError('Footer index KLV exceeds declared IndexByteCount', {
        packetOffset,
        packetEndOffset: klv.endOffset,
        endOffset
      });
    }
    if (ulHexMatchesIgnoringVersion(klv.keyHex, KLV_FILL_KEY)) {
      packetOffset = klv.endOffset;
      continue;
    }
    if (!ulHexMatchesIgnoringVersion(klv.keyHex, INDEX_TABLE_SEGMENT_KEY)) {
      throw new IndexTableError('Unexpected KLV in footer index region', {
        packetOffset,
        keyHex: klv.keyHex
      });
    }
    const value = await readKlvValue(source, klv, { signal });
    const segment = parseIndexTableSegmentValue(value, { klv, offset: packetOffset });
    const segmentIndex = segments.length;
    segments.push(segment);
    for (const property of segment.omittedRequiredProperties) {
      issues.push({
        code: 'mxf.index.required-property-missing',
        segmentIndex,
        property,
        assumedValue: 0
      });
    }
    packetOffset = klv.endOffset;
  }

  for (let index = 1; index < segments.length; index += 1) {
    const expected = segments[index - 1].indexStartPosition + segments[index - 1].indexDuration;
    if (segments[index].indexStartPosition !== expected) {
      issues.push({
        code: 'mxf.index.start-position-discontinuity',
        segmentIndex: index,
        expected,
        actual: segments[index].indexStartPosition
      });
    }
  }

  return {
    offset,
    length: footerPartition.indexByteCount,
    endOffset,
    segments,
    duration: segments.reduce((sum, segment) => sum + segment.indexDuration, 0n),
    entryCount: segments.reduce((sum, segment) => sum + segment.indexEntries.length, 0),
    issues
  };
}

export function parseIndexTableSegmentValue(bytes, context = {}) {
  const localSet = parseLocalSet(bytes);
  const editRate = readRational(required(localSet, TAGS.editRate, 'IndexEditRate').value);
  const indexStartPosition = readInt64(required(localSet, TAGS.startPosition, 'IndexStartPosition').value);
  const indexDuration = readInt64(required(localSet, TAGS.duration, 'IndexDuration').value);
  const editUnitByteCount = readUint32(required(localSet, TAGS.editUnitByteCount, 'EditUnitByteCount').value);
  const indexSid = readUint32(required(localSet, TAGS.indexSid, 'IndexSID').value);
  const bodySid = readUint32(required(localSet, TAGS.bodySid, 'BodySID').value);
  const sliceCount = localSet.byTag.has(TAGS.sliceCount)
    ? readUint8(localSet.byTag.get(TAGS.sliceCount).value) : 0;
  const posTableCount = localSet.byTag.has(TAGS.posTableCount)
    ? readUint8(localSet.byTag.get(TAGS.posTableCount).value) : 0;
  const deltaEntries = localSet.byTag.has(TAGS.deltaEntries)
    ? readDeltaEntryBatch(localSet.byTag.get(TAGS.deltaEntries).value) : [];
  const indexEntries = localSet.byTag.has(TAGS.indexEntries)
    ? readIndexEntryBatch(localSet.byTag.get(TAGS.indexEntries).value) : [];

  if (indexEntries.length > 0 && BigInt(indexEntries.length) !== indexDuration) {
    throw new IndexTableError('IndexEntryArray count differs from IndexDuration', {
      count: indexEntries.length,
      indexDuration,
      ...context
    });
  }
  return {
    ...context,
    localSet,
    instanceUid: formatUuid(required(localSet, TAGS.instanceUid, 'InstanceUID').value),
    editRate,
    indexStartPosition,
    indexDuration,
    editUnitByteCount,
    indexSid,
    bodySid,
    sliceCount,
    posTableCount,
    omittedRequiredProperties: localSet.byTag.has(TAGS.sliceCount)
      ? [] : ['IndexTableSegmentBase_SliceCount'],
    deltaEntries,
    indexEntries
  };
}

function readDeltaEntryBatch(bytes) {
  return readBatch(bytes, 6, (reader) => ({
    posTableIndex: reader.readInt8(),
    slice: reader.readUint8(),
    elementData: reader.readUint32()
  }), 'DeltaEntryArray', { allowLargerItems: false });
}

function readIndexEntryBatch(bytes) {
  return readBatch(bytes, 11, (reader) => ({
    temporalOffset: reader.readInt8(),
    keyFrameOffset: reader.readInt8(),
    flags: reader.readUint8(),
    streamOffset: reader.readUint64()
  }), 'IndexEntryArray', { allowLargerItems: true });
}

function readBatch(bytes, decodedItemSize, decode, name, { allowLargerItems }) {
  const reader = new ByteReader(bytes);
  if (reader.remaining < 8) throw new IndexTableError(`${name} batch header is truncated`);
  const count = reader.readUint32();
  const itemSize = reader.readUint32();
  if (count > 0 && ((allowLargerItems && itemSize < decodedItemSize) ||
      (!allowLargerItems && itemSize !== decodedItemSize))) {
    throw new IndexTableError(`${name} has an unsupported item size`, { itemSize, decodedItemSize });
  }
  if (BigInt(count) * BigInt(itemSize) !== BigInt(reader.remaining)) {
    throw new IndexTableError(`${name} batch size does not match its value length`, {
      count,
      itemSize,
      remaining: reader.remaining
    });
  }
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    entries.push(decode(reader));
    if (itemSize > decodedItemSize) reader.skip(itemSize - decodedItemSize);
  }
  return entries;
}

function required(localSet, tag, name) {
  const item = localSet.byTag.get(tag);
  if (!item) throw new IndexTableError(`IndexTableSegment has no ${name}`);
  return item;
}

function readRational(bytes) {
  if (bytes.byteLength !== 8) throw new IndexTableError('Rational value is not 8 bytes');
  const reader = new ByteReader(bytes);
  return { numerator: reader.readInt32(), denominator: reader.readInt32() };
}

function readInt64(bytes) {
  if (bytes.byteLength !== 8) throw new IndexTableError('64-bit value is not 8 bytes');
  return new ByteReader(bytes).readInt64();
}

function readUint32(bytes) {
  if (bytes.byteLength !== 4) throw new IndexTableError('32-bit value is not 4 bytes');
  return new ByteReader(bytes).readUint32();
}

function readUint8(bytes) {
  if (bytes.byteLength !== 1) throw new IndexTableError('8-bit value is not 1 byte');
  return bytes[0];
}

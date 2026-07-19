// SPDX-License-Identifier: BSD-3-Clause

import { ByteReader } from '../binary/byte-reader.js';
import { formatUl } from '../binary/identifiers.js';
import { readKlvHeader, readKlvValue } from './klv.js';
import { partitionKindForKeyHex } from './labels.js';

const MINIMUM_PARTITION_VALUE_LENGTH = 88n;
const UL_LENGTH = 16;

export class PartitionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PartitionError';
    this.details = details;
  }
}

export async function readPartitionPack(source, offset, { signal } = {}) {
  const header = await readKlvHeader(source, offset, { signal });
  const classification = partitionKindForKeyHex(header.keyHex);
  if (!classification) {
    throw new PartitionError('KLV key is not an MXF Partition Pack', {
      offset: header.valueOffset - header.headerLength,
      keyHex: header.keyHex
    });
  }
  if (header.length < MINIMUM_PARTITION_VALUE_LENGTH) {
    throw new PartitionError('MXF Partition Pack value is too short', {
      length: header.length,
      minimum: MINIMUM_PARTITION_VALUE_LENGTH
    });
  }

  const value = await readKlvValue(source, header, { signal });
  const reader = new ByteReader(value);
  const partition = {
    ...classification,
    offset: header.valueOffset - header.headerLength,
    key: header.key,
    klv: header,
    majorVersion: reader.readUint16(),
    minorVersion: reader.readUint16(),
    kagSize: reader.readUint32(),
    thisPartition: reader.readUint64(),
    previousPartition: reader.readUint64(),
    footerPartition: reader.readUint64(),
    headerByteCount: reader.readUint64(),
    indexByteCount: reader.readUint64(),
    indexSid: reader.readUint32(),
    bodyOffset: reader.readUint64(),
    bodySid: reader.readUint32()
  };

  partition.operationalPattern = reader.readBytes(UL_LENGTH, { copy: true });
  partition.operationalPatternUrn = `urn:smpte:ul:${formatUl(partition.operationalPattern)}`;
  partition.essenceContainers = readUlBatch(reader);
  partition.trailingByteCount = reader.remaining;
  partition.issues = validatePartition(partition);
  return partition;
}

function readUlBatch(reader) {
  const count = reader.readUint32();
  const itemLength = reader.readUint32();
  if (itemLength !== UL_LENGTH) {
    throw new PartitionError('Partition essence-container batch item length is not 16', {
      count,
      itemLength
    });
  }
  if (count > Math.floor(reader.remaining / itemLength)) {
    throw new PartitionError('Partition essence-container batch exceeds KLV value', {
      count,
      itemLength,
      remaining: reader.remaining
    });
  }

  const values = [];
  for (let index = 0; index < count; index += 1) {
    const value = reader.readBytes(UL_LENGTH, { copy: true });
    values.push({ bytes: value, urn: `urn:smpte:ul:${formatUl(value)}` });
  }
  return values;
}

function validatePartition(partition) {
  const issues = [];
  if (partition.thisPartition !== partition.offset) {
    issues.push({
      code: 'mxf.partition.this-offset-mismatch',
      expected: partition.offset,
      actual: partition.thisPartition
    });
  }
  if (partition.kagSize === 0) {
    issues.push({ code: 'mxf.partition.zero-kag-size' });
  }
  if (partition.trailingByteCount > 0) {
    issues.push({
      code: 'mxf.partition.trailing-value-bytes',
      count: partition.trailingByteCount
    });
  }
  return issues;
}

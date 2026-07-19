// SPDX-License-Identifier: BSD-3-Clause

import { BinaryReadError, ByteReader } from '../binary/byte-reader.js';
import { formatUl, toHex } from '../binary/identifiers.js';

const SMPTE_UL_PREFIX = Uint8Array.of(0x06, 0x0e, 0x2b, 0x34);
const MAX_KL_BYTES = 25n;

export class KlvError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'KlvError';
    this.details = details;
  }
}

export async function readKlvHeader(source, offset, { signal, strictBer = false } = {}) {
  assertSource(source);
  const normalizedOffset = toOffset(offset);
  const remaining = source.size - normalizedOffset;
  if (remaining < 17n) {
    throw new KlvError('Insufficient bytes for a KLV header', {
      offset: normalizedOffset,
      remaining
    });
  }

  const probeLength = remaining < MAX_KL_BYTES ? remaining : MAX_KL_BYTES;
  const probe = await source.read(normalizedOffset, probeLength, { signal });
  const reader = new ByteReader(probe);
  const key = reader.readBytes(16, { copy: true });

  let ber;
  try {
    ber = reader.readBerLength({ strict: strictBer });
  } catch (error) {
    if (!(error instanceof BinaryReadError)) throw error;
    throw new KlvError(`Invalid KLV BER length: ${error.message}`, {
      offset: normalizedOffset + 16n,
      cause: error
    });
  }

  const headerLength = 16n + BigInt(ber.encodedLength);
  const valueOffset = normalizedOffset + headerLength;
  const endOffset = valueOffset + ber.length;
  if (endOffset > source.size) {
    throw new KlvError('KLV value exceeds source bounds', {
      offset: normalizedOffset,
      valueOffset,
      valueLength: ber.length,
      sourceSize: source.size
    });
  }

  return {
    key,
    keyHex: toHex(key),
    keyUrn: isSmpteUniversalLabel(key) ? `urn:smpte:ul:${formatUl(key)}` : null,
    length: ber.length,
    headerLength,
    valueOffset,
    endOffset,
    totalLength: headerLength + ber.length
  };
}

export async function readKlvValue(source, header, { signal } = {}) {
  if (!header || typeof header.valueOffset !== 'bigint' || typeof header.length !== 'bigint') {
    throw new TypeError('header must be returned by readKlvHeader');
  }
  return source.read(header.valueOffset, header.length, { signal });
}

export function isSmpteUniversalLabel(key) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 16) return false;
  return SMPTE_UL_PREFIX.every((byte, index) => key[index] === byte);
}

export function ulHexMatchesIgnoringVersion(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  if (actual.length !== 32 || expected.length !== 32) return false;
  return actual.slice(0, 14) === expected.slice(0, 14)
    && actual.slice(16) === expected.slice(16);
}

function assertSource(source) {
  if (!source || typeof source.read !== 'function' || typeof source.size !== 'bigint') {
    throw new TypeError('source must expose bigint size and asynchronous read(offset, length)');
  }
}

function toOffset(value) {
  let offset;
  if (typeof value === 'bigint') offset = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) offset = BigInt(value);
  else throw new TypeError('offset must be a bigint or safe integer');
  if (offset < 0n) throw new KlvError('KLV offset must not be negative', { offset });
  return offset;
}

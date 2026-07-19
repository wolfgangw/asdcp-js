// SPDX-License-Identifier: BSD-3-Clause

export function formatUuid(bytes) {
  assertLength(bytes, 16, 'UUID');
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatUl(bytes) {
  assertLength(bytes, 16, 'UL');
  const hex = toHex(bytes);
  return [0, 8, 16, 24].map((offset) => hex.slice(offset, offset + 8)).join('.');
}

export function toHex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertLength(bytes, expected, type) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`${type} must be a Uint8Array`);
  if (bytes.byteLength !== expected) {
    throw new RangeError(`${type} must contain ${expected} bytes`);
  }
}

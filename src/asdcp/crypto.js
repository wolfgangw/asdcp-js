// SPDX-License-Identifier: BSD-3-Clause

import { ByteReader } from '../binary/byte-reader.js';
import { DecryptionError } from '../errors.js';

const AES_BLOCK_SIZE = 16;
const HMAC_SIZE = 20;
const CHECK_VALUE = new TextEncoder().encode('CHUKCHUKCHUKCHUK');
const INTEROP_KEY_NONCE = Uint8Array.from(
  { length: 16 },
  (_, index) => index * 0x11
);

export function normalizeDecryptionKey(key) {
  let bytes;
  if (typeof key === 'string') {
    if (!/^[0-9a-f]{32}$/iu.test(key)) {
      throw new TypeError('key must be a 32-character hexadecimal string or 16-byte Uint8Array');
    }
    bytes = Uint8Array.from(key.match(/../gu), (byte) => Number.parseInt(byte, 16));
  } else if (key instanceof Uint8Array) {
    bytes = key;
  } else {
    throw new TypeError('key must be a 32-character hexadecimal string or 16-byte Uint8Array');
  }
  if (bytes.byteLength !== AES_BLOCK_SIZE) {
    throw new RangeError('key must contain exactly 16 bytes');
  }
  return bytes.slice();
}

export async function decryptFrameTriplet(value, {
  key,
  contextId,
  sourceKeyPrefix,
  sourceLengthLimit,
  assetUuid,
  frameNumber,
  labelSetType,
  usesHmac,
  verifyHmac,
  signal
}) {
  signal?.throwIfAborted();
  const triplet = parseEncryptedTriplet(value, {
    contextId,
    sourceKeyPrefix,
    sourceLengthLimit,
    assetUuid,
    frameNumber,
    usesHmac
  });

  const data = await decryptEncryptedSourceValue(triplet, key);
  if (verifyHmac && usesHmac) {
    await verifyIntegrityPack(triplet, key, labelSetType);
  }
  signal?.throwIfAborted();
  return {
    data,
    hmacVerified: verifyHmac && usesHmac ? true : null,
    sourceKey: bytesToHex(triplet.sourceKey),
    plaintextOffset: triplet.plaintextOffset
  };
}

function parseEncryptedTriplet(value, expected) {
  try {
    const reader = new ByteReader(value);
    const contextId = readField(reader, 'ContextID', 16).value;
    const plaintextOffset = readUint64Field(reader, 'PlaintextOffset');
    const sourceKey = readField(reader, 'SourceKey', 16).value;
    const sourceLength = readUint64Field(reader, 'SourceLength');
    const esv = readField(reader, 'EncryptedSourceValue');
    const authenticatedStart = esv.valueOffset;

    if (bytesToHex(contextId) !== uuidToHex(expected.contextId)) {
      throw formatError('Encrypted triplet ContextID does not match the MXF header');
    }
    if (!ulMatchesPrefix(sourceKey, expected.sourceKeyPrefix)) {
      throw formatError('Encrypted triplet SourceKey does not match the track essence', {
        actualSourceKey: bytesToHex(sourceKey),
        expectedSourceKeyPrefix: expected.sourceKeyPrefix
      });
    }
    if (sourceLength > BigInt(Number.MAX_SAFE_INTEGER) || plaintextOffset > sourceLength) {
      throw formatError('Encrypted triplet has an invalid source length or plaintext offset', {
        sourceLength,
        plaintextOffset
      });
    }
    if (expected.sourceLengthLimit !== null && sourceLength > expected.sourceLengthLimit) {
      throw formatError('Encrypted triplet source length exceeds the configured read limit', {
        sourceLength,
        sourceLengthLimit: expected.sourceLengthLimit
      });
    }

    let integrity = null;
    if (expected.usesHmac) {
      const trackFileId = readField(reader, 'TrackFileID', 16).value;
      const sequenceNumber = readUint64Field(reader, 'SequenceNumber');
      const hmac = readField(reader, 'HMAC', HMAC_SIZE);
      integrity = {
        trackFileId,
        sequenceNumber,
        hmac: hmac.value,
        authenticatedBytes: value.subarray(authenticatedStart, hmac.valueOffset)
      };
      if (bytesToHex(trackFileId) !== uuidToHex(expected.assetUuid)) {
        throw new DecryptionError('Encrypted frame integrity pack AssetUUID does not match the MXF header', {
          frameNumber: expected.frameNumber
        }, { code: 'ERR_HMAC_METADATA' });
      }
      const expectedSequence = BigInt(expected.frameNumber) + 1n;
      if (sequenceNumber !== expectedSequence) {
        throw new DecryptionError('Encrypted frame integrity pack has an unexpected sequence number', {
          frameNumber: expected.frameNumber,
          expectedSequence,
          actualSequence: sequenceNumber
        }, { code: 'ERR_HMAC_METADATA' });
      }
    } else {
      for (const name of ['TrackFileID', 'SequenceNumber', 'HMAC']) {
        const field = readField(reader, name);
        if (field.value.byteLength !== 0) {
          throw formatError(`Encrypted triplet has unexpected ${name} data without HMAC`);
        }
      }
    }
    if (reader.remaining !== 0) {
      throw formatError('Encrypted triplet has trailing data', { remaining: reader.remaining });
    }

    return {
      contextId,
      plaintextOffset,
      sourceKey,
      sourceLength,
      esv: esv.value,
      integrity,
      frameNumber: expected.frameNumber
    };
  } catch (error) {
    if (error instanceof DecryptionError) throw error;
    throw formatError(`Could not parse encrypted triplet: ${error.message}`, {}, error);
  }
}

async function decryptEncryptedSourceValue(triplet, keyBytes) {
  const sourceLength = Number(triplet.sourceLength);
  const plaintextOffset = Number(triplet.plaintextOffset);
  const cipherSourceLength = sourceLength - plaintextOffset;
  const remainder = cipherSourceLength % AES_BLOCK_SIZE;
  const wholeBlockLength = cipherSourceLength - remainder;
  const expectedEsvLength = plaintextOffset + wholeBlockLength + AES_BLOCK_SIZE * 3;
  if (wholeBlockLength === 0 || triplet.esv.byteLength !== expectedEsvLength) {
    throw formatError('Encrypted source value length is inconsistent with SourceLength and PlaintextOffset', {
      expected: expectedEsvLength,
      actual: triplet.esv.byteLength,
      sourceLength,
      plaintextOffset
    });
  }

  const iv = triplet.esv.subarray(0, AES_BLOCK_SIZE);
  const encryptedCheck = triplet.esv.subarray(AES_BLOCK_SIZE, AES_BLOCK_SIZE * 2);
  const plaintext = triplet.esv.subarray(
    AES_BLOCK_SIZE * 2,
    AES_BLOCK_SIZE * 2 + plaintextOffset
  );
  const encryptedEssence = triplet.esv.subarray(AES_BLOCK_SIZE * 2 + plaintextOffset);
  const ciphertext = concatBytes(encryptedCheck, encryptedEssence);
  const decrypted = await decryptAesCbcWithoutPadding(ciphertext, keyBytes, iv);

  if (!equalBytes(decrypted.subarray(0, AES_BLOCK_SIZE), CHECK_VALUE)) {
    throw new DecryptionError('Encrypted frame check value does not match; the key is incorrect or data is corrupt', {
      frameNumber: triplet.frameNumber
    }, { code: 'ERR_DECRYPTION_CHECK' });
  }
  const finalBlockOffset = AES_BLOCK_SIZE + wholeBlockLength;
  if (decrypted[finalBlockOffset + remainder] !== 0) {
    throw formatError('Encrypted frame has invalid AS-DCP padding', {
      frameNumber: triplet.frameNumber
    });
  }

  const output = new Uint8Array(sourceLength);
  output.set(plaintext);
  output.set(
    decrypted.subarray(AES_BLOCK_SIZE, AES_BLOCK_SIZE + cipherSourceLength),
    plaintextOffset
  );
  return output;
}

async function decryptAesCbcWithoutPadding(ciphertext, keyBytes, iv) {
  const subtle = requireSubtleCrypto();
  const key = await subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt', 'decrypt']);

  // Web Crypto always removes PKCS#7 padding. Append a block which decrypts to
  // a full padding block so the preceding AS-DCP custom-padded blocks survive.
  const finalCipherBlock = ciphertext.subarray(ciphertext.byteLength - AES_BLOCK_SIZE);
  const paddingInput = Uint8Array.from(finalCipherBlock, (byte) => byte ^ AES_BLOCK_SIZE);
  const encryptedPadding = new Uint8Array(await subtle.encrypt({
    name: 'AES-CBC',
    iv: new Uint8Array(AES_BLOCK_SIZE)
  }, key, paddingInput)).subarray(0, AES_BLOCK_SIZE);
  const paddedCiphertext = concatBytes(ciphertext, encryptedPadding);
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, key, paddedCiphertext));
  } catch (cause) {
    throw new DecryptionError('AES-CBC decryption failed', {}, {
      code: 'ERR_DECRYPTION',
      cause
    });
  }
}

async function verifyIntegrityPack(triplet, keyBytes, labelSetType) {
  const subtle = requireSubtleCrypto();
  const micKey = labelSetType === 'MXF Interop'
    ? await deriveInteropMicKey(keyBytes)
    : labelSetType === 'SMPTE'
      ? deriveSmpteMicKey(keyBytes)
      : null;
  if (!micKey) {
    throw new DecryptionError('Cannot derive an HMAC key for an unknown MXF label set', {
      labelSetType
    }, { code: 'ERR_HMAC_UNSUPPORTED' });
  }
  const key = await subtle.importKey('raw', micKey, {
    name: 'HMAC',
    hash: 'SHA-1'
  }, false, ['verify']);
  const valid = await subtle.verify('HMAC', key, triplet.integrity.hmac, triplet.integrity.authenticatedBytes);
  if (!valid) {
    throw new DecryptionError('Encrypted frame HMAC verification failed', {
      frameNumber: triplet.frameNumber
    }, { code: 'ERR_HMAC_VERIFICATION' });
  }
}

async function deriveInteropMicKey(keyBytes) {
  const input = concatBytes(keyBytes, INTEROP_KEY_NONCE);
  const digest = new Uint8Array(await requireSubtleCrypto().digest('SHA-1', input));
  return digest.subarray(0, 16);
}

export function deriveSmpteMicKey(keyBytes) {
  const xkey = new Uint8Array(64);
  xkey.set(keyBytes);
  const first = sha1Compression(xkey);
  const modulus = 1n << 160n;
  const next = (bytesToBigInt(xkey.subarray(0, 20)) + 1n + bytesToBigInt(first)) % modulus;
  xkey.fill(0);
  xkey.set(bigIntToBytes(next, 20));
  return sha1Compression(xkey).subarray(0, 16);
}

function sha1Compression(block) {
  const words = new Uint32Array(80);
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(index * 4, false);
  for (let index = 16; index < 80; index += 1) {
    words[index] = rotateLeft(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1);
  }
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  let e = 0xc3d2e1f0;
  for (let index = 0; index < 80; index += 1) {
    let f;
    let k;
    if (index < 20) {
      f = (b & c) | (~b & d);
      k = 0x5a827999;
    } else if (index < 40) {
      f = b ^ c ^ d;
      k = 0x6ed9eba1;
    } else if (index < 60) {
      f = (b & c) | (b & d) | (c & d);
      k = 0x8f1bbcdc;
    } else {
      f = b ^ c ^ d;
      k = 0xca62c1d6;
    }
    const temp = (rotateLeft(a, 5) + f + e + k + words[index]) >>> 0;
    e = d;
    d = c;
    c = rotateLeft(b, 30);
    b = a;
    a = temp;
  }
  const result = new Uint8Array(20);
  const resultView = new DataView(result.buffer);
  for (const [index, value] of [a + 0x67452301, b + 0xefcdab89, c + 0x98badcfe,
    d + 0x10325476, e + 0xc3d2e1f0].entries()) {
    resultView.setUint32(index * 4, value >>> 0, false);
  }
  return result;
}

function readField(reader, name, expectedLength) {
  const length = reader.readBerLength({ strict: false }).length;
  if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw formatError(`${name} length exceeds the JavaScript safe integer range`, { length });
  }
  if (expectedLength !== undefined && length !== BigInt(expectedLength)) {
    throw formatError(`${name} has length ${length}, expected ${expectedLength}`);
  }
  const valueOffset = reader.offset;
  return { value: reader.readBytes(Number(length)), valueOffset };
}

function readUint64Field(reader, name) {
  const field = readField(reader, name, 8);
  return new DataView(field.value.buffer, field.value.byteOffset, 8).getBigUint64(0, false);
}

function formatError(message, details = {}, cause) {
  return new DecryptionError(message, details, {
    code: 'ERR_ENCRYPTED_TRIPLET',
    cause
  });
}

function requireSubtleCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new DecryptionError('Web Crypto SubtleCrypto is not available', {}, {
      code: 'ERR_CRYPTO_UNAVAILABLE'
    });
  }
  return globalThis.crypto.subtle;
}

function ulMatchesPrefix(bytes, prefix) {
  const actual = bytesToHex(bytes);
  return actual.length === 32 && prefix.length === 30
    && actual.slice(0, 14) === prefix.slice(0, 14)
    && actual.slice(16, 30) === prefix.slice(16);
}

function uuidToHex(uuid) {
  return typeof uuid === 'string' ? uuid.replaceAll('-', '').toLowerCase() : '';
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function concatBytes(...values) {
  const result = new Uint8Array(values.reduce((length, value) => length + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function equalBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToBytes(value, length) {
  const bytes = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

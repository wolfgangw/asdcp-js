// SPDX-License-Identifier: BSD-3-Clause

import { inspectMxf } from './inspect.js';
import { decryptFrameTriplet, normalizeDecryptionKey } from './crypto.js';
import { TrackReaderError } from '../errors.js';
export { TrackReaderError } from '../errors.js';
import { mdd } from '../mxf/dictionary.js';
import { MemoryRandomAccessSource } from '../io/random-access-source.js';
import { readKlvHeader, readKlvValue } from '../mxf/klv.js';
import { readGenericStreamPartitionPayload } from '../mxf/generic-stream.js';

const ESSENCE_FORMATS = new Map([
  ['jpeg-2000', essenceFormat('JPEG2000Essence', 'image/j2c', 'j2c')],
  ['jpeg-2000-stereoscopic', essenceFormat('JPEG2000Essence', 'image/j2c', 'j2c')],
  ['pcm', essenceFormat('WAVEssence', 'audio/L24', null)],
  ['mpeg-2', essenceFormat('MPEG2Essence', 'video/mpeg', 'm2v')],
  ['timed-text', essenceFormat('TimedTextEssence', 'application/xml', 'xml')],
  ['d-cinema-generic-data', essenceFormat('DCDataEssence', 'application/octet-stream', 'dcdata')],
  ['dolby-atmos', essenceFormat('PrivateDCDataEssence', 'application/octet-stream', 'atmos')]
]);
const CRYPT_ESSENCE_KEY_PREFIX = mdd('CryptEssence').ulHex.slice(0, 30);

export async function openTrack(source, {
  signal,
  inspection,
  key,
  verifyHmac = false
} = {}) {
  if (typeof verifyHmac !== 'boolean') throw new TypeError('verifyHmac must be a boolean');
  const inspected = inspection ?? await inspectMxf(source, { signal, includeIndex: true });
  if (!inspected.footerIndex) throw new TrackReaderError('MXF has no parsed footer index');
  const format = ESSENCE_FORMATS.get(inspected.essence.type);
  if (!format) {
    throw new TrackReaderError(`Unsupported essence type: ${inspected.essence.type}`, {
      essenceType: inspected.essence.type
    });
  }
  const decryptionKey = key === undefined ? null : normalizeDecryptionKey(key);
  if (inspected.writerInfo.encryptedEssence && !decryptionKey) {
    throw new TrackReaderError('Encrypted essence requires a decryption key', {}, {
      code: 'ERR_ENCRYPTION_KEY_REQUIRED'
    });
  }
  const bodyOffset = essenceBodyOffset(inspected.structure);
  return new TrackReader(source, inspected, format, bodyOffset, {
    key: decryptionKey,
    verifyHmac
  });
}

export class TrackReader {
  constructor(source, inspection, format, bodyOffset, crypto) {
    this.source = source;
    this.inspection = inspection;
    this.essenceType = inspection.essence.type;
    this.duration = inspection.essence.editUnitCount;
    this.format = format;
    this.bodyOffset = bodyOffset;
    this.crypto = crypto;
  }

  async readFrame(frameNumber, { signal } = {}) {
    signal?.throwIfAborted();
    const normalizedFrame = normalizeFrameNumber(frameNumber);
    if (this.duration === null || normalizedFrame >= this.duration) {
      throw new TrackReaderError('Frame number is outside the track duration', {
        frameNumber: normalizedFrame,
        duration: this.duration
      });
    }
    const streamOffset = locateStreamOffset(
      this.inspection.footerIndex.segments,
      normalizedFrame,
      this.duration
    );
    const fileOffset = this.bodyOffset + streamOffset;
    if (fileOffset < 0n || fileOffset + 17n > this.source.size) {
      throw new TrackReaderError('Index entry points outside the source bounds', {
        frameNumber: normalizedFrame,
        fileOffset,
        sourceSize: this.source.size
      });
    }
    const klv = await trackOperation(
      readKlvHeader(this.source, fileOffset, { signal }),
      { frameNumber: normalizedFrame, fileOffset }
    );
    this.assertEssenceKlv(klv, normalizedFrame, fileOffset);
    const decoded = await this.decodeFrame(this.source, klv, normalizedFrame, signal);
    return {
      ...decoded,
      frameNumber: Number(normalizedFrame),
      fileOffset,
      streamOffset,
      klv,
      mediaType: this.format.mediaType
    };
  }

  async readTimedTextResource({ signal } = {}) {
    this.assertTimedText();
    const frame = await this.readFrame(0, { signal });
    return {
      ...frame,
      assetId: this.inspection.descriptor.assetId,
      mediaType: 'application/xml'
    };
  }

  async readAncillaryResource(resourceId, { signal } = {}) {
    this.assertTimedText();
    if (this.inspection.writerInfo.encryptedEssence) {
      throw new TrackReaderError('Encrypted ancillary-resource extraction is not implemented', {
        resourceId
      }, { code: 'ERR_ENCRYPTED_ANCILLARY_UNSUPPORTED' });
    }
    const normalizedId = normalizeUuid(resourceId);
    const resource = this.inspection.descriptor.resources.find((candidate) => (
      candidate.resourceId === normalizedId
    ));
    if (!resource) {
      throw new TrackReaderError('Timed-text descriptor has no such ancillary resource', {
        resourceId: normalizedId
      });
    }
    const payload = await trackOperation(
      readGenericStreamPartitionPayload(
        this.source,
        this.inspection.structure,
        resource.essenceStreamId,
        { signal }
      ),
      { resourceId: normalizedId, essenceStreamId: resource.essenceStreamId }
    );
    return {
      ...payload,
      resourceId: normalizedId,
      mediaType: resource.mediaType
    };
  }

  assertTimedText() {
    if (this.essenceType !== 'timed-text') {
      throw new TrackReaderError(`Timed-text resource access requires timed-text essence, got ${this.essenceType}`);
    }
  }

  async *frames({ startFrame = 0, duration, signal, onProgress, maxBatchBytes } = {}) {
    const { start, count } = frameRange(this.duration, startFrame, duration);
    if (maxBatchBytes !== undefined) {
      yield* this.batchedFrames({ start, count, signal, onProgress, maxBatchBytes });
      return;
    }
    for (let index = 0n; index < count; index += 1n) {
      signal?.throwIfAborted();
      const frame = await this.readFrame(start + index, { signal });
      onProgress?.({ completed: index + 1n, total: count, frameNumber: frame.frameNumber });
      yield frame;
    }
  }

  async *batchedFrames({ start, count, signal, onProgress, maxBatchBytes }) {
    const requestedLimit = positiveBigInt(maxBatchBytes, 'maxBatchBytes');
    const sourceLimit = this.source.maxReadBytes ?? requestedLimit;
    const batchLimit = requestedLimit < sourceLimit ? requestedLimit : sourceLimit;
    const end = start + count;
    let cursor = start;
    while (cursor < end) {
      signal?.throwIfAborted();
      const maximumBoundary = end < this.duration ? end : this.duration - 1n;
      if (cursor >= maximumBoundary) {
        const frame = await this.readFrame(cursor, { signal });
        onProgress?.({ completed: cursor - start + 1n, total: count, frameNumber: frame.frameNumber });
        yield frame;
        cursor += 1n;
        continue;
      }

      const startOffset = this.streamOffset(cursor);
      let boundary = cursor + 1n;
      let boundaryOffset = this.streamOffset(boundary);
      if (boundaryOffset - startOffset > batchLimit) {
        const frame = await this.readFrame(cursor, { signal });
        onProgress?.({ completed: cursor - start + 1n, total: count, frameNumber: frame.frameNumber });
        yield frame;
        cursor += 1n;
        continue;
      }
      while (boundary < maximumBoundary) {
        const candidate = boundary + 1n;
        const candidateOffset = this.streamOffset(candidate);
        if (candidateOffset - startOffset > batchLimit) break;
        boundary = candidate;
        boundaryOffset = candidateOffset;
      }

      const fileOffset = this.bodyOffset + startOffset;
      const bytes = await trackOperation(
        this.source.read(fileOffset, boundaryOffset - startOffset, { signal }),
        { frameNumber: cursor, fileOffset }
      );
      const memory = new MemoryRandomAccessSource(bytes);
      for (let frameNumber = cursor; frameNumber < boundary; frameNumber += 1n) {
        signal?.throwIfAborted();
        const streamOffset = this.streamOffset(frameNumber);
        const relativeOffset = streamOffset - startOffset;
        const localKlv = await trackOperation(
          readKlvHeader(memory, relativeOffset, { signal }),
          { frameNumber, fileOffset: this.bodyOffset + streamOffset }
        );
        this.assertEssenceKlv(localKlv, frameNumber, this.bodyOffset + streamOffset);
        const decoded = await this.decodeFrame(memory, localKlv, frameNumber, signal);
        const frame = {
          ...decoded,
          frameNumber: Number(frameNumber),
          fileOffset: this.bodyOffset + streamOffset,
          streamOffset,
          klv: offsetKlv(localKlv, fileOffset),
          mediaType: this.format.mediaType
        };
        onProgress?.({ completed: frameNumber - start + 1n, total: count, frameNumber: frame.frameNumber });
        yield frame;
      }
      cursor = boundary;
    }
  }

  streamOffset(frameNumber) {
    return locateStreamOffset(this.inspection.footerIndex.segments, frameNumber, this.duration);
  }

  assertEssenceKlv(klv, frameNumber, fileOffset) {
    const expectedKeyPrefix = this.inspection.writerInfo.encryptedEssence
      ? CRYPT_ESSENCE_KEY_PREFIX
      : this.format.keyPrefix;
    if (!keyMatchesPrefixIgnoringVersion(klv.keyHex, expectedKeyPrefix)) {
      throw new TrackReaderError('Index entry does not point to the expected essence KLV', {
        frameNumber,
        fileOffset,
        expectedKeyPrefix,
        actualKey: klv.keyHex
      });
    }
  }

  async decodeFrame(source, klv, frameNumber, signal) {
    const value = await trackOperation(
      readKlvValue(source, klv, { signal }),
      { frameNumber, fileOffset: klv.valueOffset - klv.headerLength }
    );
    if (!this.inspection.writerInfo.encryptedEssence) {
      return { data: value, encrypted: false, hmacVerified: null };
    }
    const decoded = await decryptFrameTriplet(value, {
      key: this.crypto.key,
      contextId: this.inspection.writerInfo.crypto?.contextId,
      sourceKeyPrefix: this.format.keyPrefix,
      sourceLengthLimit: this.source.maxReadBytes ?? null,
      assetUuid: this.inspection.writerInfo.assetUuid,
      frameNumber: Number(frameNumber),
      labelSetType: this.inspection.writerInfo.labelSetType,
      usesHmac: this.inspection.writerInfo.hmac,
      verifyHmac: this.crypto.verifyHmac,
      signal
    });
    return {
      data: decoded.data,
      encrypted: true,
      hmacVerified: decoded.hmacVerified,
      plaintextOffset: decoded.plaintextOffset,
      sourceKey: decoded.sourceKey
    };
  }
}

export async function* unwrap(source, {
  inspection,
  startFrame = 0,
  duration,
  numberWidth = 6,
  filePrefix = '',
  key,
  verifyHmac = false,
  signal,
  onProgress
} = {}) {
  if (!Number.isSafeInteger(numberWidth) || numberWidth < 1) {
    throw new TypeError('numberWidth must be a positive safe integer');
  }
  const track = await openTrack(source, { inspection, key, verifyHmac, signal });
  if (track.essenceType === 'timed-text') {
    yield* timedTextUnits(track, { filePrefix, signal, onProgress });
    return;
  }
  if (!track.format.extension) {
    throw new TrackReaderError(`File-unit unwrapping is not implemented for ${track.essenceType}`, {
      essenceType: track.essenceType
    });
  }
  for await (const frame of track.frames({ startFrame, duration, signal, onProgress })) {
    yield {
      ...frame,
      filename: `${filePrefix}${String(frame.frameNumber).padStart(numberWidth, '0')}.${track.format.extension}`
    };
  }
}

export async function* unwrapTimedText(source, {
  inspection,
  filePrefix = '',
  key,
  verifyHmac = false,
  signal,
  onProgress
} = {}) {
  const track = await openTrack(source, { inspection, key, verifyHmac, signal });
  track.assertTimedText();
  yield* timedTextUnits(track, { filePrefix, signal, onProgress });
}

export async function* unwrapPcmWav(source, {
  inspection,
  startFrame = 0,
  duration,
  split = 'multichannel',
  filePrefix = 'audio.wav',
  key,
  verifyHmac = false,
  signal,
  onProgress
} = {}) {
  const track = await openTrack(source, { inspection, key, verifyHmac, signal });
  if (track.essenceType !== 'pcm') {
    throw new TrackReaderError(`PCM WAV unwrapping requires PCM essence, got ${track.essenceType}`);
  }
  const descriptor = track.inspection.descriptor;
  const routing = pcmRouting(descriptor, split, filePrefix);
  const range = frameRange(track.duration, startFrame, duration);
  const frameSize = pcmFrameSize(descriptor);
  const outputFrameSize = frameSize / routing.fileCount;
  const dataLength = BigInt(outputFrameSize) * range.count;

  for (const filename of routing.filenames) {
    yield {
      data: makeWaveHeader(descriptor, routing.outputChannelCount, dataLength),
      filename,
      frameNumber: null,
      mediaType: 'audio/wav',
      kind: 'header'
    };
  }

  for await (const frame of track.frames({
    startFrame: range.start,
    duration: range.count,
    signal,
    onProgress
  })) {
    if (frame.data.byteLength !== frameSize) {
      throw new TrackReaderError('PCM frame size differs from its descriptor', {
        frameNumber: frame.frameNumber,
        expected: frameSize,
        actual: frame.data.byteLength
      });
    }
    const chunks = routePcmFrame(frame.data, descriptor, routing);
    for (let index = 0; index < chunks.length; index += 1) {
      yield {
        data: chunks[index],
        filename: routing.filenames[index],
        frameNumber: frame.frameNumber,
        mediaType: 'audio/wav',
        kind: 'data'
      };
    }
  }
}

function locateStreamOffset(segments, frameNumber, trackDuration) {
  const segment = segments.find((candidate) =>
    frameNumber >= candidate.indexStartPosition &&
    frameNumber < candidate.indexStartPosition + effectiveIndexDuration(candidate, trackDuration));
  if (!segment) {
    throw new TrackReaderError('Footer index has no segment for frame', { frameNumber });
  }
  const relativeFrame = frameNumber - segment.indexStartPosition;
  if (segment.indexEntries.length > 0) {
    const entry = segment.indexEntries[Number(relativeFrame)];
    if (!entry) throw new TrackReaderError('Footer index has no entry for frame', { frameNumber });
    return entry.streamOffset;
  }
  if (segment.editUnitByteCount > 0) {
    return frameNumber * BigInt(segment.editUnitByteCount);
  }
  throw new TrackReaderError('Index segment has neither frame entries nor a constant edit-unit size', {
    frameNumber,
    indexStartPosition: segment.indexStartPosition
  });
}

async function* timedTextUnits(track, { filePrefix, signal, onProgress }) {
  const resources = track.inspection.descriptor.resources;
  const total = resources.length + 1;
  const document = await track.readTimedTextResource({ signal });
  onProgress?.({ completed: 1, total, resourceId: document.assetId });
  yield {
    ...document,
    filename: filePrefix || `${document.assetId}.xml`,
    kind: 'timed-text'
  };

  for (let index = 0; index < resources.length; index += 1) {
    signal?.throwIfAborted();
    const resource = await track.readAncillaryResource(resources[index].resourceId, { signal });
    onProgress?.({ completed: index + 2, total, resourceId: resource.resourceId });
    yield {
      ...resource,
      filename: resource.resourceId,
      frameNumber: null,
      kind: 'ancillary-resource'
    };
  }
}

function effectiveIndexDuration(segment, trackDuration) {
  if (segment.indexDuration > 0n) return segment.indexDuration;
  if (segment.editUnitByteCount > 0 && segment.indexEntries.length === 0 &&
      trackDuration > segment.indexStartPosition) {
    return trackDuration - segment.indexStartPosition;
  }
  return 0n;
}

function essenceBodyOffset(structure) {
  const bodyPartition = structure.bodyPartitions[0];
  if (bodyPartition) return bodyPartition.klv.endOffset;
  const header = structure.headerPartition;
  if (header) return header.klv.endOffset + header.headerByteCount;
  throw new TrackReaderError('MXF structure has no essence-container base offset');
}

function frameRange(trackDuration, startFrame, duration) {
  const start = normalizeFrameNumber(startFrame);
  if (trackDuration === null || start > trackDuration) {
    throw new TrackReaderError('Starting frame is outside the track duration', {
      startFrame: start,
      duration: trackDuration
    });
  }
  const available = trackDuration - start;
  const requested = duration === undefined ? available : normalizeDuration(duration);
  return { start, count: requested < available ? requested : available };
}

function pcmFrameSize(descriptor) {
  const sampleSize = descriptor.quantizationBits / 8;
  const samplesPerFrame = Math.ceil(
    (descriptor.audioSamplingRate.numerator / descriptor.audioSamplingRate.denominator) /
    (descriptor.editRate.numerator / descriptor.editRate.denominator)
  );
  if (!Number.isInteger(sampleSize) || sampleSize <= 0 || !Number.isSafeInteger(samplesPerFrame)) {
    throw new TrackReaderError('PCM descriptor has an unsupported sample size or rate');
  }
  return sampleSize * descriptor.channelCount * samplesPerFrame;
}

function pcmRouting(descriptor, split, filePrefix) {
  if (!['multichannel', 'mono', 'stereo'].includes(split)) {
    throw new TypeError("split must be 'multichannel', 'mono', or 'stereo'");
  }
  if (split === 'stereo' && descriptor.channelCount % 2 !== 0) {
    throw new TrackReaderError('Stereo splitting requires an even PCM channel count');
  }
  const outputChannelCount = split === 'multichannel' ? descriptor.channelCount : split === 'stereo' ? 2 : 1;
  const fileCount = descriptor.channelCount / outputChannelCount;
  const filenames = split === 'multichannel'
    ? [filePrefix]
    : Array.from({ length: fileCount }, (_, index) =>
      `${filePrefix}_${String(index + 1).padStart(2, '0')}.wav`);
  return { fileCount, filenames, outputChannelCount };
}

function routePcmFrame(data, descriptor, routing) {
  if (routing.fileCount === 1) return [data];
  const sampleSize = descriptor.quantizationBits / 8;
  const sourceBlockSize = sampleSize * descriptor.channelCount;
  const outputBlockSize = sampleSize * routing.outputChannelCount;
  const outputs = Array.from({ length: routing.fileCount }, () =>
    new Uint8Array(data.byteLength / routing.fileCount));
  for (let sourceOffset = 0, outputOffset = 0; sourceOffset < data.byteLength;
    sourceOffset += sourceBlockSize, outputOffset += outputBlockSize) {
    for (let fileIndex = 0; fileIndex < routing.fileCount; fileIndex += 1) {
      const channelOffset = sourceOffset + fileIndex * outputBlockSize;
      outputs[fileIndex].set(data.subarray(channelOffset, channelOffset + outputBlockSize), outputOffset);
    }
  }
  return outputs;
}

function makeWaveHeader(descriptor, channelCount, dataLength) {
  const riffLength = dataLength + 38n;
  if (riffLength > 0xffffffffn) return makeRf64Header(descriptor, channelCount, dataLength, riffLength);
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  writeFourCc(bytes, 0, 'RIFF');
  view.setUint32(4, Number(riffLength), true);
  writeFourCc(bytes, 8, 'WAVE');
  writePcmFormat(bytes, view, 12, descriptor, channelCount);
  view.setUint32(42, Number(dataLength), true);
  return bytes;
}

function makeRf64Header(descriptor, channelCount, dataLength, riffLength) {
  const bytes = new Uint8Array(82);
  const view = new DataView(bytes.buffer);
  writeFourCc(bytes, 0, 'RF64');
  view.setUint32(4, 0xffffffff, true);
  writeFourCc(bytes, 8, 'WAVE');
  writeFourCc(bytes, 12, 'ds64');
  view.setUint32(16, 28, true);
  view.setBigUint64(20, riffLength, true);
  view.setBigUint64(28, dataLength > 0xffffffffn ? dataLength : 0n, true);
  view.setBigUint64(36, 0n, true);
  view.setUint32(44, 0, true);
  writePcmFormat(bytes, view, 48, descriptor, channelCount);
  view.setUint32(78, dataLength < 0xffffffffn ? Number(dataLength) : 0xffffffff, true);
  return bytes;
}

function writePcmFormat(bytes, view, offset, descriptor, channelCount) {
  const sampleRate = Math.ceil(
    descriptor.audioSamplingRate.numerator / descriptor.audioSamplingRate.denominator
  );
  const blockAlign = channelCount * Math.ceil(descriptor.quantizationBits / 8);
  writeFourCc(bytes, offset, 'fmt ');
  view.setUint32(offset + 4, 18, true);
  view.setUint16(offset + 8, 1, true);
  view.setUint16(offset + 10, channelCount, true);
  view.setUint32(offset + 12, sampleRate, true);
  view.setUint32(offset + 16, sampleRate * blockAlign, true);
  view.setUint16(offset + 20, blockAlign, true);
  view.setUint16(offset + 22, descriptor.quantizationBits, true);
  view.setUint16(offset + 24, 0, true);
  writeFourCc(bytes, offset + 26, 'data');
}

function writeFourCc(bytes, offset, value) {
  for (let index = 0; index < 4; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function essenceFormat(dictionaryName, mediaType, extension) {
  return {
    keyPrefix: mdd(dictionaryName).ulHex.slice(0, 30),
    mediaType,
    extension
  };
}

function keyMatchesPrefixIgnoringVersion(actual, expectedPrefix) {
  return actual.length === 32 && expectedPrefix.length === 30
    && actual.slice(0, 14) === expectedPrefix.slice(0, 14)
    && actual.slice(16, 30) === expectedPrefix.slice(16);
}

async function trackOperation(operation, details) {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof TrackReaderError || error?.name === 'AbortError') throw error;
    throw new TrackReaderError(error.message, {
      ...details,
      causeName: error.name
    }, { cause: error });
  }
}

function normalizeFrameNumber(value) {
  const frame = toBigInt(value, 'frame number');
  if (frame < 0n) throw new RangeError('frame number must not be negative');
  if (frame > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('frame number exceeds the safe integer range');
  return frame;
}

function normalizeDuration(value) {
  const duration = toBigInt(value, 'duration');
  if (duration < 0n) throw new RangeError('duration must not be negative');
  return duration;
}

function normalizeUuid(value) {
  const normalized = String(value).trim().replace(/^urn:uuid:/iu, '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(normalized)) {
    throw new TypeError('resourceId must be a UUID');
  }
  return normalized;
}

function positiveBigInt(value, name) {
  const result = toBigInt(value, name);
  if (result <= 0n) throw new RangeError(`${name} must be positive`);
  return result;
}

function offsetKlv(klv, offset) {
  return {
    ...klv,
    valueOffset: klv.valueOffset + offset,
    endOffset: klv.endOffset + offset
  };
}

function toBigInt(value, name) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`${name} must be a bigint or safe integer`);
}

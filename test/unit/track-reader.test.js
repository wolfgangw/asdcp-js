// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRandomAccessSource } from '../../src/io/random-access-source.js';
import { mdd } from '../../src/mxf/dictionary.js';
import { openTrack, TrackReaderError, unwrap, unwrapPcmWav } from '../../src/asdcp/track-reader.js';

test('indexed track reader returns only the plaintext essence KLV value', async () => {
  const first = makeEssencePacket([1, 2, 3]);
  const second = makeEssencePacket([4, 5]);
  const source = new MemoryRandomAccessSource(Uint8Array.from([...first, ...second]));
  const inspection = makeInspection([
    { streamOffset: 0n },
    { streamOffset: BigInt(first.length) }
  ]);
  const track = await openTrack(source, { inspection });

  const frame = await track.readFrame(1);
  assert.deepEqual(frame.data, Uint8Array.from([4, 5]));
  assert.equal(frame.frameNumber, 1);
  assert.equal(frame.streamOffset, BigInt(first.length));
  assert.equal(frame.mediaType, 'image/j2c');
});

test('constant-byte-rate index locates PCM edit units without explicit entries', async () => {
  const first = makeEssencePacket([1, 2], 'WAVEssence');
  const second = makeEssencePacket([3, 4], 'WAVEssence');
  assert.equal(first.length, second.length);
  const source = new MemoryRandomAccessSource(Uint8Array.from([...first, ...second]));
  const inspection = makeInspection([], {
    essenceType: 'pcm',
    editUnitByteCount: first.length
  });
  const track = await openTrack(source, { inspection });

  assert.deepEqual((await track.readFrame(1)).data, Uint8Array.from([3, 4]));
});

test('constant-byte-rate index uses track duration when stored index duration is zero', async () => {
  const first = makeEssencePacket([1, 2], 'WAVEssence');
  const second = makeEssencePacket([3, 4], 'WAVEssence');
  const source = new MemoryRandomAccessSource(Uint8Array.from([...first, ...second]));
  const inspection = makeInspection([], {
    essenceType: 'pcm',
    editUnitByteCount: first.length
  });
  inspection.footerIndex.segments[0].indexDuration = 0n;
  const track = await openTrack(source, { inspection });

  assert.deepEqual((await track.readFrame(1)).data, Uint8Array.from([3, 4]));
});

test('unwrap applies frame range, filename numbering, and progress', async () => {
  const packets = [[1], [2], [3]].map((value) => makeEssencePacket(value));
  const offsets = [0n, BigInt(packets[0].length), BigInt(packets[0].length + packets[1].length)];
  const source = new MemoryRandomAccessSource(Uint8Array.from(packets.flatMap((packet) => [...packet])));
  const inspection = makeInspection(offsets.map((streamOffset) => ({ streamOffset })), { duration: 3n });
  const progress = [];
  const units = [];
  for await (const unit of unwrap(source, {
    inspection,
    startFrame: 1,
    duration: 1,
    numberWidth: 4,
    filePrefix: 'frame-',
    onProgress: (event) => progress.push(event)
  })) units.push(unit);

  assert.equal(units.length, 1);
  assert.equal(units[0].filename, 'frame-0001.j2c');
  assert.deepEqual(units[0].data, Uint8Array.of(2));
  assert.deepEqual(progress, [{ completed: 1n, total: 1n, frameNumber: 1 }]);
});

test('batched frame reads collapse contiguous edit units into one source read', async () => {
  const packets = [[1], [2], [3], [4]].map((value) => makeEssencePacket(value, 'WAVEssence'));
  const source = new CountingSource(Uint8Array.from(packets.flatMap((packet) => [...packet])));
  const inspection = makeInspection([], {
    duration: 4n,
    essenceType: 'pcm',
    editUnitByteCount: packets[0].length
  });
  const track = await openTrack(source, { inspection });
  const values = [];
  for await (const frame of track.frames({ duration: 3, maxBatchBytes: 1024 })) {
    values.push(frame.data[0]);
  }

  assert.deepEqual(values, [1, 2, 3]);
  assert.equal(source.readCount, 1);
});

test('track reader requires a key for encrypted essence', async () => {
  const source = new MemoryRandomAccessSource(makeEssencePacket([1]));
  await assert.rejects(
    openTrack(source, { inspection: makeInspection([{ streamOffset: 0n }], { encrypted: true }) }),
    (error) => error instanceof TrackReaderError && error.code === 'ERR_ENCRYPTION_KEY_REQUIRED'
  );
});

test('track reader reports missing and unusable index entries', async () => {
  const packet = makeEssencePacket([1]);
  const source = new MemoryRandomAccessSource(packet);

  const missingSegment = makeInspection([{ streamOffset: 0n }]);
  missingSegment.footerIndex.segments[0].indexStartPosition = 1n;
  await assert.rejects(
    (await openTrack(source, { inspection: missingSegment })).readFrame(0),
    /Footer index has no segment for frame/u
  );

  const unusableSegment = makeInspection([]);
  await assert.rejects(
    (await openTrack(source, { inspection: unusableSegment })).readFrame(0),
    /neither frame entries nor a constant edit-unit size/u
  );
});

test('track reader rejects wrong essence keys and out-of-bounds index offsets', async () => {
  const wrongPacket = makeEssencePacket([1], 'MPEG2Essence');
  const wrongSource = new MemoryRandomAccessSource(wrongPacket);
  await assert.rejects(
    (await openTrack(wrongSource, {
      inspection: makeInspection([{ streamOffset: 0n }])
    })).readFrame(0),
    /expected essence KLV/u
  );

  const source = new MemoryRandomAccessSource(makeEssencePacket([1]));
  await assert.rejects(
    (await openTrack(source, {
      inspection: makeInspection([{ streamOffset: source.size }])
    })).readFrame(0),
    /outside the source bounds/u
  );
});

test('PCM WAV unwrapping emits a header and routes mono channel data', async () => {
  const packet = makeEssencePacket([1, 2, 3, 4], 'WAVEssence');
  const source = new MemoryRandomAccessSource(packet);
  const inspection = makeInspection([], {
    duration: 1n,
    essenceType: 'pcm',
    editUnitByteCount: packet.length,
    descriptor: pcmDescriptor()
  });
  const chunks = [];
  for await (const chunk of unwrapPcmWav(source, {
    inspection,
    duration: 1,
    split: 'mono',
    filePrefix: 'channel'
  })) chunks.push(chunk);

  assert.deepEqual(chunks.map(({ filename, kind }) => [filename, kind]), [
    ['channel_01.wav', 'header'],
    ['channel_02.wav', 'header'],
    ['channel_01.wav', 'data'],
    ['channel_02.wav', 'data']
  ]);
  assert.equal(new TextDecoder().decode(chunks[0].data.subarray(0, 4)), 'RIFF');
  assert.equal(new DataView(chunks[0].data.buffer).getUint32(42, true), 2);
  assert.deepEqual(chunks[2].data, Uint8Array.of(1, 2));
  assert.deepEqual(chunks[3].data, Uint8Array.of(3, 4));
});

test('PCM WAV unwrapping emits an RF64 header above the RIFF size limit', async () => {
  const packet = makeEssencePacket([1, 2, 3, 4], 'WAVEssence');
  const duration = 0x40000000n;
  const source = new MemoryRandomAccessSource(packet);
  const inspection = makeInspection([], {
    duration,
    essenceType: 'pcm',
    editUnitByteCount: packet.length,
    descriptor: pcmDescriptor()
  });
  const chunks = unwrapPcmWav(source, { inspection, duration });
  const first = await chunks.next();
  await chunks.return();

  assert.equal(new TextDecoder().decode(first.value.data.subarray(0, 4)), 'RF64');
  assert.equal(first.value.data.byteLength, 82);
  assert.equal(new DataView(first.value.data.buffer).getBigUint64(28, true), duration * 4n);
});

function makeEssencePacket(value, dictionaryName = 'JPEG2000Essence') {
  const key = hexBytes(`${mdd(dictionaryName).ulHex.slice(0, 30)}01`);
  return Uint8Array.from([...key, value.length, ...value]);
}

function makeInspection(indexEntries, {
  duration = 2n,
  essenceType = 'jpeg-2000',
  editUnitByteCount = 0,
  encrypted = false,
  descriptor = null
} = {}) {
  return {
    essence: { type: essenceType, editUnitCount: duration },
    descriptor,
    writerInfo: { encryptedEssence: encrypted },
    structure: {
      headerPartition: { klv: { endOffset: 0n }, headerByteCount: 0n },
      bodyPartitions: []
    },
    footerIndex: {
      segments: [{
        indexStartPosition: 0n,
        indexDuration: duration,
        editUnitByteCount,
        indexEntries
      }]
    }
  };
}

function pcmDescriptor() {
  return {
    type: 'pcm',
    editRate: { numerator: 1, denominator: 1 },
    audioSamplingRate: { numerator: 1, denominator: 1 },
    channelCount: 2,
    quantizationBits: 16
  };
}

function hexBytes(hex) {
  return Uint8Array.from(hex.match(/../gu).map((byte) => Number.parseInt(byte, 16)));
}

class CountingSource extends MemoryRandomAccessSource {
  readCount = 0;

  async read(offset, length, options) {
    this.readCount += 1;
    return super.read(offset, length, options);
  }
}

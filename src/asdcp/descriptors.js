// SPDX-License-Identifier: BSD-3-Clause

import { ByteReader } from '../binary/byte-reader.js';
import { toHex } from '../binary/identifiers.js';
import { mdd } from '../mxf/dictionary.js';

const KEYS = {
  rgba: mdd('RGBAEssenceDescriptor').ulHex,
  cdci: mdd('CDCIEssenceDescriptor').ulHex,
  jpeg2000: mdd('JPEG2000PictureSubDescriptor').ulHex,
  waveAudio: mdd('WaveAudioDescriptor').ulHex,
  mpeg2: mdd('MPEG2VideoDescriptor').ulHex,
  timedText: mdd('TimedTextDescriptor').ulHex,
  timedTextResource: mdd('TimedTextResourceSubDescriptor').ulHex,
  dcData: mdd('DCDataDescriptor').ulHex,
  privateDcData: mdd('PrivateDCDataDescriptor').ulHex,
  dolbyAtmos: mdd('DolbyAtmosSubDescriptor').ulHex
};

const CHANNEL_FORMATS = new Map([
  [mdd('DCAudioChannelCfg_1_5p1').ulHex, 1],
  [mdd('DCAudioChannelCfg_2_6p1').ulHex, 2],
  [mdd('DCAudioChannelCfg_3_7p1').ulHex, 3],
  [mdd('DCAudioChannelCfg_4_WTF').ulHex, 4],
  [mdd('DCAudioChannelCfg_5_7p1_DS').ulHex, 5],
  [mdd('DCAudioChannelCfg_MCA').ulHex, 6]
]);

const NULL_UL = '00000000000000000000000000000000';
const ST382_DEFAULT_PCM_UL = '060e2b340401010a0402020101000000';
const ST382_DEFAULT_PCM_NAME = 'SMPTE-382M Default Uncompressed Sound Coding';

export function parseEssenceDescriptor(headerMetadata, essenceType) {
  if (essenceType === 'pcm') return parsePcmDescriptor(headerMetadata);
  if (essenceType === 'jpeg-2000' || essenceType === 'jpeg-2000-stereoscopic') {
    return parseJpeg2000Descriptor(headerMetadata, { stereoscopic: essenceType.endsWith('stereoscopic') });
  }
  if (essenceType === 'mpeg-2') return parseMpeg2Descriptor(headerMetadata);
  if (essenceType === 'timed-text') return parseTimedTextDescriptor(headerMetadata);
  if (essenceType === 'd-cinema-generic-data') return parseGenericDataDescriptor(headerMetadata);
  if (essenceType === 'dolby-atmos') return parseAtmosDescriptor(headerMetadata);
  return null;
}

export function parsePcmDescriptor(headerMetadata) {
  const descriptor = requireSet(headerMetadata, KEYS.waveAudio, 'WaveAudioDescriptor');
  const channelAssignment = optionalValue(descriptor, 'WaveAudioDescriptor_ChannelAssignment');
  const channelAssignmentUl = channelAssignment ? toHex(channelAssignment) : null;
  const soundEssenceCoding = optionalValue(descriptor, 'GenericSoundEssenceDescriptor_SoundEssenceCoding');
  const storedSoundEssenceCodingUl = soundEssenceCoding ? toHex(soundEssenceCoding) : null;
  const usesSt382Default = storedSoundEssenceCodingUl === null || storedSoundEssenceCodingUl === NULL_UL;
  const issues = [];
  if (storedSoundEssenceCodingUl === NULL_UL) {
    issues.push({
      code: 'mxf.pcm.null-sound-essence-coding',
      message: 'SoundEssenceCoding is a stored null UL; ST 382 default PCM should omit this optional property'
    });
  }
  return {
    type: 'pcm',
    editRate: readRational(value(descriptor, 'FileDescriptor_SampleRate')),
    audioSamplingRate: readRational(value(descriptor, 'GenericSoundEssenceDescriptor_AudioSamplingRate')),
    locked: readUint8(optionalValue(descriptor, 'GenericSoundEssenceDescriptor_Locked') ?? Uint8Array.of(0)),
    channelCount: readUint32(value(descriptor, 'GenericSoundEssenceDescriptor_ChannelCount')),
    quantizationBits: readUint32(value(descriptor, 'GenericSoundEssenceDescriptor_QuantizationBits')),
    blockAlign: readUint16(value(descriptor, 'WaveAudioDescriptor_BlockAlign')),
    averageBytesPerSecond: readUint32(value(descriptor, 'WaveAudioDescriptor_AvgBps')),
    linkedTrackId: readUint32(optionalValue(descriptor, 'FileDescriptor_LinkedTrackID') ?? new Uint8Array(4)),
    containerDuration: readInt64(optionalValue(descriptor, 'FileDescriptor_ContainerDuration') ?? new Uint8Array(8)),
    essenceContainerUl: toHex(value(descriptor, 'FileDescriptor_EssenceContainer')),
    soundEssenceCoding: {
      storedUl: storedSoundEssenceCodingUl,
      effectiveUl: usesSt382Default ? ST382_DEFAULT_PCM_UL : storedSoundEssenceCodingUl,
      name: usesSt382Default ? ST382_DEFAULT_PCM_NAME : null,
      source: storedSoundEssenceCodingUl === null
        ? 'st382-default-absent'
        : storedSoundEssenceCodingUl === NULL_UL ? 'st382-default-null-placeholder' : 'descriptor'
    },
    channelAssignmentUl,
    channelFormat: CHANNEL_FORMATS.get(channelAssignmentUl) ?? 0,
    issues
  };
}

export function parseJpeg2000Descriptor(headerMetadata, { stereoscopic = false } = {}) {
  const descriptor = findSet(headerMetadata, KEYS.rgba) ?? findSet(headerMetadata, KEYS.cdci);
  if (!descriptor) throw new DescriptorError('MXF has no JPEG 2000 primary picture descriptor');
  const subDescriptor = requireSet(headerMetadata, KEYS.jpeg2000, 'JPEG2000PictureSubDescriptor');
  const componentSizing = readComponentSizing(value(subDescriptor, 'JPEG2000PictureSubDescriptor_PictureComponentSizing'));
  const codingStyle = readCodingStyle(value(subDescriptor, 'JPEG2000PictureSubDescriptor_CodingStyleDefault'));
  const quantizationBytes = optionalValue(subDescriptor, 'JPEG2000PictureSubDescriptor_QuantizationDefault');
  const pictureEssenceCoding = value(descriptor, 'GenericPictureEssenceDescriptor_PictureEssenceCoding');
  const extendedCapabilities = optionalValue(
    subDescriptor,
    'JPEG2000PictureSubDescriptor_J2KExtendedCapabilities'
  );

  return {
    type: stereoscopic ? 'jpeg-2000-stereoscopic' : 'jpeg-2000',
    stereoscopic,
    aspectRatio: readRational(value(descriptor, 'GenericPictureEssenceDescriptor_AspectRatio')),
    editRate: readRational(value(descriptor, 'FileDescriptor_SampleRate')),
    sampleRate: readRational(value(descriptor, 'FileDescriptor_SampleRate')),
    storedWidth: readUint32(value(descriptor, 'GenericPictureEssenceDescriptor_StoredWidth')),
    storedHeight: readUint32(value(descriptor, 'GenericPictureEssenceDescriptor_StoredHeight')),
    rsize: readUint16(value(subDescriptor, 'JPEG2000PictureSubDescriptor_Rsize')),
    xsize: readUint32(value(subDescriptor, 'JPEG2000PictureSubDescriptor_Xsize')),
    ysize: readUint32(value(subDescriptor, 'JPEG2000PictureSubDescriptor_Ysize')),
    xOrigin: readUint32(value(subDescriptor, 'JPEG2000PictureSubDescriptor_XOsize')),
    yOrigin: readUint32(value(subDescriptor, 'JPEG2000PictureSubDescriptor_YOsize')),
    tileWidth: readUint32(value(subDescriptor, 'JPEG2000PictureSubDescriptor_XTsize')),
    tileHeight: readUint32(value(subDescriptor, 'JPEG2000PictureSubDescriptor_YTsize')),
    tileXOrigin: readUint32(value(subDescriptor, 'JPEG2000PictureSubDescriptor_XTOsize')),
    tileYOrigin: readUint32(value(subDescriptor, 'JPEG2000PictureSubDescriptor_YTOsize')),
    componentCount: readUint16(value(subDescriptor, 'JPEG2000PictureSubDescriptor_Csize')),
    containerDuration: readInt64(value(descriptor, 'FileDescriptor_ContainerDuration')),
    components: componentSizing,
    codingStyle,
    quantization: quantizationBytes
      ? { sqcd: quantizationBytes[0], spqcdHex: toHex(quantizationBytes.subarray(1)) }
      : null,
    extendedCapabilities: extendedCapabilities ? readJ2kExtendedCapabilities(extendedCapabilities) : null,
    pictureEssenceCodingUl: toHex(pictureEssenceCoding)
  };
}

export function parseMpeg2Descriptor(headerMetadata) {
  const descriptor = requireSet(headerMetadata, KEYS.mpeg2, 'MPEG2VideoDescriptor');
  return {
    type: 'mpeg-2',
    sampleRate: readRational(value(descriptor, 'FileDescriptor_SampleRate')),
    frameLayout: readUint8(value(descriptor, 'GenericPictureEssenceDescriptor_FrameLayout')),
    storedWidth: readUint32(value(descriptor, 'GenericPictureEssenceDescriptor_StoredWidth')),
    storedHeight: readUint32(value(descriptor, 'GenericPictureEssenceDescriptor_StoredHeight')),
    aspectRatio: readRational(value(descriptor, 'GenericPictureEssenceDescriptor_AspectRatio')),
    pictureEssenceCodingUl: toHex(value(descriptor, 'GenericPictureEssenceDescriptor_PictureEssenceCoding')),
    componentDepth: readUint32(value(descriptor, 'CDCIEssenceDescriptor_ComponentDepth')),
    horizontalSubsampling: readUint32(value(descriptor, 'CDCIEssenceDescriptor_HorizontalSubsampling')),
    verticalSubsampling: readOptionalUint32(descriptor, 'CDCIEssenceDescriptor_VerticalSubsampling'),
    colorSiting: readOptionalUint8(descriptor, 'CDCIEssenceDescriptor_ColorSiting'),
    codedContentType: readOptionalUint8(descriptor, 'MPEG2VideoDescriptor_CodedContentType'),
    lowDelay: readOptionalUint8(descriptor, 'MPEG2VideoDescriptor_LowDelay') !== 0,
    bitRate: readOptionalUint32(descriptor, 'MPEG2VideoDescriptor_BitRate'),
    profileAndLevel: readOptionalUint8(descriptor, 'MPEG2VideoDescriptor_ProfileAndLevel'),
    containerDuration: readInt64(value(descriptor, 'FileDescriptor_ContainerDuration'))
  };
}

export function parseTimedTextDescriptor(headerMetadata) {
  const descriptor = requireSet(headerMetadata, KEYS.timedText, 'TimedTextDescriptor');
  const resources = headerMetadata.localSets
    .filter((packet) => packet.keyHex === KEYS.timedTextResource)
    .map((packet) => ({
      resourceId: readUuid(value(packet.localSet, 'TimedTextResourceSubDescriptor_AncillaryResourceID')),
      mediaType: readUtf16(value(packet.localSet, 'TimedTextResourceSubDescriptor_MIMEMediaType')),
      essenceStreamId: readUint32(value(packet.localSet, 'TimedTextResourceSubDescriptor_EssenceStreamID'))
    }));
  return {
    type: 'timed-text',
    editRate: readRational(value(descriptor, 'FileDescriptor_SampleRate')),
    containerDuration: readInt64(value(descriptor, 'FileDescriptor_ContainerDuration')),
    assetId: readUuid(value(descriptor, 'TimedTextDescriptor_ResourceID')),
    ucsEncoding: readUtf16(value(descriptor, 'TimedTextDescriptor_UCSEncoding')),
    namespaceName: readUtf16(value(descriptor, 'TimedTextDescriptor_NamespaceURI')),
    rfc5646LanguageTagList: readOptionalUtf16(descriptor, 'TimedTextDescriptor_RFC5646LanguageTagList'),
    dataEssenceCodingUl: toHex(value(descriptor, 'GenericDataEssenceDescriptor_DataEssenceCoding')),
    displayType: readOptionalUtf16(descriptor, 'TimedTextDescriptor_DisplayType'),
    intrinsicPictureResolution: readOptionalUtf16(descriptor, 'TimedTextDescriptor_IntrinsicPictureResolution'),
    zPositionInUse: readOptionalUint8(descriptor, 'TimedTextDescriptor_ZPositionInUse'),
    resources
  };
}

export function parseGenericDataDescriptor(headerMetadata) {
  const descriptor = findSet(headerMetadata, KEYS.dcData) ?? findSet(headerMetadata, KEYS.privateDcData);
  if (!descriptor) throw new DescriptorError('MXF has no D-Cinema generic data descriptor');
  return {
    type: 'd-cinema-generic-data',
    editRate: readRational(value(descriptor, 'FileDescriptor_SampleRate')),
    containerDuration: readInt64(value(descriptor, 'FileDescriptor_ContainerDuration')),
    dataEssenceCodingUl: toHex(value(descriptor, 'GenericDataEssenceDescriptor_DataEssenceCoding'))
  };
}

export function parseAtmosDescriptor(headerMetadata) {
  const base = parseGenericDataDescriptor(headerMetadata);
  const subDescriptor = requireSet(headerMetadata, KEYS.dolbyAtmos, 'DolbyAtmosSubDescriptor');
  return {
    ...base,
    type: 'dolby-atmos',
    atmosVersion: readUint8(value(subDescriptor, 'DolbyAtmosSubDescriptor_AtmosVersion')),
    maxChannelCount: readUint16(value(subDescriptor, 'DolbyAtmosSubDescriptor_MaxChannelCount')),
    maxObjectCount: readUint16(value(subDescriptor, 'DolbyAtmosSubDescriptor_MaxObjectCount')),
    atmosId: readUuid(value(subDescriptor, 'DolbyAtmosSubDescriptor_AtmosID')),
    firstFrame: readUint32(value(subDescriptor, 'DolbyAtmosSubDescriptor_FirstFrame'))
  };
}

export class DescriptorError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DescriptorError';
    this.details = details;
  }
}

function readComponentSizing(bytes) {
  const reader = new ByteReader(bytes);
  if (reader.remaining < 8) throw new DescriptorError('PictureComponentSizing batch is truncated');
  const count = reader.readUint32();
  const itemSize = reader.readUint32();
  if (itemSize !== 3 || reader.remaining !== count * itemSize) {
    throw new DescriptorError('PictureComponentSizing has an invalid batch shape', {
      count,
      itemSize,
      remaining: reader.remaining
    });
  }
  return Array.from({ length: count }, () => ({
    bits: reader.readUint8() + 1,
    horizontalSeparation: reader.readUint8(),
    verticalSeparation: reader.readUint8()
  }));
}

function readCodingStyle(bytes) {
  const reader = new ByteReader(bytes);
  if (reader.remaining < 10) throw new DescriptorError('CodingStyleDefault is truncated');
  const codingStyle = {
    scod: reader.readUint8(),
    progressionOrder: reader.readUint8(),
    numberOfLayers: reader.readUint16(),
    multiComponentTransform: reader.readUint8(),
    decompositionLevels: reader.readUint8(),
    codeblockWidth: reader.readUint8(),
    codeblockHeight: reader.readUint8(),
    codeblockStyle: reader.readUint8(),
    transformation: reader.readUint8(),
    precincts: []
  };
  while (reader.remaining > 0) {
    const packed = reader.readUint8();
    if (packed === 0) break;
    codingStyle.precincts.push({
      width: exponentSize(packed & 0x0f),
      height: exponentSize((packed >>> 4) & 0x0f)
    });
  }
  return codingStyle;
}

function readJ2kExtendedCapabilities(bytes) {
  const reader = new ByteReader(bytes);
  if (reader.remaining < 12) throw new DescriptorError('J2KExtendedCapabilities is truncated');
  const pcap = reader.readUint32();
  const count = reader.readUint32();
  const itemSize = reader.readUint32();
  if (count > 0 && itemSize !== 2) {
    throw new DescriptorError('J2KExtendedCapabilities Ccap item size is not 2', { count, itemSize });
  }
  if (reader.remaining !== count * itemSize) {
    throw new DescriptorError('J2KExtendedCapabilities Ccap batch length is inconsistent');
  }
  return {
    pcap,
    capabilities: Array.from({ length: count }, () => reader.readUint16())
  };
}

function exponentSize(exponent) {
  return exponent === 0 ? 0 : 2 ** exponent;
}

function requireSet(headerMetadata, keyHex, name) {
  const localSet = findSet(headerMetadata, keyHex);
  if (!localSet) throw new DescriptorError(`MXF has no ${name}`);
  return localSet;
}

function findSet(headerMetadata, keyHex) {
  return headerMetadata.localSets.find((packet) => packet.keyHex === keyHex)?.localSet ?? null;
}

function value(localSet, name) {
  const result = optionalValue(localSet, name);
  if (!result) throw new DescriptorError(`Descriptor has no ${name}`);
  return result;
}

function optionalValue(localSet, name) {
  const entry = mdd(name);
  return localSet.byUl.get(entry.ulHex)?.value ??
    (entry.tag === 0 ? null : localSet.byTag.get(entry.tag)?.value ?? null);
}

function readRational(bytes) {
  if (bytes.byteLength !== 8) throw new DescriptorError('Rational value is not 8 bytes');
  const reader = new ByteReader(bytes);
  return { numerator: reader.readInt32(), denominator: reader.readInt32() };
}

function readUint8(bytes) {
  if (bytes.byteLength !== 1) throw new DescriptorError('8-bit value is not 1 byte');
  return bytes[0];
}

function readUint16(bytes) {
  if (bytes.byteLength !== 2) throw new DescriptorError('16-bit value is not 2 bytes');
  return new ByteReader(bytes).readUint16();
}

function readUint32(bytes) {
  if (bytes.byteLength !== 4) throw new DescriptorError('32-bit value is not 4 bytes');
  return new ByteReader(bytes).readUint32();
}

function readInt64(bytes) {
  if (bytes.byteLength !== 8) throw new DescriptorError('64-bit value is not 8 bytes');
  return new ByteReader(bytes).readInt64();
}

function readUuid(bytes) {
  if (bytes.byteLength !== 16) throw new DescriptorError('UUID value is not 16 bytes');
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readUtf16(bytes) {
  if (bytes.byteLength % 2 !== 0) throw new DescriptorError('UTF-16 value has an odd byte length');
  return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/u, '');
}

function readOptionalUint8(localSet, name) {
  const bytes = optionalValue(localSet, name);
  return bytes ? readUint8(bytes) : 0;
}

function readOptionalUint32(localSet, name) {
  const bytes = optionalValue(localSet, name);
  return bytes ? readUint32(bytes) : 0;
}

function readOptionalUtf16(localSet, name) {
  const bytes = optionalValue(localSet, name);
  return bytes ? readUtf16(bytes) : '';
}

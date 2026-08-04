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
  dolbyAtmos: mdd('DolbyAtmosSubDescriptor').ulHex,
  iab: mdd('IABEssenceDescriptor').ulHex,
  iabSoundfield: mdd('IABSoundfieldLabelSubDescriptor').ulHex,
  preface: mdd('Preface').ulHex
};

// ST 429-18 added this property after the pinned AS-DCP MDD table was created.
// Keep it supplemental instead of modifying the generated upstream dictionary.
const IAB_SAMPLE_RATE_UL = '060e2b340101010e040203010f000000';

const CHANNEL_FORMATS = new Map([
  [mdd('DCAudioChannelCfg_1_5p1').ulHex, 1],
  [mdd('DCAudioChannelCfg_2_6p1').ulHex, 2],
  [mdd('DCAudioChannelCfg_3_7p1').ulHex, 3],
  [mdd('DCAudioChannelCfg_4_WTF').ulHex, 4],
  [mdd('DCAudioChannelCfg_5_7p1_DS').ulHex, 5],
  [mdd('DCAudioChannelCfg_MCA').ulHex, 6]
]);

const MCA_CHANNEL_ROLES = new Map([
  ['L', 'DCAudioChannel_L'],
  ['R', 'DCAudioChannel_R'],
  ['C', 'DCAudioChannel_C'],
  ['LFE', 'DCAudioChannel_LFE'],
  ['Ls', 'DCAudioChannel_Ls'],
  ['Rs', 'DCAudioChannel_Rs'],
  ['Lss', 'DCAudioChannel_Lss'],
  ['Rss', 'DCAudioChannel_Rss'],
  ['Lrs', 'DCAudioChannel_Lrs'],
  ['Rrs', 'DCAudioChannel_Rrs'],
  ['Lc', 'DCAudioChannel_Lc'],
  ['Rc', 'DCAudioChannel_Rc'],
  ['Cs', 'DCAudioChannel_Cs'],
  ['HI', 'DCAudioChannel_HI'],
  ['VIN', 'DCAudioChannel_VIN']
].map(([role, name]) => [mdd(name).ulHex, role]));

const PROGRAMME_CHANNEL_ROLES = new Set([
  'L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lss', 'Rss', 'Lrs', 'Rrs', 'Lc', 'Rc', 'Cs'
]);

const STATIC_CHANNEL_LAYOUTS = new Map([
  [mdd('DCAudioChannelCfg_1_5p1').ulHex, {
    name: '5.1', roles: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'HI', 'VIN']
  }],
  [mdd('DCAudioChannelCfg_2_6p1').ulHex, {
    name: '6.1', roles: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Cs', null, 'HI', 'VIN']
  }],
  [mdd('DCAudioChannelCfg_3_7p1').ulHex, {
    name: '7.1 SDS', roles: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lc', 'Rc', 'HI', 'VIN']
  }],
  [mdd('DCAudioChannelCfg_5_7p1_DS').ulHex, {
    name: '7.1 DS', roles: ['L', 'R', 'C', 'LFE', 'Lss', 'Rss', 'Lrs', 'Rrs', 'HI', 'VIN']
  }]
]);

const WILD_TRACK_FORMAT_UL = mdd('DCAudioChannelCfg_4_WTF').ulHex;

const NULL_UL = '00000000000000000000000000000000';
const ST382_DEFAULT_PCM_UL = '060e2b340401010a0402020101000000';
const ST382_DEFAULT_PCM_NAME = 'SMPTE-382M Default Uncompressed Sound Coding';

export function parseEssenceDescriptor(headerMetadata, essenceType, { metadataGraph = null } = {}) {
  if (essenceType === 'pcm') return parsePcmDescriptor(headerMetadata, { metadataGraph });
  if (essenceType === 'jpeg-2000' || essenceType === 'jpeg-2000-stereoscopic') {
    return parseJpeg2000Descriptor(headerMetadata, { stereoscopic: essenceType.endsWith('stereoscopic') });
  }
  if (essenceType === 'mpeg-2') return parseMpeg2Descriptor(headerMetadata);
  if (essenceType === 'timed-text') return parseTimedTextDescriptor(headerMetadata);
  if (essenceType === 'd-cinema-generic-data') return parseGenericDataDescriptor(headerMetadata);
  if (essenceType === 'dolby-atmos') return parseAtmosDescriptor(headerMetadata);
  if (essenceType === 'iab') return parseIabDescriptor(headerMetadata);
  return null;
}

export function parsePcmDescriptor(headerMetadata, { metadataGraph = null } = {}) {
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
  const channelCount = readUint32(value(descriptor, 'GenericSoundEssenceDescriptor_ChannelCount'));
  const channelMetadata = resolvePcmChannelMetadata({
    channelCount,
    channelAssignmentUl,
    metadataGraph
  });
  issues.push(...channelMetadata.issues);
  return {
    type: 'pcm',
    editRate: readRational(value(descriptor, 'FileDescriptor_SampleRate')),
    audioSamplingRate: readRational(value(descriptor, 'GenericSoundEssenceDescriptor_AudioSamplingRate')),
    locked: readUint8(optionalValue(descriptor, 'GenericSoundEssenceDescriptor_Locked') ?? Uint8Array.of(0)),
    channelCount,
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
    channelLayout: channelMetadata.channelLayout,
    audioChannels: channelMetadata.audioChannels,
    mcaLabels: channelMetadata.mcaLabels,
    issues
  };
}

function resolvePcmChannelMetadata({ channelCount, channelAssignmentUl, metadataGraph }) {
  const issues = [];
  const mcaLabels = parseMcaLabels(metadataGraph);
  if (mcaLabels.audioChannels.length > 0) {
    const byChannelId = new Map();
    for (const label of mcaLabels.audioChannels) {
      if (!Number.isInteger(label.channelId) || label.channelId < 1 || label.channelId > channelCount) {
        issues.push({
          code: 'mxf.pcm.mca-channel-id-out-of-range',
          message: `MCA channel ID ${label.channelId ?? '[missing]'} is outside the ${channelCount}-channel essence`
        });
        continue;
      }
      if (byChannelId.has(label.channelId)) {
        issues.push({
          code: 'mxf.pcm.mca-channel-id-duplicate',
          message: `MCA channel ID ${label.channelId} is assigned more than once`
        });
        continue;
      }
      byChannelId.set(label.channelId, label);
    }
    return {
      audioChannels: Array.from({ length: channelCount }, (_, index) => {
        const label = byChannelId.get(index + 1);
        return label
          ? normalizedChannel(index, label.role, 'mca', label)
          : normalizedChannel(index, null, 'mca');
      }),
      channelLayout: {
        source: 'mca',
        name: mcaLabels.soundfieldGroups.map((group) => group.symbol).filter(Boolean).join(' + ') || 'MCA',
        resolved: byChannelId.size > 0
      },
      mcaLabels,
      issues
    };
  }

  const staticLayout = STATIC_CHANNEL_LAYOUTS.get(channelAssignmentUl);
  if (staticLayout) {
    return {
      audioChannels: Array.from({ length: channelCount }, (_, index) => (
        normalizedChannel(index, staticLayout.roles[index] ?? null, 'channel-assignment')
      )),
      channelLayout: { source: 'channel-assignment', name: staticLayout.name, resolved: true },
      mcaLabels,
      issues
    };
  }

  if (channelAssignmentUl === null) {
    const defaultLayout = STATIC_CHANNEL_LAYOUTS.get(mdd('DCAudioChannelCfg_1_5p1').ulHex);
    return {
      audioChannels: Array.from({ length: channelCount }, (_, index) => (
        normalizedChannel(index, defaultLayout.roles[index] ?? null, 'st429-2-default')
      )),
      channelLayout: { source: 'st429-2-default', name: defaultLayout.name, resolved: true },
      mcaLabels,
      issues
    };
  }

  if (channelAssignmentUl === WILD_TRACK_FORMAT_UL) {
    return {
      audioChannels: Array.from({ length: channelCount }, (_, index) => (
        normalizedChannel(index, null, 'wild-track-format')
      )),
      channelLayout: {
        source: 'channel-assignment',
        name: 'Wild Track Format',
        resolved: false
      },
      mcaLabels,
      issues
    };
  }

  return {
    audioChannels: Array.from({ length: channelCount }, (_, index) => normalizedChannel(index, null, 'unknown')),
    channelLayout: { source: 'unknown', name: null, resolved: false },
    mcaLabels,
    issues
  };
}

function parseMcaLabels(metadataGraph) {
  if (!metadataGraph) return { soundfieldGroups: [], audioChannels: [] };
  const waveDescriptor = metadataGraph.objects.find((object) => object.keyHex === KEYS.waveAudio);
  if (!waveDescriptor) return { soundfieldGroups: [], audioChannels: [] };
  const subDescriptors = waveDescriptor.references
    .map((reference) => reference.target)
    .filter(Boolean);
  const soundfieldGroups = subDescriptors
    .filter((object) => object.type === 'SoundfieldGroupLabelSubDescriptor')
    .map((object) => mcaLabel(object));
  const audioChannels = subDescriptors
    .filter((object) => object.type === 'AudioChannelLabelSubDescriptor')
    .map((object) => {
      const label = mcaLabel(object);
      return {
        ...label,
        channelId: propertyValue(object, 'MCALabelSubDescriptor_MCAChannelID'),
        soundfieldGroupLinkId: propertyValue(object, 'AudioChannelLabelSubDescriptor_SoundfieldGroupLinkID')
      };
    });
  return { soundfieldGroups, audioChannels };
}

function mcaLabel(object) {
  const dictionary = propertyValue(object, 'MCALabelSubDescriptor_MCALabelDictionaryID');
  const dictionaryIdUl = dictionary?.hex ?? null;
  return {
    dictionaryIdUl,
    linkId: propertyValue(object, 'MCALabelSubDescriptor_MCALinkID'),
    symbol: propertyValue(object, 'MCALabelSubDescriptor_MCATagSymbol'),
    name: propertyValue(object, 'MCALabelSubDescriptor_MCATagName'),
    language: propertyValue(object, 'MCALabelSubDescriptor_RFC5646SpokenLanguage'),
    role: MCA_CHANNEL_ROLES.get(dictionaryIdUl) ?? null
  };
}

function propertyValue(object, name) {
  return object.properties[name]?.value ?? null;
}

function normalizedChannel(index, role, source, label = {}) {
  return {
    index,
    channelId: index + 1,
    role,
    symbol: label.symbol ?? role ?? `CH${String(index + 1).padStart(2, '0')}`,
    name: label.name ?? null,
    dictionaryIdUl: label.dictionaryIdUl ?? null,
    linkId: label.linkId ?? null,
    soundfieldGroupLinkId: label.soundfieldGroupLinkId ?? null,
    language: label.language ?? null,
    programme: PROGRAMME_CHANNEL_ROLES.has(role),
    source
  };
}

export function parseJpeg2000Descriptor(headerMetadata, { stereoscopic = false } = {}) {
  const descriptor = findSet(headerMetadata, KEYS.rgba) ?? findSet(headerMetadata, KEYS.cdci);
  if (!descriptor) throw new DescriptorError('MXF has no JPEG 2000 primary picture descriptor');
  const subDescriptor = requireSet(headerMetadata, KEYS.jpeg2000, 'JPEG2000PictureSubDescriptor');
  const componentSizing = readComponentSizing(value(subDescriptor, 'JPEG2000PictureSubDescriptor_PictureComponentSizing'));
  const codingStyleBytes = optionalValue(subDescriptor, 'JPEG2000PictureSubDescriptor_CodingStyleDefault');
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
    codingStyle: codingStyleBytes ? readCodingStyle(codingStyleBytes) : null,
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
    linkedTrackId: readNullableUint32(optionalValue(descriptor, 'FileDescriptor_LinkedTrackID')),
    containerDuration: readInt64(value(descriptor, 'FileDescriptor_ContainerDuration')),
    essenceContainerUl: readNullableUl(optionalValue(descriptor, 'FileDescriptor_EssenceContainer')),
    dataEssenceCodingUl: toHex(value(descriptor, 'GenericDataEssenceDescriptor_DataEssenceCoding'))
  };
}

export function parseAtmosDescriptor(headerMetadata) {
  const base = parseGenericDataDescriptor(headerMetadata);
  const subDescriptor = requireSet(headerMetadata, KEYS.dolbyAtmos, 'DolbyAtmosSubDescriptor');
  const immersiveAudioVersion = readNullableUint8(optionalValue(
    subDescriptor, 'DolbyAtmosSubDescriptor_AtmosVersion'
  ));
  const immersiveAudioId = readNullableUuid(optionalValue(
    subDescriptor, 'DolbyAtmosSubDescriptor_AtmosID'
  ));
  return {
    ...base,
    type: 'dolby-atmos',
    family: 'immersive-audio',
    standard: 'SMPTE ST 429-18',
    wrapping: 'frame',
    descriptorSet: 'PrivateDCDataDescriptor',
    subDescriptorSet: 'DolbyAtmosSubDescriptor',
    immersiveAudioVersion,
    maxChannelCount: readNullableUint16(optionalValue(
      subDescriptor, 'DolbyAtmosSubDescriptor_MaxChannelCount'
    )),
    maxObjectCount: readNullableUint16(optionalValue(
      subDescriptor, 'DolbyAtmosSubDescriptor_MaxObjectCount'
    )),
    immersiveAudioId,
    firstFrame: readNullableUint32(optionalValue(
      subDescriptor, 'DolbyAtmosSubDescriptor_FirstFrame'
    )),
    iabSampleRate: readNullableRational(optionalValueByUl(subDescriptor, IAB_SAMPLE_RATE_UL)),
    // Compatibility aliases for callers using the historical AS-DCP names.
    atmosVersion: immersiveAudioVersion,
    atmosId: immersiveAudioId
  };
}

export function parseIabDescriptor(headerMetadata) {
  const descriptor = requireSet(headerMetadata, KEYS.iab, 'IABEssenceDescriptor');
  const soundfield = requireSet(
    headerMetadata, KEYS.iabSoundfield, 'IABSoundfieldLabelSubDescriptor'
  );
  return {
    type: 'iab',
    family: 'immersive-audio',
    standard: 'SMPTE ST 2067-201',
    wrapping: 'clip',
    descriptorSet: 'IABEssenceDescriptor',
    subDescriptorSet: 'IABSoundfieldLabelSubDescriptor',
    editRate: readRational(value(descriptor, 'FileDescriptor_SampleRate')),
    linkedTrackId: readNullableUint32(optionalValue(descriptor, 'FileDescriptor_LinkedTrackID')),
    containerDuration: readNullableInt64(optionalValue(
      descriptor, 'FileDescriptor_ContainerDuration'
    )),
    essenceContainerUl: readNullableUl(optionalValue(
      descriptor, 'FileDescriptor_EssenceContainer'
    )),
    audioSamplingRate: readRational(value(
      descriptor, 'GenericSoundEssenceDescriptor_AudioSamplingRate'
    )),
    channelCount: readUint32(value(descriptor, 'GenericSoundEssenceDescriptor_ChannelCount')),
    quantizationBits: readUint32(value(
      descriptor, 'GenericSoundEssenceDescriptor_QuantizationBits'
    )),
    soundEssenceCodingUl: readNullableUl(optionalValue(
      descriptor, 'GenericSoundEssenceDescriptor_SoundEssenceCoding'
    )),
    referenceImageEditRate: readNullableRational(optionalValue(
      descriptor, 'GenericSoundEssenceDescriptor_ReferenceImageEditRate'
    )),
    referenceAudioAlignmentLevel: readNullableUint8(optionalValue(
      descriptor, 'GenericSoundEssenceDescriptor_ReferenceAudioAlignmentLevel'
    )),
    conformsToSpecifications: parseConformsToSpecifications(headerMetadata),
    soundfield: {
      dictionaryIdUl: readNullableUl(optionalValue(
        soundfield, 'MCALabelSubDescriptor_MCALabelDictionaryID'
      )),
      linkId: readNullableUuid(optionalValue(soundfield, 'MCALabelSubDescriptor_MCALinkID')),
      tagSymbol: readNullableUtf16(optionalValue(
        soundfield, 'MCALabelSubDescriptor_MCATagSymbol'
      )),
      tagName: readNullableUtf16(optionalValue(
        soundfield, 'MCALabelSubDescriptor_MCATagName'
      )),
      spokenLanguage: readNullableUtf8(optionalValue(
        soundfield, 'MCALabelSubDescriptor_RFC5646SpokenLanguage'
      )),
      audioContentKind: readNullableUtf16(optionalValue(
        soundfield, 'MCALabelSubDescriptor_MCAAudioContentKind'
      )),
      audioElementKind: readNullableUtf16(optionalValue(
        soundfield, 'MCALabelSubDescriptor_MCAAudioElementKind'
      )),
      title: readNullableUtf16(optionalValue(soundfield, 'MCALabelSubDescriptor_MCATitle')),
      titleVersion: readNullableUtf16(optionalValue(
        soundfield, 'MCALabelSubDescriptor_MCATitleVersion'
      ))
    }
  };
}

function parseConformsToSpecifications(headerMetadata) {
  const preface = findSet(headerMetadata, KEYS.preface);
  const bytes = preface && optionalValue(preface, 'Preface_ConformsToSpecifications');
  return bytes ? readUlBatch(bytes) : [];
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

function optionalValueByUl(localSet, ulHex) {
  return localSet.byUl.get(ulHex)?.value ?? null;
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

function readNullableUint8(bytes) {
  return bytes ? readUint8(bytes) : null;
}

function readNullableUint16(bytes) {
  return bytes ? readUint16(bytes) : null;
}

function readNullableUint32(bytes) {
  return bytes ? readUint32(bytes) : null;
}

function readNullableInt64(bytes) {
  return bytes ? readInt64(bytes) : null;
}

function readNullableRational(bytes) {
  return bytes ? readRational(bytes) : null;
}

function readNullableUuid(bytes) {
  return bytes ? readUuid(bytes) : null;
}

function readNullableUl(bytes) {
  return bytes ? toHex(bytes) : null;
}

function readNullableUtf16(bytes) {
  return bytes ? readUtf16(bytes) : null;
}

function readNullableUtf8(bytes) {
  return bytes ? new TextDecoder().decode(bytes).replace(/\0+$/u, '') : null;
}

function readUlBatch(bytes) {
  const reader = new ByteReader(bytes);
  if (reader.remaining < 8) throw new DescriptorError('UL batch is truncated');
  const count = reader.readUint32();
  const itemSize = reader.readUint32();
  if (count > 0 && itemSize !== 16) {
    throw new DescriptorError('UL batch item size is not 16 bytes', { count, itemSize });
  }
  if (reader.remaining !== count * itemSize) {
    throw new DescriptorError('UL batch size does not match its value length');
  }
  return Array.from({ length: count }, () => toHex(reader.readBytes(16)));
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

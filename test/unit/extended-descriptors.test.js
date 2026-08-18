// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAtmosDescriptor,
  parseGenericDataDescriptor,
  parseIabDescriptor,
  parseJpeg2000Descriptor,
  parseMpeg2Descriptor,
  parsePcmDescriptor,
  parseTimedTextDescriptor
} from '../../src/asdcp/descriptors.js';
import { mdd } from '../../src/mxf/dictionary.js';
import { buildMetadataGraph } from '../../src/mxf/metadata-graph.js';

test('PCM descriptor resolves MCA dictionary labels to individual channel roles', () => {
  const waveId = uuid(1);
  const soundfieldId = uuid(2);
  const leftId = uuid(3);
  const hiId = uuid(4);
  const soundfieldLinkId = uuid(5);
  const header = metadata([
    set('WaveAudioDescriptor', {
      InterchangeObject_InstanceUID: waveId,
      GenericDescriptor_SubDescriptors: uuidBatch([soundfieldId, leftId, hiId]),
      FileDescriptor_SampleRate: rational(24, 1),
      GenericSoundEssenceDescriptor_AudioSamplingRate: rational(48_000, 1),
      GenericSoundEssenceDescriptor_ChannelCount: u32(2),
      GenericSoundEssenceDescriptor_QuantizationBits: u32(24),
      WaveAudioDescriptor_BlockAlign: u16(6),
      WaveAudioDescriptor_AvgBps: u32(288_000),
      FileDescriptor_ContainerDuration: i64(240n),
      FileDescriptor_EssenceContainer: ul(0x01),
      WaveAudioDescriptor_ChannelAssignment: namedUl('DCAudioChannelCfg_4_WTF')
    }),
    set('SoundfieldGroupLabelSubDescriptor', {
      InterchangeObject_InstanceUID: soundfieldId,
      MCALabelSubDescriptor_MCALabelDictionaryID: namedUl('DCAudioSoundfield_51'),
      MCALabelSubDescriptor_MCALinkID: soundfieldLinkId,
      MCALabelSubDescriptor_MCATagSymbol: utf16('sg51'),
      MCALabelSubDescriptor_MCATagName: utf16('5.1')
    }),
    set('AudioChannelLabelSubDescriptor', {
      InterchangeObject_InstanceUID: leftId,
      MCALabelSubDescriptor_MCALabelDictionaryID: namedUl('DCAudioChannel_L'),
      MCALabelSubDescriptor_MCALinkID: uuid(6),
      MCALabelSubDescriptor_MCATagSymbol: utf16('chL'),
      MCALabelSubDescriptor_MCATagName: utf16('Left'),
      MCALabelSubDescriptor_MCAChannelID: u32(1),
      MCALabelSubDescriptor_RFC5646SpokenLanguage: ascii('en-US'),
      AudioChannelLabelSubDescriptor_SoundfieldGroupLinkID: soundfieldLinkId
    }),
    set('AudioChannelLabelSubDescriptor', {
      InterchangeObject_InstanceUID: hiId,
      MCALabelSubDescriptor_MCALabelDictionaryID: namedUl('DCAudioChannel_HI'),
      MCALabelSubDescriptor_MCALinkID: uuid(7),
      MCALabelSubDescriptor_MCATagSymbol: utf16('chHI'),
      MCALabelSubDescriptor_MCAChannelID: u32(2)
    })
  ]);

  const descriptor = parsePcmDescriptor(header, { metadataGraph: buildMetadataGraph(header) });
  assert.deepEqual(descriptor.channelLayout, { source: 'mca', name: 'sg51', resolved: true });
  assert.deepEqual(descriptor.audioChannels.map(({ channelId, role, symbol, programme, language }) => ({
    channelId, role, symbol, programme, language
  })), [
    { channelId: 1, role: 'L', symbol: 'chL', programme: true, language: 'en-US' },
    { channelId: 2, role: 'HI', symbol: 'chHI', programme: false, language: null }
  ]);
  assert.equal(descriptor.mcaLabels.soundfieldGroups[0].name, '5.1');
  assert.deepEqual(descriptor.issues, []);
});

test('PCM descriptor only marks channels as programme when MCA group semantics resolve', () => {
  const waveId = uuid(10);
  const soundfieldId = uuid(11);
  const leftId = uuid(12);
  const wrongSoundfieldLinkId = uuid(13);
  const header = metadata([
    set('WaveAudioDescriptor', {
      InterchangeObject_InstanceUID: waveId,
      GenericDescriptor_SubDescriptors: uuidBatch([soundfieldId, leftId]),
      FileDescriptor_SampleRate: rational(24, 1),
      GenericSoundEssenceDescriptor_AudioSamplingRate: rational(48_000, 1),
      GenericSoundEssenceDescriptor_ChannelCount: u32(1),
      GenericSoundEssenceDescriptor_QuantizationBits: u32(24),
      WaveAudioDescriptor_BlockAlign: u16(3),
      WaveAudioDescriptor_AvgBps: u32(144_000),
      FileDescriptor_ContainerDuration: i64(240n),
      FileDescriptor_EssenceContainer: ul(0x01),
      WaveAudioDescriptor_ChannelAssignment: namedUl('DCAudioChannelCfg_MCA')
    }),
    set('SoundfieldGroupLabelSubDescriptor', {
      InterchangeObject_InstanceUID: soundfieldId,
      MCALabelSubDescriptor_MCALabelDictionaryID: namedUl('DCAudioSoundfield_51'),
      MCALabelSubDescriptor_MCALinkID: uuid(14),
      MCALabelSubDescriptor_MCATagSymbol: utf16('sg51')
    }),
    set('AudioChannelLabelSubDescriptor', {
      InterchangeObject_InstanceUID: leftId,
      MCALabelSubDescriptor_MCALabelDictionaryID: namedUl('DCAudioChannel_L'),
      MCALabelSubDescriptor_MCALinkID: uuid(15),
      MCALabelSubDescriptor_MCATagSymbol: utf16('chL'),
      MCALabelSubDescriptor_MCAChannelID: u32(1),
      AudioChannelLabelSubDescriptor_SoundfieldGroupLinkID: wrongSoundfieldLinkId
    })
  ]);

  const descriptor = parsePcmDescriptor(header, { metadataGraph: buildMetadataGraph(header) });
  assert.equal(descriptor.audioChannels[0].programme, false);
  assert.ok(descriptor.issues.some(({ code }) => (
    code === 'mxf.pcm.mca-channel-group-link-mismatch'
  )));
});

test('PCM descriptor exposes the fixed 7.1 SDS channel assignment', () => {
  const header = metadata([set('WaveAudioDescriptor', {
    FileDescriptor_SampleRate: rational(24, 1),
    GenericSoundEssenceDescriptor_AudioSamplingRate: rational(48_000, 1),
    GenericSoundEssenceDescriptor_ChannelCount: u32(8),
    GenericSoundEssenceDescriptor_QuantizationBits: u32(24),
    WaveAudioDescriptor_BlockAlign: u16(24),
    WaveAudioDescriptor_AvgBps: u32(1_152_000),
    FileDescriptor_ContainerDuration: i64(240n),
    FileDescriptor_EssenceContainer: ul(0x01),
    WaveAudioDescriptor_ChannelAssignment: namedUl('DCAudioChannelCfg_3_7p1')
  })]);

  const descriptor = parsePcmDescriptor(header);
  assert.deepEqual(descriptor.audioChannels.map(({ role }) => role), [
    'L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lc', 'Rc'
  ]);
  assert.equal(descriptor.channelLayout.name, '7.1 SDS');
});

test('PCM descriptor identifies Wild Track Format without inventing channel roles', () => {
  const header = metadata([set('WaveAudioDescriptor', {
    FileDescriptor_SampleRate: rational(24, 1),
    GenericSoundEssenceDescriptor_AudioSamplingRate: rational(48_000, 1),
    GenericSoundEssenceDescriptor_ChannelCount: u32(8),
    GenericSoundEssenceDescriptor_QuantizationBits: u32(24),
    WaveAudioDescriptor_BlockAlign: u16(24),
    WaveAudioDescriptor_AvgBps: u32(1_152_000),
    FileDescriptor_ContainerDuration: i64(240n),
    FileDescriptor_EssenceContainer: ul(0x01),
    WaveAudioDescriptor_ChannelAssignment: namedUl('DCAudioChannelCfg_4_WTF')
  })]);

  const descriptor = parsePcmDescriptor(header);
  assert.equal(descriptor.channelFormat, 4);
  assert.deepEqual(descriptor.channelLayout, {
    source: 'channel-assignment',
    name: 'Wild Track Format',
    resolved: false
  });
  assert.deepEqual(descriptor.audioChannels.map(({ role, symbol, programme, source }) => ({
    role, symbol, programme, source
  })), Array.from({ length: 8 }, (_, index) => ({
    role: null,
    symbol: `CH${String(index + 1).padStart(2, '0')}`,
    programme: false,
    source: 'wild-track-format'
  })));
  assert.deepEqual(descriptor.issues, []);
});

test('MPEG-2 descriptor decodes CDCI and coding properties', () => {
  const header = metadata([
    set('MPEG2VideoDescriptor', {
      FileDescriptor_SampleRate: rational(24, 1),
      FileDescriptor_ContainerDuration: i64(120n),
      GenericPictureEssenceDescriptor_FrameLayout: u8(0),
      GenericPictureEssenceDescriptor_StoredWidth: u32(1998),
      GenericPictureEssenceDescriptor_StoredHeight: u32(1080),
      GenericPictureEssenceDescriptor_AspectRatio: rational(1998, 1080),
      GenericPictureEssenceDescriptor_PictureEssenceCoding: ul(0x21),
      CDCIEssenceDescriptor_ComponentDepth: u32(10),
      CDCIEssenceDescriptor_HorizontalSubsampling: u32(2),
      CDCIEssenceDescriptor_VerticalSubsampling: u32(1),
      CDCIEssenceDescriptor_ColorSiting: u8(0),
      MPEG2VideoDescriptor_CodedContentType: u8(1),
      MPEG2VideoDescriptor_LowDelay: u8(1),
      MPEG2VideoDescriptor_BitRate: u32(50_000_000),
      MPEG2VideoDescriptor_ProfileAndLevel: u8(0x82)
    })
  ]);

  assert.deepEqual(parseMpeg2Descriptor(header), {
    type: 'mpeg-2',
    sampleRate: { numerator: 24, denominator: 1 },
    frameLayout: 0,
    storedWidth: 1998,
    storedHeight: 1080,
    aspectRatio: { numerator: 1998, denominator: 1080 },
    pictureEssenceCodingUl: '060e2b34040101010401020203010121',
    componentDepth: 10,
    horizontalSubsampling: 2,
    verticalSubsampling: 1,
    colorSiting: 0,
    codedContentType: 1,
    lowDelay: true,
    bitRate: 50_000_000,
    profileAndLevel: 0x82,
    containerDuration: 120n
  });
});

test('JPEG 2000 descriptor accepts an omitted optional quantization replica', () => {
  const header = metadata([
    set('RGBAEssenceDescriptor', {
      FileDescriptor_SampleRate: rational(24, 1),
      FileDescriptor_ContainerDuration: i64(24n),
      GenericPictureEssenceDescriptor_StoredWidth: u32(2048),
      GenericPictureEssenceDescriptor_StoredHeight: u32(1080),
      GenericPictureEssenceDescriptor_AspectRatio: rational(2048, 1080),
      GenericPictureEssenceDescriptor_TransferCharacteristic: ul(0x84),
      RGBAEssenceDescriptor_ComponentMinRef: u32(0),
      RGBAEssenceDescriptor_ComponentMaxRef: u32(4095),
      GenericPictureEssenceDescriptor_PictureEssenceCoding: ul(0x03)
    }),
    set('JPEG2000PictureSubDescriptor', {
      JPEG2000PictureSubDescriptor_Rsize: u16(3),
      JPEG2000PictureSubDescriptor_Xsize: u32(2048),
      JPEG2000PictureSubDescriptor_Ysize: u32(1080),
      JPEG2000PictureSubDescriptor_XOsize: u32(0),
      JPEG2000PictureSubDescriptor_YOsize: u32(0),
      JPEG2000PictureSubDescriptor_XTsize: u32(2048),
      JPEG2000PictureSubDescriptor_YTsize: u32(1080),
      JPEG2000PictureSubDescriptor_XTOsize: u32(0),
      JPEG2000PictureSubDescriptor_YTOsize: u32(0),
      JPEG2000PictureSubDescriptor_Csize: u16(3),
      JPEG2000PictureSubDescriptor_PictureComponentSizing: Uint8Array.of(
        0, 0, 0, 3, 0, 0, 0, 3,
        11, 1, 1, 11, 1, 1, 11, 1, 1
      ),
      JPEG2000PictureSubDescriptor_CodingStyleDefault: Uint8Array.of(
        1, 4, 0, 1, 1, 5, 3, 3, 0, 0, 0x77, 0x88, 0x88, 0x88, 0x88, 0x88
      )
    })
  ]);

  const descriptor = parseJpeg2000Descriptor(header);
  assert.equal(descriptor.codingStyle.decompositionLevels, 5);
  assert.equal(descriptor.quantization, null);
  assert.equal(descriptor.storedWidth, 2048);
  assert.equal(descriptor.componentCount, 3);
  assert.equal(descriptor.transferCharacteristicUl, '060e2b34040101010401020203010184');
  assert.equal(descriptor.componentMinRef, 0);
  assert.equal(descriptor.componentMaxRef, 4095);
});

test('JPEG 2000 descriptor accepts omitted optional coding-style and quantization replicas', () => {
  const header = metadata([
    set('RGBAEssenceDescriptor', {
      FileDescriptor_SampleRate: rational(24, 1),
      FileDescriptor_ContainerDuration: i64(24n),
      GenericPictureEssenceDescriptor_StoredWidth: u32(1998),
      GenericPictureEssenceDescriptor_StoredHeight: u32(1080),
      GenericPictureEssenceDescriptor_AspectRatio: rational(1998, 1080),
      GenericPictureEssenceDescriptor_PictureEssenceCoding: ul(0x03)
    }),
    set('JPEG2000PictureSubDescriptor', {
      JPEG2000PictureSubDescriptor_Rsize: u16(3),
      JPEG2000PictureSubDescriptor_Xsize: u32(1998),
      JPEG2000PictureSubDescriptor_Ysize: u32(1080),
      JPEG2000PictureSubDescriptor_XOsize: u32(0),
      JPEG2000PictureSubDescriptor_YOsize: u32(0),
      JPEG2000PictureSubDescriptor_XTsize: u32(1998),
      JPEG2000PictureSubDescriptor_YTsize: u32(1080),
      JPEG2000PictureSubDescriptor_XTOsize: u32(0),
      JPEG2000PictureSubDescriptor_YTOsize: u32(0),
      JPEG2000PictureSubDescriptor_Csize: u16(3),
      JPEG2000PictureSubDescriptor_PictureComponentSizing: Uint8Array.of(
        0, 0, 0, 3, 0, 0, 0, 3,
        11, 1, 1, 11, 1, 1, 11, 1, 1
      )
    })
  ]);

  const descriptor = parseJpeg2000Descriptor(header);
  assert.equal(descriptor.codingStyle, null);
  assert.equal(descriptor.quantization, null);
  assert.equal(descriptor.storedWidth, 1998);
  assert.equal(descriptor.componentCount, 3);
  assert.equal(descriptor.transferCharacteristicUl, null);
  assert.equal(descriptor.componentMinRef, null);
  assert.equal(descriptor.componentMaxRef, null);
});

test('timed-text descriptor aggregates ancillary resources', () => {
  const asset = uuid(1);
  const resource = uuid(2);
  const header = metadata([
    set('TimedTextDescriptor', {
      FileDescriptor_SampleRate: rational(24, 1),
      FileDescriptor_ContainerDuration: i64(240n),
      TimedTextDescriptor_ResourceID: asset,
      GenericDataEssenceDescriptor_DataEssenceCoding: ul(0x31),
      TimedTextDescriptor_UCSEncoding: utf16('UTF-8'),
      TimedTextDescriptor_NamespaceURI: utf16('http://www.smpte-ra.org/schemas/428-7/2014/DCST'),
      TimedTextDescriptor_RFC5646LanguageTagList: utf16('en-US')
    }),
    set('TimedTextResourceSubDescriptor', {
      TimedTextResourceSubDescriptor_AncillaryResourceID: resource,
      TimedTextResourceSubDescriptor_MIMEMediaType: utf16('image/png'),
      TimedTextResourceSubDescriptor_EssenceStreamID: u32(7)
    })
  ]);

  const descriptor = parseTimedTextDescriptor(header);
  assert.equal(descriptor.type, 'timed-text');
  assert.equal(descriptor.assetId, '01010101-0101-0101-0101-010101010101');
  assert.equal(descriptor.rfc5646LanguageTagList, 'en-US');
  assert.equal(descriptor.dataEssenceCodingUl, '060e2b34040101010401020203010131');
  assert.deepEqual(descriptor.resources, [{
    resourceId: '02020202-0202-0202-0202-020202020202',
    mediaType: 'image/png',
    essenceStreamId: 7
  }]);
});

test('generic data and Atmos descriptors remain distinct', () => {
  const coding = Uint8Array.of(0x06, 0x0e, 0x2b, 0x34, 4, 1, 1, 5, 0x0e, 9, 6, 4, 0, 0, 0, 0);
  const atmos = set('DolbyAtmosSubDescriptor', {
    DolbyAtmosSubDescriptor_AtmosVersion: u8(1),
    DolbyAtmosSubDescriptor_MaxChannelCount: u16(128),
    DolbyAtmosSubDescriptor_MaxObjectCount: u16(118),
    DolbyAtmosSubDescriptor_AtmosID: uuid(3),
    DolbyAtmosSubDescriptor_FirstFrame: u32(12)
  });
  addUlItem(atmos, '060e2b340101010e040203010f000000', rational(48_000, 1));
  const header = metadata([
    set('PrivateDCDataDescriptor', {
      FileDescriptor_SampleRate: rational(24, 1),
      FileDescriptor_LinkedTrackID: u32(2),
      FileDescriptor_ContainerDuration: i64(48n),
      FileDescriptor_EssenceContainer: namedUl('PrivateDCDataWrappingFrame'),
      GenericDataEssenceDescriptor_DataEssenceCoding: coding
    }),
    atmos
  ]);

  assert.equal(parseGenericDataDescriptor(header).type, 'd-cinema-generic-data');
  assert.deepEqual(parseAtmosDescriptor(header), {
    type: 'dolby-atmos',
    editRate: { numerator: 24, denominator: 1 },
    linkedTrackId: 2,
    containerDuration: 48n,
    essenceContainerUl: mdd('PrivateDCDataWrappingFrame').ulHex,
    dataEssenceCodingUl: '060e2b34040101050e09060400000000',
    family: 'immersive-audio',
    standard: 'SMPTE ST 429-18',
    wrapping: 'frame',
    descriptorSet: 'PrivateDCDataDescriptor',
    subDescriptorSet: 'DolbyAtmosSubDescriptor',
    immersiveAudioVersion: 1,
    immersiveAudioId: '03030303-0303-0303-0303-030303030303',
    atmosVersion: 1,
    maxChannelCount: 128,
    maxObjectCount: 118,
    atmosId: '03030303-0303-0303-0303-030303030303',
    firstFrame: 12,
    iabSampleRate: { numerator: 48_000, denominator: 1 }
  });
  const graph = buildMetadataGraph(header);
  assert.deepEqual(
    graph.objects.find(({ type }) => type === 'DolbyAtmosSubDescriptor')
      .properties.ImmersiveAudioDataEssenceSubDescriptor_IABSampleRate.value,
    { numerator: 48_000, denominator: 1 }
  );
});

test('ST 429-18 immersive-audio metadata remains readable when optional fields are absent', () => {
  const descriptor = parseAtmosDescriptor(metadata([
    set('PrivateDCDataDescriptor', {
      FileDescriptor_SampleRate: rational(24, 1),
      FileDescriptor_ContainerDuration: i64(48n),
      GenericDataEssenceDescriptor_DataEssenceCoding: namedUl('ImmersiveAudioCoding')
    }),
    set('DolbyAtmosSubDescriptor', {})
  ]));

  assert.equal(descriptor.immersiveAudioVersion, null);
  assert.equal(descriptor.maxChannelCount, null);
  assert.equal(descriptor.maxObjectCount, null);
  assert.equal(descriptor.immersiveAudioId, null);
  assert.equal(descriptor.firstFrame, null);
  assert.equal(descriptor.iabSampleRate, null);
});

test('ST 2067-201 IAB descriptors expose sound and soundfield metadata', () => {
  const conforms = namedUl('IMF_IABTrackFileLevel0');
  const header = metadata([
    set('Preface', {
      Preface_ConformsToSpecifications: ulBatch([conforms])
    }),
    set('IABEssenceDescriptor', {
      FileDescriptor_SampleRate: rational(24, 1),
      FileDescriptor_LinkedTrackID: u32(2),
      FileDescriptor_ContainerDuration: i64(240n),
      FileDescriptor_EssenceContainer: namedUl('IMF_IABEssenceClipWrappedContainer'),
      GenericSoundEssenceDescriptor_AudioSamplingRate: rational(48_000, 1),
      GenericSoundEssenceDescriptor_ChannelCount: u32(0),
      GenericSoundEssenceDescriptor_QuantizationBits: u32(24),
      GenericSoundEssenceDescriptor_SoundEssenceCoding: namedUl('ImmersiveAudioCoding'),
      GenericSoundEssenceDescriptor_ReferenceImageEditRate: rational(24, 1),
      GenericSoundEssenceDescriptor_ReferenceAudioAlignmentLevel: u8(4)
    }),
    set('IABSoundfieldLabelSubDescriptor', {
      MCALabelSubDescriptor_MCALabelDictionaryID: namedUl('IABSoundfield'),
      MCALabelSubDescriptor_MCALinkID: uuid(4),
      MCALabelSubDescriptor_MCATagSymbol: utf16('IAB'),
      MCALabelSubDescriptor_MCATagName: utf16('IAB'),
      MCALabelSubDescriptor_RFC5646SpokenLanguage: ascii('en'),
      MCALabelSubDescriptor_MCAAudioContentKind: utf16('PRM'),
      MCALabelSubDescriptor_MCAAudioElementKind: utf16('FCMP'),
      MCALabelSubDescriptor_MCATitle: utf16('Feature'),
      MCALabelSubDescriptor_MCATitleVersion: utf16('OV')
    })
  ]);

  assert.deepEqual(parseIabDescriptor(header), {
    type: 'iab',
    family: 'immersive-audio',
    standard: 'SMPTE ST 2067-201',
    wrapping: 'clip',
    descriptorSet: 'IABEssenceDescriptor',
    subDescriptorSet: 'IABSoundfieldLabelSubDescriptor',
    editRate: { numerator: 24, denominator: 1 },
    linkedTrackId: 2,
    containerDuration: 240n,
    essenceContainerUl: mdd('IMF_IABEssenceClipWrappedContainer').ulHex,
    audioSamplingRate: { numerator: 48_000, denominator: 1 },
    channelCount: 0,
    quantizationBits: 24,
    soundEssenceCodingUl: mdd('ImmersiveAudioCoding').ulHex,
    referenceImageEditRate: { numerator: 24, denominator: 1 },
    referenceAudioAlignmentLevel: 4,
    conformsToSpecifications: [mdd('IMF_IABTrackFileLevel0').ulHex],
    soundfield: {
      dictionaryIdUl: mdd('IABSoundfield').ulHex,
      linkId: '04040404-0404-0404-0404-040404040404',
      tagSymbol: 'IAB',
      tagName: 'IAB',
      spokenLanguage: 'en',
      audioContentKind: 'PRM',
      audioElementKind: 'FCMP',
      title: 'Feature',
      titleVersion: 'OV'
    }
  });
});

function metadata(localSets) {
  return { localSets };
}

function set(type, properties) {
  const dictionaryEntry = mdd(type);
  const items = Object.entries(properties).map(([name, bytes]) => {
    const entry = mdd(name);
    return { tag: entry.tag, ulHex: entry.ulHex, dictionaryEntry: entry, value: bytes };
  });
  return {
    keyHex: dictionaryEntry.ulHex,
    dictionaryEntry,
    localSet: {
      items,
      byTag: new Map(items.map((item) => [item.tag, item])),
      byUl: new Map(items.map((item) => [item.ulHex, item]))
    }
  };
}

function addUlItem(packet, ulHex, bytes) {
  const item = { tag: 0xfff0, ulHex, dictionaryEntry: null, value: bytes };
  packet.localSet.items.push(item);
  packet.localSet.byTag.set(item.tag, item);
  packet.localSet.byUl.set(item.ulHex, item);
}

function u8(value) {
  return Uint8Array.of(value);
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, false);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function i64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, false);
  return bytes;
}

function rational(numerator, denominator) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, numerator, false);
  view.setInt32(4, denominator, false);
  return bytes;
}

function utf16(value) {
  const bytes = new Uint8Array(value.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), false);
  }
  return bytes;
}

function uuid(byte) {
  return new Uint8Array(16).fill(byte);
}

function uuidBatch(values) {
  return Uint8Array.of(
    0, 0, 0, values.length,
    0, 0, 0, 16,
    ...values.flatMap((value) => Array.from(value))
  );
}

function ulBatch(values) {
  return Uint8Array.of(
    0, 0, 0, values.length,
    0, 0, 0, 16,
    ...values.flatMap((value) => Array.from(value))
  );
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function namedUl(name) {
  return Uint8Array.from(mdd(name).ulHex.match(/../gu), (byte) => Number.parseInt(byte, 16));
}

function ul(lastByte) {
  return Uint8Array.of(0x06, 0x0e, 0x2b, 0x34, 4, 1, 1, 1, 4, 1, 2, 2, 3, 1, 1, lastByte);
}

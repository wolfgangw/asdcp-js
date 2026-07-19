// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAtmosDescriptor,
  parseGenericDataDescriptor,
  parseJpeg2000Descriptor,
  parseMpeg2Descriptor,
  parseTimedTextDescriptor
} from '../../src/asdcp/descriptors.js';
import { mdd } from '../../src/mxf/dictionary.js';

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
  const header = metadata([
    set('PrivateDCDataDescriptor', {
      FileDescriptor_SampleRate: rational(24, 1),
      FileDescriptor_ContainerDuration: i64(48n),
      GenericDataEssenceDescriptor_DataEssenceCoding: coding
    }),
    set('DolbyAtmosSubDescriptor', {
      DolbyAtmosSubDescriptor_AtmosVersion: u8(1),
      DolbyAtmosSubDescriptor_MaxChannelCount: u16(128),
      DolbyAtmosSubDescriptor_MaxObjectCount: u16(118),
      DolbyAtmosSubDescriptor_AtmosID: uuid(3),
      DolbyAtmosSubDescriptor_FirstFrame: u32(12)
    })
  ]);

  assert.equal(parseGenericDataDescriptor(header).type, 'd-cinema-generic-data');
  assert.deepEqual(parseAtmosDescriptor(header), {
    type: 'dolby-atmos',
    editRate: { numerator: 24, denominator: 1 },
    containerDuration: 48n,
    dataEssenceCodingUl: '060e2b34040101050e09060400000000',
    atmosVersion: 1,
    maxChannelCount: 128,
    maxObjectCount: 118,
    atmosId: '03030303-0303-0303-0303-030303030303',
    firstFrame: 12
  });
});

function metadata(localSets) {
  return { localSets };
}

function set(type, properties) {
  const items = Object.entries(properties).map(([name, bytes]) => {
    const entry = mdd(name);
    return { tag: entry.tag, ulHex: entry.ulHex, dictionaryEntry: entry, value: bytes };
  });
  return {
    keyHex: mdd(type).ulHex,
    localSet: {
      items,
      byTag: new Map(items.map((item) => [item.tag, item])),
      byUl: new Map(items.map((item) => [item.ulHex, item]))
    }
  };
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

function ul(lastByte) {
  return Uint8Array.of(0x06, 0x0e, 0x2b, 0x34, 4, 1, 1, 1, 4, 1, 2, 2, 3, 1, 1, lastByte);
}

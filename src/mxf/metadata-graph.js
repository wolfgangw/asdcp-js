// SPDX-License-Identifier: BSD-3-Clause

import { ByteReader } from '../binary/byte-reader.js';
import { formatUuid, toHex } from '../binary/identifiers.js';

const TYPES = new Map(Object.entries({
  InterchangeObject_InstanceUID: 'uuid',
  Preface_LastModifiedDate: 'timestamp',
  Preface_Version: 'uint16',
  Preface_ObjectModelVersion: 'uint32',
  Preface_PrimaryPackage: 'strongReference',
  Preface_Identifications: 'strongReferenceBatch',
  Preface_ContentStorage: 'strongReference',
  Preface_OperationalPattern: 'ul',
  OperationalPattern: 'ul',
  Preface_EssenceContainers: 'ulBatch',
  EssenceContainers: 'ulBatch',
  Preface_DMSchemes: 'ulBatch',
  Identification_ThisGenerationUID: 'uuid',
  Identification_CompanyName: 'utf16',
  Identification_ProductName: 'utf16',
  Identification_ProductVersion: 'version',
  Identification_VersionString: 'utf16',
  Identification_ProductUID: 'uuid',
  Identification_ModificationDate: 'timestamp',
  Identification_ToolkitVersion: 'version',
  Identification_Platform: 'utf16',
  ContentStorage_Packages: 'strongReferenceBatch',
  ContentStorage_EssenceContainerData: 'strongReferenceBatch',
  EssenceContainerData_LinkedPackageUID: 'umid',
  EssenceContainerData_IndexSID: 'uint32',
  IndexSID: 'uint32',
  EssenceContainerData_BodySID: 'uint32',
  BodySID: 'uint32',
  GenericPackage_PackageUID: 'umid',
  GenericPackage_Name: 'utf16',
  GenericPackage_PackageCreationDate: 'timestamp',
  GenericPackage_PackageModifiedDate: 'timestamp',
  GenericPackage_Tracks: 'strongReferenceBatch',
  SourcePackage_Descriptor: 'strongReference',
  GenericTrack_TrackID: 'uint32',
  GenericTrack_TrackNumber: 'uint32',
  GenericTrack_TrackName: 'utf16',
  GenericTrack_Sequence: 'strongReference',
  Track_EditRate: 'rational',
  Track_Origin: 'int64',
  StructuralComponent_DataDefinition: 'ul',
  StructuralComponent_Duration: 'int64',
  Sequence_StructuralComponents: 'strongReferenceBatch',
  TimecodeComponent_RoundedTimecodeBase: 'uint16',
  TimecodeComponent_StartTimecode: 'int64',
  TimecodeComponent_DropFrame: 'uint8',
  SourceClip_StartPosition: 'int64',
  SourceClip_SourcePackageID: 'umid',
  SourceClip_SourceTrackID: 'uint32',
  DMSegment_EventStartPosition: 'int64',
  DMSegment_EventComment: 'utf16',
  DMSegment_DMFramework: 'strongReference',
  CryptographicFramework_ContextSR: 'strongReference',
  CryptographicContext_ContextID: 'uuid',
  CryptographicContext_SourceEssenceContainer: 'ul',
  CryptographicContext_CipherAlgorithm: 'ul',
  CryptographicContext_MICAlgorithm: 'ul',
  CryptographicContext_CryptographicKeyID: 'uuid',
  GenericDescriptor_SubDescriptors: 'strongReferenceBatch',
  MXFInterop_GenericDescriptor_SubDescriptors: 'strongReferenceBatch',
  FileDescriptor_LinkedTrackID: 'uint32',
  FileDescriptor_SampleRate: 'rational',
  FileDescriptor_ContainerDuration: 'int64',
  FileDescriptor_EssenceContainer: 'ul',
  GenericPictureEssenceDescriptor_FrameLayout: 'uint8',
  GenericPictureEssenceDescriptor_StoredWidth: 'uint32',
  GenericPictureEssenceDescriptor_StoredHeight: 'uint32',
  GenericPictureEssenceDescriptor_VideoLineMap: 'uint32Batch',
  GenericPictureEssenceDescriptor_AspectRatio: 'rational',
  GenericPictureEssenceDescriptor_TransferCharacteristic: 'ul',
  GenericPictureEssenceDescriptor_PictureEssenceCoding: 'ul',
  CDCIEssenceDescriptor_ComponentDepth: 'uint32',
  CDCIEssenceDescriptor_HorizontalSubsampling: 'uint32',
  CDCIEssenceDescriptor_VerticalSubsampling: 'uint32',
  CDCIEssenceDescriptor_ColorSiting: 'uint8',
  MPEG2VideoDescriptor_SingleSequence: 'uint8',
  MPEG2VideoDescriptor_ConstantBFrames: 'uint8',
  MPEG2VideoDescriptor_CodedContentType: 'uint8',
  MPEG2VideoDescriptor_LowDelay: 'uint8',
  MPEG2VideoDescriptor_ClosedGOP: 'uint8',
  MPEG2VideoDescriptor_IdenticalGOP: 'uint8',
  MPEG2VideoDescriptor_MaxGOP: 'uint8',
  MPEG2VideoDescriptor_BPictureCount: 'uint8',
  MPEG2VideoDescriptor_BitRate: 'uint32',
  MPEG2VideoDescriptor_ProfileAndLevel: 'uint8',
  RGBAEssenceDescriptor_ComponentMaxRef: 'uint32',
  RGBAEssenceDescriptor_ComponentMinRef: 'uint32',
  RGBAEssenceDescriptor_PixelLayout: 'raw',
  GenericSoundEssenceDescriptor_AudioSamplingRate: 'rational',
  GenericSoundEssenceDescriptor_Locked: 'uint8',
  GenericSoundEssenceDescriptor_AudioRefLevel: 'uint8',
  GenericSoundEssenceDescriptor_DialNorm: 'uint8',
  GenericSoundEssenceDescriptor_ChannelCount: 'uint32',
  GenericSoundEssenceDescriptor_QuantizationBits: 'uint32',
  GenericSoundEssenceDescriptor_SoundEssenceCoding: 'ul',
  GenericSoundEssenceDescriptor_ReferenceImageEditRate: 'rational',
  GenericSoundEssenceDescriptor_ReferenceAudioAlignmentLevel: 'uint8',
  WaveAudioDescriptor_BlockAlign: 'uint16',
  WaveAudioDescriptor_AvgBps: 'uint32',
  WaveAudioDescriptor_SequenceOffset: 'uint8',
  WaveAudioDescriptor_ChannelAssignment: 'ul',
  MCALabelSubDescriptor_MCALabelDictionaryID: 'ul',
  MCALabelSubDescriptor_MCALinkID: 'uuid',
  MCALabelSubDescriptor_MCATagSymbol: 'utf16',
  MCALabelSubDescriptor_MCATagName: 'utf16',
  MCALabelSubDescriptor_MCAChannelID: 'uint32',
  MCALabelSubDescriptor_RFC5646SpokenLanguage: 'utf8',
  MCALabelSubDescriptor_MCATitle: 'utf16',
  MCALabelSubDescriptor_MCATitleVersion: 'utf16',
  MCALabelSubDescriptor_MCATitleSubVersion: 'utf16',
  MCALabelSubDescriptor_MCAAudioContentKind: 'utf16',
  MCALabelSubDescriptor_MCAAudioElementKind: 'utf16',
  AudioChannelLabelSubDescriptor_SoundfieldGroupLinkID: 'uuid',
  SoundfieldGroupLabelSubDescriptor_GroupOfSoundfieldGroupsLinkID: 'uuidBatch',
  GenericDataEssenceDescriptor_DataEssenceCoding: 'ul',
  TimedTextDescriptor_ResourceID: 'uuid',
  TimedTextDescriptor_UCSEncoding: 'utf16',
  TimedTextDescriptor_NamespaceURI: 'utf16',
  TimedTextDescriptor_RFC5646LanguageTagList: 'utf16',
  TimedTextDescriptor_DisplayType: 'utf16',
  TimedTextDescriptor_IntrinsicPictureResolution: 'utf16',
  TimedTextDescriptor_ZPositionInUse: 'uint8',
  TimedTextResourceSubDescriptor_AncillaryResourceID: 'uuid',
  TimedTextResourceSubDescriptor_MIMEMediaType: 'utf16',
  TimedTextResourceSubDescriptor_EssenceStreamID: 'uint32',
  DolbyAtmosSubDescriptor_AtmosVersion: 'uint8',
  DolbyAtmosSubDescriptor_MaxChannelCount: 'uint16',
  DolbyAtmosSubDescriptor_MaxObjectCount: 'uint16',
  DolbyAtmosSubDescriptor_AtmosID: 'uuid',
  DolbyAtmosSubDescriptor_FirstFrame: 'uint32',
  Preface_ConformsToSpecifications: 'ulBatch',
  JPEG2000PictureSubDescriptor_Rsize: 'uint16',
  JPEG2000PictureSubDescriptor_Xsize: 'uint32',
  JPEG2000PictureSubDescriptor_Ysize: 'uint32',
  JPEG2000PictureSubDescriptor_XOsize: 'uint32',
  JPEG2000PictureSubDescriptor_YOsize: 'uint32',
  JPEG2000PictureSubDescriptor_XTsize: 'uint32',
  JPEG2000PictureSubDescriptor_YTsize: 'uint32',
  JPEG2000PictureSubDescriptor_XTOsize: 'uint32',
  JPEG2000PictureSubDescriptor_YTOsize: 'uint32',
  JPEG2000PictureSubDescriptor_Csize: 'uint16',
  JPEG2000PictureSubDescriptor_PictureComponentSizing: 'raw',
  JPEG2000PictureSubDescriptor_CodingStyleDefault: 'raw',
  JPEG2000PictureSubDescriptor_QuantizationDefault: 'raw',
  JPEG2000PictureSubDescriptor_J2KExtendedCapabilities: 'j2kExtendedCapabilities'
}));

const SUPPLEMENTAL_PROPERTIES = new Map([
  ['060e2b340101010e040203010f000000', {
    name: 'ImmersiveAudioDataEssenceSubDescriptor_IABSampleRate',
    type: 'rational'
  }]
]);

const REFERENCE_TYPES = new Set(['strongReference', 'strongReferenceBatch']);

export class MetadataGraphError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MetadataGraphError';
    this.details = details;
  }
}

export function buildMetadataGraph(headerMetadata) {
  const objects = [];
  const byInstanceUid = new Map();
  const issues = [];

  for (const packet of headerMetadata.localSets) {
    const propertyList = packet.localSet.items.map((item) => decodeProperty(item, packet, issues));
    const properties = Object.fromEntries(propertyList.map((property) => [property.name, property]));
    const instanceUid = properties.InterchangeObject_InstanceUID?.value ?? null;
    const object = {
      type: packet.dictionaryEntry?.name ?? null,
      keyHex: packet.keyHex,
      offset: packet.fileOffset,
      length: packet.length,
      instanceUid,
      propertyList,
      properties,
      references: []
    };
    objects.push(object);
    if (!instanceUid) {
      issues.push({ code: 'mxf.metadata.instance-uid-missing', objectType: object.type, offset: object.offset });
    } else if (byInstanceUid.has(instanceUid)) {
      issues.push({ code: 'mxf.metadata.instance-uid-duplicate', instanceUid, objectType: object.type });
    } else {
      byInstanceUid.set(instanceUid, object);
    }
  }

  for (const object of objects) {
    for (const property of object.propertyList) {
      if (!REFERENCE_TYPES.has(property.type)) continue;
      const identifiers = property.type === 'strongReference' ? [property.value] : property.value;
      for (const identifier of identifiers) {
        const target = byInstanceUid.get(identifier) ?? null;
        const reference = { property: property.name, identifier, target };
        object.references.push(reference);
        if (!target) {
          issues.push({
            code: 'mxf.metadata.strong-reference-unresolved',
            objectType: object.type,
            instanceUid: object.instanceUid,
            property: property.name,
            target: identifier
          });
        }
      }
    }
  }

  return { objects, byInstanceUid, issues };
}

export function decodeMetadataValue(type, bytes) {
  const reader = new ByteReader(bytes);
  switch (type) {
    case 'raw': return { hex: toHex(bytes), byteLength: bytes.byteLength };
    case 'uint8': assertLength(bytes, 1, type); return reader.readUint8();
    case 'uint16': assertLength(bytes, 2, type); return reader.readUint16();
    case 'uint32': assertLength(bytes, 4, type); return reader.readUint32();
    case 'int64': assertLength(bytes, 8, type); return reader.readInt64();
    case 'rational':
      assertLength(bytes, 8, type);
      return { numerator: reader.readInt32(), denominator: reader.readInt32() };
    case 'uuid':
    case 'strongReference':
      assertLength(bytes, 16, type);
      return formatUuid(bytes);
    case 'ul':
      assertLength(bytes, 16, type);
      return { hex: toHex(bytes), urn: `urn:smpte:ul:${formatUlHex(bytes)}` };
    case 'umid': return decodeUmid(bytes);
    case 'utf16':
      if (bytes.byteLength % 2 !== 0) throw new MetadataGraphError('UTF-16 value has an odd byte length');
      return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/u, '');
    case 'utf8': return new TextDecoder().decode(bytes).replace(/\0+$/u, '');
    case 'timestamp': return decodeTimestamp(bytes);
    case 'version': return decodeVersion(bytes);
    case 'strongReferenceBatch': return decodeBatch(bytes, 16, (value) => formatUuid(value));
    case 'uuidBatch': return decodeBatch(bytes, 16, (value) => formatUuid(value));
    case 'ulBatch': return decodeBatch(bytes, 16, (value) => ({
      hex: toHex(value),
      urn: `urn:smpte:ul:${formatUlHex(value)}`
    }));
    case 'uint32Batch': return decodeBatch(bytes, 4, (value) => new ByteReader(value).readUint32());
    case 'j2kExtendedCapabilities': return decodeJ2kExtendedCapabilities(bytes);
    default: throw new MetadataGraphError(`Unsupported metadata value type: ${type}`);
  }
}

function decodeJ2kExtendedCapabilities(bytes) {
  const reader = new ByteReader(bytes);
  if (reader.remaining < 12) throw new MetadataGraphError('J2KExtendedCapabilities is truncated');
  const pcap = reader.readUint32();
  const count = reader.readUint32();
  const itemSize = reader.readUint32();
  if (count > 0 && itemSize !== 2) throw new MetadataGraphError('J2K Ccap item size is not 2');
  if (reader.remaining !== count * itemSize) throw new MetadataGraphError('J2K Ccap batch length is inconsistent');
  return { pcap, capabilities: Array.from({ length: count }, () => reader.readUint16()) };
}

function decodeProperty(item, packet, issues) {
  const supplemental = item.ulHex ? SUPPLEMENTAL_PROPERTIES.get(item.ulHex) : null;
  const name = item.dictionaryEntry?.name ?? supplemental?.name ??
    `Unknown_0x${item.tag.toString(16).padStart(4, '0')}`;
  const type = supplemental?.type ?? TYPES.get(name) ?? 'raw';
  try {
    return { name, type, value: decodeMetadataValue(type, item.value), item };
  } catch (error) {
    issues.push({
      code: 'mxf.metadata.property-decode-failed',
      objectType: packet.dictionaryEntry?.name ?? null,
      property: name,
      message: error.message
    });
    return { name, type: 'raw', value: decodeMetadataValue('raw', item.value), item, error };
  }
}

function decodeBatch(bytes, expectedItemSize, decodeItem) {
  const reader = new ByteReader(bytes);
  if (reader.remaining < 8) throw new MetadataGraphError('Metadata batch header is truncated');
  const count = reader.readUint32();
  const itemSize = reader.readUint32();
  if (count > 0 && itemSize !== expectedItemSize) {
    throw new MetadataGraphError('Metadata batch has an unexpected item size', {
      count,
      itemSize,
      expectedItemSize
    });
  }
  if (BigInt(count) * BigInt(itemSize) !== BigInt(reader.remaining)) {
    throw new MetadataGraphError('Metadata batch size does not match its value length');
  }
  return Array.from({ length: count }, () => decodeItem(reader.readBytes(itemSize, { copy: true })));
}

function decodeTimestamp(bytes) {
  assertLength(bytes, 8, 'timestamp');
  const reader = new ByteReader(bytes);
  const value = {
    year: reader.readUint16(),
    month: reader.readUint8(),
    day: reader.readUint8(),
    hour: reader.readUint8(),
    minute: reader.readUint8(),
    second: reader.readUint8(),
    tick: reader.readUint8()
  };
  value.iso = `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}+00:00`;
  return value;
}

function decodeVersion(bytes) {
  assertLength(bytes, 10, 'version');
  const reader = new ByteReader(bytes);
  const value = {
    major: reader.readUint16(),
    minor: reader.readUint16(),
    patch: reader.readUint16(),
    build: reader.readUint16(),
    release: reader.readUint16()
  };
  value.text = `${value.major}.${value.minor}.${value.patch}.${value.build}r${value.release}`;
  return value;
}

function decodeUmid(bytes) {
  assertLength(bytes, 32, 'umid');
  const hex = toHex(bytes);
  const value = {
    hex,
    label: hex.slice(0, 24),
    length: bytes[12],
    instance: bytes[13],
    materialType: bytes[14],
    materialNumber: bytes[15],
    material: hex.slice(32),
    assetUuid: formatUuid(bytes.subarray(16))
  };
  const prefix = `[${hex.slice(0, 8)}.${hex.slice(8, 16)}.${hex.slice(16, 24)}],` +
    `${hex.slice(24, 26)},${hex.slice(26, 28)},${hex.slice(28, 30)},${hex.slice(30, 32)},`;
  value.text = (bytes[8] & 0x80) === 0
    ? `${prefix}[${hex.slice(48, 56)}.${hex.slice(56, 64)}.${hex.slice(32, 40)}.${hex.slice(40, 48)}]`
    : `${prefix}{${value.assetUuid}}`;
  return value;
}

function formatUlHex(bytes) {
  const hex = toHex(bytes);
  return [0, 8, 16, 24].map((offset) => hex.slice(offset, offset + 8)).join('.');
}

function assertLength(bytes, expected, type) {
  if (bytes.byteLength !== expected) {
    throw new MetadataGraphError(`${type} value is ${bytes.byteLength} bytes, expected ${expected}`);
  }
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

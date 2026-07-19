// SPDX-License-Identifier: BSD-3-Clause

import { mdd } from '../mxf/dictionary.js';
import { formatUl } from '../binary/identifiers.js';

export function formatAsdcpInfo(inspected, {
  showIdentity = true,
  showHeader = false,
  showDescriptor = false,
  showCoding = false,
  showBitrate = false,
  showIndex = false
} = {}) {
  const { essence, writerInfo } = inspected ?? {};
  if (!essence || !writerInfo) throw new TypeError('inspected must be returned by inspectMxf');
  const count = essence.editUnitCount;
  if (count === null) throw new Error('MXF descriptor has no ContainerDuration');

  const prefix = writerInfo.labelSetType === 'SMPTE'
    ? 'SMPTE 429'
    : writerInfo.labelSetType === 'MXF Interop' ? 'Interop' : 'Unknown';
  const plural = count === 1n ? '' : 's';
  const lines = [`${prefix} file essence type is ${essence.description}, (${count} edit unit${plural}).`];

  if (showHeader) lines.push(...formatHeader(inspected));
  if (showIdentity) {
    lines.push(
      `       ProductUUID: ${writerInfo.productUuid}`,
      `    ProductVersion: ${writerInfo.productVersion}`,
      `       CompanyName: ${writerInfo.companyName}`,
      `       ProductName: ${writerInfo.productName}`,
      `  EncryptedEssence: ${writerInfo.encryptedEssence ? 'Yes' : 'No'}`
    );
    if (writerInfo.encryptedEssence) {
      lines.push(
        `              HMAC: ${writerInfo.hmac ? 'Yes' : 'No'}`,
        `         ContextID: ${writerInfo.crypto?.contextId ?? ''}`,
        `CryptographicKeyID: ${writerInfo.crypto?.cryptographicKeyId ?? ''}`
      );
    }
    lines.push(
      `         AssetUUID: ${writerInfo.assetUuid}`,
      `    Label Set Type: ${writerInfo.labelSetType}`
    );
  }
  if (showDescriptor) lines.push(...formatDescriptor(inspected.descriptor));
  if (showIndex) lines.push(...formatIndex(inspected));
  if (showCoding) lines.push(...formatCoding(inspected.descriptor));
  if (showBitrate) {
    if (!inspected.bitrate) throw new Error('Inspection has no bitrate data; use includeIndex');
    lines.push(
      `Max BitRate: ${inspected.bitrate.maximumMbps.toFixed(2)} Mb/s`,
      `Average BitRate: ${inspected.bitrate.averageMbps.toFixed(2)} Mb/s`
    );
  }
  return `${lines.join('\n')}\n`;
}

function formatHeader(inspected) {
  if (!inspected.headerMetadata || !inspected.metadataGraph || !inspected.structure?.headerPartition) {
    throw new Error('Inspection has no typed header metadata');
  }
  const lines = [...formatPartition(
    inspected.structure.headerPartition,
    inspected.writerInfo.labelSetType === 'SMPTE'
      ? inspected.structure.bodyPartitions[0]?.klv.endOffset
      : inspected.structure.headerPartition.klv.endOffset + inspected.structure.headerPartition.headerByteCount
  )];
  const primerPacket = inspected.headerMetadata.packets.find((packet) => packet.kind === 'primer');
  if (!primerPacket) throw new Error('Inspection header has no Primer Pack');
  lines.push(
    `${formatUl(primerPacket.key)}  len: ${String(primerPacket.length).padStart(7)} (Primer)`,
    `Primer: ${primerPacket.primer.count} entries`
  );
  for (const entry of [...primerPacket.primer.entries].sort((left, right) => left.tag - right.tag)) {
    const tag = entry.tag.toString(16).padStart(4, '0');
    const nativeName = entry.tag === 0xfff9 &&
      entry.ulHex === mdd('GenericDescriptor_SubDescriptors').ulHex
      ? 'MXFInterop_GenericDescriptor_SubDescriptors'
      : entry.dictionaryEntry?.name ?? 'Unknown';
    lines.push(`  ${tag.slice(0, 2)} ${tag.slice(2)}: ${formatUl(entry.ul)} ${nativeName}`);
  }

  for (const object of inspected.metadataGraph.objects) {
    lines.push('', `${formatUlHex(object.keyHex)}  len: ${String(object.length).padStart(7)} (${object.type ?? 'Unknown'})`);
    const propertyLines = formatMetadataObject(object);
    lines.push(...propertyLines);
  }
  return lines;
}

function formatMetadataObject(object) {
  const lines = [];
  const properties = object.propertyList.filter((property) =>
    !(object.type === 'Preface' && property.name === 'Preface_PrimaryPackage'));
  if (object.type === 'WaveAudioDescriptor' &&
      !properties.some((property) => property.name === 'GenericSoundEssenceDescriptor_SoundEssenceCoding')) {
    const blockAlignIndex = properties.findIndex((property) =>
      property.name === 'WaveAudioDescriptor_BlockAlign');
    properties.splice(blockAlignIndex < 0 ? properties.length : blockAlignIndex, 0, {
      name: 'GenericSoundEssenceDescriptor_SoundEssenceCoding',
      type: 'ul',
      value: { hex: '00000000000000000000000000000000' }
    });
  }
  if (['RGBAEssenceDescriptor', 'WaveAudioDescriptor'].includes(object.type)) {
    const instanceIndex = properties.findIndex((property) => property.name === 'InterchangeObject_InstanceUID');
    const prefix = instanceIndex >= 0 ? properties.splice(0, instanceIndex + 1) : [];
    lines.push(...prefix.flatMap(formatMetadataProperty));
    lines.push(`  ${'Locators'.padStart(22)}:`);
    const subDescriptorIndex = properties.findIndex((property) =>
      ['GenericDescriptor_SubDescriptors', 'MXFInterop_GenericDescriptor_SubDescriptors'].includes(property.name));
    if (subDescriptorIndex >= 0) {
      lines.push(...formatMetadataProperty(properties.splice(subDescriptorIndex, 1)[0]));
    } else {
      lines.push(`  ${'SubDescriptors'.padStart(22)}:`);
    }
  }
  if (object.type === 'DMSegment') {
    properties.sort((left, right) => metadataOrder(left.name) - metadataOrder(right.name));
  }
  if (object.type === 'RGBAEssenceDescriptor') {
    const order = [
      'FileDescriptor_LinkedTrackID',
      'FileDescriptor_SampleRate',
      'FileDescriptor_ContainerDuration',
      'FileDescriptor_EssenceContainer',
      'GenericPictureEssenceDescriptor_FrameLayout',
      'GenericPictureEssenceDescriptor_StoredWidth',
      'GenericPictureEssenceDescriptor_StoredHeight',
      'GenericPictureEssenceDescriptor_AspectRatio',
      'GenericPictureEssenceDescriptor_PictureEssenceCoding',
      'GenericPictureEssenceDescriptor_VideoLineMap',
      'RGBAEssenceDescriptor_ComponentMaxRef',
      'RGBAEssenceDescriptor_ComponentMinRef',
      'RGBAEssenceDescriptor_PixelLayout'
    ];
    properties.sort((left, right) => order.indexOf(left.name) - order.indexOf(right.name));
  }
  lines.push(...properties.flatMap(formatMetadataProperty));
  return lines;
}

function formatMetadataProperty(property) {
  const label = displayPropertyName(property.name);
  if (['strongReferenceBatch', 'ulBatch'].includes(property.type)) {
    const lines = [`  ${label.padStart(22)}:`];
    const sortedNames = new Set([
      'Preface_Identifications',
      'ContentStorage_Packages',
      'ContentStorage_EssenceContainerData'
    ]);
    const values = [...property.value];
    if (property.type === 'ulBatch' || sortedNames.has(property.name)) {
      values.sort((left, right) =>
        formatMetadataScalar(property.type, left).localeCompare(formatMetadataScalar(property.type, right)));
    }
    for (const value of values) lines.push(`  ${formatMetadataScalar(property.type, value)}`);
    return lines;
  }
  return [`  ${label.padStart(22)} = ${formatMetadataScalar(property.type, property.value, property.name)}`];
}

function formatMetadataScalar(type, value, name) {
  if (type === 'rational') return rational(value);
  if (type === 'timestamp') return value.iso;
  if (type === 'version') return value.text;
  if (type === 'ul' || type === 'ulBatch') return formatUlHex(value.hex);
  if (type === 'umid') return value.text;
  if (type === 'uint32Batch') return value.join(',');
  if (type === 'j2kExtendedCapabilities') {
    return value.pcap === 0 ? '' : value.capabilities.map((item) => item.toString(16).padStart(2, '0')).join('.');
  }
  if (type === 'raw') {
    if (name === 'RGBAEssenceDescriptor_PixelLayout' && value.hex.startsWith('00')) return '';
    return value.hex;
  }
  return String(value);
}

function displayPropertyName(name) {
  if (name === 'InterchangeObject_InstanceUID') return 'InstanceUID';
  if (name === 'MXFInterop_GenericDescriptor_SubDescriptors') return 'SubDescriptors';
  return name.slice(name.lastIndexOf('_') + 1);
}

function metadataOrder(name) {
  const order = [
    'InterchangeObject_InstanceUID',
    'StructuralComponent_DataDefinition',
    'StructuralComponent_Duration',
    'DMSegment_EventStartPosition',
    'DMSegment_EventComment',
    'DMSegment_DMFramework'
  ];
  const index = order.indexOf(name);
  return index < 0 ? order.length : index;
}

function formatIndex(inspected) {
  if (!inspected.footerIndex || !inspected.structure?.footerPartition) {
    throw new Error('Inspection has no index data; use includeIndex');
  }
  const lines = [...formatPartition(inspected.structure.footerPartition), ''];
  inspected.footerIndex.segments.forEach((segment, index) => {
    lines.push(
      `${formatUl(segment.klv.key)}  len: ${String(segment.klv.length).padStart(7)} (IndexTableSegment)`,
      `             InstanceUID = ${segment.instanceUid}`,
      `  IndexEditRate      = ${rational(segment.editRate)}`,
      `  IndexStartPosition = ${segment.indexStartPosition}`,
      `  IndexDuration      = ${segment.indexDuration}`,
      `  EditUnitByteCount  = ${segment.editUnitByteCount}`,
      `  IndexSID           = ${segment.indexSid}`,
      `  BodySID            = ${segment.bodySid}`,
      `  SliceCount         = ${segment.sliceCount}`,
      `  PosTableCount      = ${segment.posTableCount}`,
      '  DeltaEntryArray:'
    );
    for (const entry of segment.deltaEntries) {
      lines.push(`  ${String(entry.posTableIndex).padStart(3)} ${String(entry.slice).padEnd(3)} ${String(entry.elementData).padEnd(3)}`);
    }
    if (segment.indexEntries.length === 0) {
      lines.push('  IndexEntryArray: NO ENTRIES');
    } else if (segment.indexEntries.length < 1000) {
      lines.push('  IndexEntryArray:');
      for (const entry of segment.indexEntries) lines.push(formatIndexEntry(entry));
    } else {
      lines.push(`  IndexEntryArray: ${segment.indexEntries.length} entries`);
    }
    if (index < inspected.footerIndex.segments.length - 1) lines.push('');
  });
  return lines;
}

function formatPartition(partition, bodyOffset = partition.bodyOffset) {
  const lines = [
    `${formatUl(partition.key)}  len: ${String(partition.klv.length).padStart(7)} (${partition.name})`,
    `  MajorVersion       = ${partition.majorVersion}`,
    `  MinorVersion       = ${partition.minorVersion}`,
    `  KAGSize            = ${partition.kagSize}`,
    `  ThisPartition      = ${partition.thisPartition}`,
    `  PreviousPartition  = ${partition.previousPartition}`,
    `  FooterPartition    = ${partition.footerPartition}`,
    `  HeaderByteCount    = ${partition.headerByteCount}`,
    `  IndexByteCount     = ${partition.indexByteCount}`,
    `  IndexSID           = ${partition.indexSid}`,
    `  BodyOffset         = ${bodyOffset}`,
    `  BodySID            = ${partition.bodySid}`,
    `  OperationalPattern = ${formatUl(partition.operationalPattern)}`,
    'Essence Containers:'
  ];
  const containers = partition.essenceContainers
    .map((container) => formatUl(container.bytes))
    .sort((left, right) => left.localeCompare(right));
  for (const container of containers) lines.push(`  ${container}`);
  return lines;
}

function formatIndexEntry(entry) {
  const flags = [
    entry.flags & 0x80 ? 'r' : ' ',
    entry.flags & 0x40 ? 's' : ' ',
    entry.flags & 0x20 ? 'f' : ' ',
    entry.flags & 0x10 ? 'b' : ' ',
    (entry.flags & 0x0f) === 3 ? 'B' : (entry.flags & 0x0f) === 2 ? 'P' : 'I'
  ].join('');
  const keyFrameOffset = entry.keyFrameOffset < 0 ? entry.keyFrameOffset + 256 : entry.keyFrameOffset;
  return `  ${String(entry.temporalOffset).padStart(3)} ${String(keyFrameOffset).padEnd(3)} ${flags} ${entry.streamOffset}`;
}

function formatDescriptor(descriptor) {
  if (!descriptor) throw new Error('Inspection has no supported typed descriptor');
  if (descriptor.type === 'pcm') {
    return [
      `        EditRate: ${rational(descriptor.editRate)}`,
      ` AudioSamplingRate: ${rational(descriptor.audioSamplingRate)}`,
      `            Locked: ${descriptor.locked}`,
      `      ChannelCount: ${descriptor.channelCount}`,
      `  QuantizationBits: ${descriptor.quantizationBits}`,
      `        BlockAlign: ${descriptor.blockAlign}`,
      `            AvgBps: ${descriptor.averageBytesPerSecond}`,
      `     LinkedTrackID: ${descriptor.linkedTrackId}`,
      ` ContainerDuration: ${descriptor.containerDuration}`,
      `     ChannelFormat: ${descriptor.channelFormat}`
    ];
  }
  if (descriptor.type.startsWith('jpeg-2000')) {
    const lines = [
      `       AspectRatio: ${rational(descriptor.aspectRatio)}`,
      `          EditRate: ${rational(descriptor.editRate)}`,
      `        SampleRate: ${rational(descriptor.sampleRate)}`,
      `       StoredWidth: ${descriptor.storedWidth}`,
      `      StoredHeight: ${descriptor.storedHeight}`,
      `             Rsize: ${descriptor.rsize}`,
      `             Xsize: ${descriptor.xsize}`,
      `             Ysize: ${descriptor.ysize}`,
      `            XOsize: ${descriptor.xOrigin}`,
      `            YOsize: ${descriptor.yOrigin}`,
      `            XTsize: ${descriptor.tileWidth}`,
      `            YTsize: ${descriptor.tileHeight}`,
      `           XTOsize: ${descriptor.tileXOrigin}`,
      `           YTOsize: ${descriptor.tileYOrigin}`,
      ` ContainerDuration: ${descriptor.containerDuration}`,
      '-- JPEG 2000 Metadata --',
      '    ImageComponents:',
      '  bits  h-sep v-sep'
    ];
    for (const component of descriptor.components) {
      lines.push(`  ${String(component.bits).padStart(4)}  ${String(component.horizontalSeparation).padStart(5)} ${String(component.verticalSeparation).padStart(5)}`);
    }
    const style = descriptor.codingStyle;
    if (style) {
      lines.push(
        `               Scod: ${style.scod}`,
        `   ProgressionOrder: ${style.progressionOrder}`,
        `     NumberOfLayers: ${style.numberOfLayers}`,
        ` MultiCompTransform: ${style.multiComponentTransform}`,
        `DecompositionLevels: ${style.decompositionLevels}`,
        `     CodeblockWidth: ${style.codeblockWidth}`,
        `    CodeblockHeight: ${style.codeblockHeight}`,
        `     CodeblockStyle: ${style.codeblockStyle}`,
        `     Transformation: ${style.transformation}`,
        `          Precincts: ${style.precincts.length}`,
        'precinct dimensions:'
      );
      style.precincts.forEach((precinct, index) => {
        lines.push(`    ${index + 1}: ${precinct.width} x ${precinct.height}`);
      });
    }
    if (descriptor.quantization) {
      lines.push(
        `               Sqcd: ${descriptor.quantization.sqcd}`,
        `              SPqcd: ${descriptor.quantization.spqcdHex}`
      );
    }
    if (descriptor.extendedCapabilities) {
      lines.push(`Extended Capabilities: ${descriptor.extendedCapabilities.pcap.toString(16)}`);
      descriptor.extendedCapabilities.capabilities.forEach((capability, index) => {
        lines.push(`           Ccap(${index + 1}): ${capability.toString(16)}`);
      });
    }
    return lines;
  }
  if (descriptor.type === 'mpeg-2') {
    return [
      `        SampleRate: ${rational(descriptor.sampleRate)}`,
      `       FrameLayout: ${descriptor.frameLayout}`,
      `       StoredWidth: ${descriptor.storedWidth}`,
      `      StoredHeight: ${descriptor.storedHeight}`,
      `       AspectRatio: ${rational(descriptor.aspectRatio)}`,
      `    ComponentDepth: ${descriptor.componentDepth}`,
      ` HorizontalSubsmpl: ${descriptor.horizontalSubsampling}`,
      `   VerticalSubsmpl: ${descriptor.verticalSubsampling}`,
      `       ColorSiting: ${descriptor.colorSiting}`,
      `  CodedContentType: ${descriptor.codedContentType}`,
      `          LowDelay: ${descriptor.lowDelay ? 1 : 0}`,
      `           BitRate: ${descriptor.bitRate}`,
      `   ProfileAndLevel: ${descriptor.profileAndLevel}`,
      ` ContainerDuration: ${descriptor.containerDuration}`
    ];
  }
  if (descriptor.type === 'timed-text') {
    const lines = [
      `              EditRate: ${rational(descriptor.editRate)}`,
      `     ContainerDuration: ${descriptor.containerDuration}`,
      `               AssetID: ${descriptor.assetId}`,
      `         NamespaceName: ${descriptor.namespaceName}`,
      `         ResourceCount: ${descriptor.resources.length}`,
      `RFC5646LanguageTagList: ${descriptor.rfc5646LanguageTagList}`
    ];
    for (const resource of descriptor.resources) {
      lines.push(`    ${resource.resourceId}: ${normalizeTimedTextMediaType(resource.mediaType)}`);
    }
    return lines;
  }
  if (descriptor.type === 'd-cinema-generic-data') {
    return [
      `            EditRate: ${rational(descriptor.editRate)}`,
      `   ContainerDuration: ${descriptor.containerDuration}`,
      `   DataEssenceCoding: ${formatUlHex(descriptor.dataEssenceCodingUl)}`
    ];
  }
  if (descriptor.type === 'dolby-atmos') {
    return [
      `          EditRate: ${rational(descriptor.editRate)}`,
      `   ContainerDuration: ${descriptor.containerDuration}`,
      `   DataEssenceCoding: ${formatUlHex(descriptor.dataEssenceCodingUl)}`,
      `        AtmosVersion: ${descriptor.atmosVersion}`,
      `     MaxChannelCount: ${descriptor.maxChannelCount}`,
      `      MaxObjectCount: ${descriptor.maxObjectCount}`,
      `             AtmosID: ${descriptor.atmosId}`,
      `           FirstFrame: ${descriptor.firstFrame}`
    ];
  }
  throw new Error(`Descriptor formatting is not implemented for ${descriptor.type}`);
}

function formatCoding(descriptor) {
  if (!descriptor) throw new Error('Inspection has no supported typed descriptor');
  if (descriptor.type === 'pcm') {
    const coding = descriptor.soundEssenceCoding;
    if (!coding?.effectiveUl) return [];
    const inference = coding.source === 'descriptor' ? '' : '; inferred per ST 382';
    const name = coding.name ? ` (${coding.name}${inference})` : '';
    return [`SoundEssenceCoding: ${formatUlHex(coding.effectiveUl)}${name}`];
  }
  if (descriptor.type.startsWith('jpeg-2000')) {
    let name = '**UNKNOWN**';
    if (descriptor.pictureEssenceCodingUl === mdd('JP2KEssenceCompression_2K').ulHex) name = 'ST-429-4-2K';
    else if (descriptor.pictureEssenceCodingUl === mdd('JP2KEssenceCompression_4K').ulHex) name = 'ST-429-4-4K';
    return [`PictureEssenceCoding: ${formatUlHex(descriptor.pictureEssenceCodingUl)} (${name})`];
  }
  if (descriptor.type === 'mpeg-2') {
    return [`PictureEssenceCoding: ${formatUlHex(descriptor.pictureEssenceCodingUl)}`];
  }
  if (['timed-text', 'd-cinema-generic-data', 'dolby-atmos'].includes(descriptor.type)) {
    return [`DataEssenceCoding: ${formatUlHex(descriptor.dataEssenceCodingUl)}`];
  }
  return [];
}

function normalizeTimedTextMediaType(value) {
  if (value.includes('application/x-font-opentype') ||
      value.includes('application/x-opentype') || value.includes('font/opentype')) {
    return 'application/x-font-opentype';
  }
  if (value.includes('image/png')) return 'image/png';
  return 'application/octet-stream';
}

function rational(value) {
  return `${value.numerator}/${value.denominator}`;
}

function formatUlHex(value) {
  return value.match(/.{8}/gu).join('.');
}

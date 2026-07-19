// SPDX-License-Identifier: BSD-3-Clause

import { formatUuid, toHex } from '../binary/identifiers.js';
import { InspectionError } from '../errors.js';
import { parseEssenceDescriptor } from './descriptors.js';
import { mdd } from '../mxf/dictionary.js';
import { readHeaderMetadata } from '../mxf/header-metadata.js';
import { readFooterIndex } from '../mxf/index-table.js';
import { buildMetadataGraph } from '../mxf/metadata-graph.js';
import { openMxfStructure } from '../mxf/structure.js';

const KEYS = {
  identification: mdd('Identification').ulHex,
  sourcePackage: mdd('SourcePackage').ulHex,
  cryptographicContext: mdd('CryptographicContext').ulHex,
  interopOpAtom: mdd('MXFInterop_OPAtom').ulHex,
  smpteOpAtom: mdd('OPAtom').ulHex
};

const DESCRIPTOR_KEYS = {
  mpeg2: mdd('MPEG2VideoDescriptor').ulHex,
  waveAudio: mdd('WaveAudioDescriptor').ulHex,
  jpeg2000: mdd('JPEG2000PictureSubDescriptor').ulHex,
  timedText: mdd('TimedTextDescriptor').ulHex,
  stereoscopic: mdd('StereoscopicPictureSubDescriptor').ulHex,
  dcData: mdd('DCDataDescriptor').ulHex,
  privateDcData: mdd('PrivateDCDataDescriptor').ulHex,
  dolbyAtmos: mdd('DolbyAtmosSubDescriptor').ulHex,
  cdci: mdd('CDCIEssenceDescriptor').ulHex,
  rgba: mdd('RGBAEssenceDescriptor').ulHex
};

const TAGS = {
  companyName: mdd('Identification_CompanyName').tag,
  productName: mdd('Identification_ProductName').tag,
  versionString: mdd('Identification_VersionString').tag,
  productUid: mdd('Identification_ProductUID').tag,
  packageUid: mdd('GenericPackage_PackageUID').tag,
  containerDuration: mdd('FileDescriptor_ContainerDuration').tag
};

const CRYPTO_ULS = {
  contextId: mdd('CryptographicContext_ContextID').ulHex,
  micAlgorithm: mdd('CryptographicContext_MICAlgorithm').ulHex,
  cryptographicKeyId: mdd('CryptographicContext_CryptographicKeyID').ulHex
};

const HMAC_SHA1_ALGORITHM = mdd('MICAlgorithm_HMAC_SHA1').ulHex;

export async function inspectMxf(source, { signal, includeIndex = false } = {}) {
  if (!source || typeof source.read !== 'function' || typeof source.size !== 'bigint') {
    throw new TypeError('source must expose bigint size and asynchronous read(offset, length)');
  }
  if (typeof includeIndex !== 'boolean') throw new TypeError('includeIndex must be a boolean');
  try {
    return await inspectMxfInternal(source, { signal, includeIndex });
  } catch (error) {
    if (error instanceof InspectionError || error?.name === 'AbortError') throw error;
    throw new InspectionError(error.message, {
      sourceName: source.name ?? null,
      causeName: error.name
    }, { cause: error });
  }
}

async function inspectMxfInternal(source, { signal, includeIndex }) {
  const structure = await openMxfStructure(source, { signal });
  if (!structure.headerPartition) throw new Error('MXF has no header partition');
  const headerMetadata = await readHeaderMetadata(source, structure.headerPartition, { signal });
  const metadataGraph = buildMetadataGraph(headerMetadata);
  const identification = findLocalSet(headerMetadata, KEYS.identification);
  const sourcePackage = findLocalSet(headerMetadata, KEYS.sourcePackage);
  const cryptographicContext = findLocalSet(headerMetadata, KEYS.cryptographicContext);

  if (!identification) throw new Error('MXF header has no Identification set');
  if (!sourcePackage) throw new Error('MXF header has no SourcePackage set');

  const productUid = requireItemByTag(identification, TAGS.productUid, 'ProductUID').value;
  const packageUid = requireItemByTag(sourcePackage, TAGS.packageUid, 'PackageUID').value;
  if (productUid.byteLength !== 16) throw new Error('Identification ProductUID is not 16 bytes');
  if (packageUid.byteLength !== 32) throw new Error('SourcePackage PackageUID is not a 32-byte UMID');

  const operationalPattern = toHex(structure.headerPartition.operationalPattern);
  const labelSetType = operationalPattern === KEYS.smpteOpAtom
    ? 'SMPTE'
    : operationalPattern === KEYS.interopOpAtom ? 'MXF Interop' : 'Unknown';

  const crypto = cryptographicContext ? {
    contextId: optionalUuidByUl(cryptographicContext, CRYPTO_ULS.contextId),
    micAlgorithm: optionalHexByUl(cryptographicContext, CRYPTO_ULS.micAlgorithm),
    cryptographicKeyId: optionalUuidByUl(cryptographicContext, CRYPTO_ULS.cryptographicKeyId)
  } : null;
  const essence = detectEssence(headerMetadata);
  const parsedDescriptor = parseEssenceDescriptor(headerMetadata, essence.type);
  const trackEditRate = sourceTrackEditRate(metadataGraph);
  const descriptor = parsedDescriptor && trackEditRate
    ? { ...parsedDescriptor, editRate: trackEditRate }
    : parsedDescriptor;
  const footerIndex = includeIndex && structure.footerPartition
    ? await readFooterIndex(source, structure.footerPartition, { signal }) : null;
  const bitrate = includeIndex && essence.type.startsWith('jpeg-2000')
    ? calculatePictureBitrate(essence, footerIndex) : null;

  return {
    structure,
    headerMetadata,
    metadataGraph,
    essence,
    descriptor,
    footerIndex,
    bitrate,
    writerInfo: {
      productUuid: formatUuid(productUid),
      productVersion: decodeUtf16Be(requireItemByTag(identification, TAGS.versionString, 'VersionString').value),
      companyName: decodeUtf16Be(requireItemByTag(identification, TAGS.companyName, 'CompanyName').value),
      productName: decodeUtf16Be(requireItemByTag(identification, TAGS.productName, 'ProductName').value),
      encryptedEssence: cryptographicContext !== null,
      hmac: crypto?.micAlgorithm === HMAC_SHA1_ALGORITHM,
      assetUuid: formatUuid(packageUid.subarray(16)),
      labelSetType,
      crypto
    }
  };
}

function calculatePictureBitrate(essence, footerIndex) {
  if (!footerIndex) throw new Error('MXF has no footer index');
  const entries = footerIndex.segments.flatMap((segment) => segment.indexEntries);
  const duration = essence.editUnitCount;
  if (duration === null || duration < 3n) throw new Error('Picture duration is too short for bitrate calculation');
  if (BigInt(entries.length) < duration) throw new Error('Footer index has fewer entries than picture duration');
  let totalFrameBytes = 0n;
  let largestFrame = 0n;
  let lastStreamOffset = 0n;
  for (let index = 0; index < Number(duration); index += 1) {
    const streamOffset = entries[index].streamOffset;
    if (lastStreamOffset !== 0n) {
      const frameSize = streamOffset - lastStreamOffset - 20n;
      totalFrameBytes += frameSize;
      if (frameSize > largestFrame) largestFrame = frameSize;
    }
    lastStreamOffset = streamOffset;
  }
  const editRate = footerIndex.segments[0]?.editRate;
  if (!editRate || editRate.denominator === 0) throw new Error('Footer index has an invalid edit rate');
  const rate = editRate.numerator / editRate.denominator;
  const bytesToMegabits = 8 / 1_000_000;
  return {
    maximumMbps: Number(largestFrame) * bytesToMegabits * rate,
    averageMbps: (Number(totalFrameBytes) / Number(duration - 2n)) * bytesToMegabits * rate
  };
}

function detectEssence(headerMetadata) {
  const sets = new Map(headerMetadata.localSets.map((packet) => [packet.keyHex, packet.localSet]));
  let type;
  let description;
  let descriptor;

  if (sets.has(DESCRIPTOR_KEYS.jpeg2000)) {
    const stereo = headerMetadata.localSets.some((packet) => (
      versionedUlEqual(packet.keyHex, DESCRIPTOR_KEYS.stereoscopic)
    ));
    type = stereo ? 'jpeg-2000-stereoscopic' : 'jpeg-2000';
    description = stereo ? 'JPEG 2000 stereoscopic pictures' : 'JPEG 2000 pictures';
    descriptor = sets.get(DESCRIPTOR_KEYS.rgba) ?? sets.get(DESCRIPTOR_KEYS.cdci);
  } else if (sets.has(DESCRIPTOR_KEYS.waveAudio)) {
    type = 'pcm';
    description = 'PCM audio';
    descriptor = sets.get(DESCRIPTOR_KEYS.waveAudio);
  } else if (sets.has(DESCRIPTOR_KEYS.mpeg2)) {
    type = 'mpeg-2';
    description = 'MPEG2 video';
    descriptor = sets.get(DESCRIPTOR_KEYS.mpeg2);
  } else if (sets.has(DESCRIPTOR_KEYS.timedText)) {
    type = 'timed-text';
    description = 'Timed Text';
    descriptor = sets.get(DESCRIPTOR_KEYS.timedText);
  } else if (sets.has(DESCRIPTOR_KEYS.dcData) || sets.has(DESCRIPTOR_KEYS.privateDcData)) {
    const atmos = sets.has(DESCRIPTOR_KEYS.dolbyAtmos);
    type = atmos ? 'dolby-atmos' : 'd-cinema-generic-data';
    description = atmos ? 'Dolby ATMOS' : 'D-Cinema Generic Data';
    descriptor = sets.get(DESCRIPTOR_KEYS.dcData) ?? sets.get(DESCRIPTOR_KEYS.privateDcData);
  } else {
    return { type: 'unknown', description: 'Unknown', editUnitCount: null };
  }

  const duration = descriptor?.byTag.get(TAGS.containerDuration)?.value;
  return {
    type,
    description,
    editUnitCount: duration ? readInt64(duration, 'ContainerDuration') : null
  };
}

function sourceTrackEditRate(metadataGraph) {
  const sourcePackage = metadataGraph.objects.find((object) => object.type === 'SourcePackage');
  const descriptor = sourcePackage?.references.find((reference) => (
    reference.property === 'SourcePackage_Descriptor'
  ))?.target;
  const linkedTrackId = descriptor?.properties.FileDescriptor_LinkedTrackID?.value;
  if (!Number.isInteger(linkedTrackId)) return null;
  const track = sourcePackage.references.find((reference) => (
    reference.property === 'GenericPackage_Tracks'
    && reference.target?.properties.GenericTrack_TrackID?.value === linkedTrackId
  ))?.target;
  return track?.properties.Track_EditRate?.value ?? null;
}

function versionedUlEqual(left, right) {
  return left.length === 32 && right.length === 32
    && left.slice(0, 14) === right.slice(0, 14)
    && left.slice(16) === right.slice(16);
}

function findLocalSet(headerMetadata, keyHex) {
  return headerMetadata.localSets.find((packet) => packet.keyHex === keyHex)?.localSet ?? null;
}

function requireItemByTag(localSet, tag, name) {
  const item = localSet.byTag.get(tag);
  if (!item) throw new Error(`Identification metadata has no ${name}`);
  return item;
}

function optionalUuidByUl(localSet, ul) {
  const value = localSet.byUl.get(ul)?.value;
  return value?.byteLength === 16 ? formatUuid(value) : null;
}

function optionalHexByUl(localSet, ul) {
  const value = localSet.byUl.get(ul)?.value;
  return value ? toHex(value) : null;
}

function decodeUtf16Be(bytes) {
  if (bytes.byteLength % 2 !== 0) throw new Error('UTF-16 metadata value has an odd byte length');
  return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/u, '');
}

function readInt64(bytes, name) {
  if (bytes.byteLength !== 8) throw new Error(`${name} is not 8 bytes`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0, false);
}

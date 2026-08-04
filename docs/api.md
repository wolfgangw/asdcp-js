# asdcp-js API contract

This document defines the supported high-level result and failure contracts.
Properties described here are part of the public API. The `asdcp-js/mxf`
entry point exposes advanced parser structures which may grow as additional MXF
metadata is implemented.

All offsets, lengths, durations, and edit-unit positions which can exceed the
JavaScript safe integer range are `bigint`. Raw bytes are `Uint8Array`. Maps in
the returned metadata structures are actual `Map` instances. Results therefore
are not directly JSON-serializable.

## Random-access source

```ts
interface RandomAccessSource {
  readonly size: bigint;
  readonly maxReadBytes?: bigint;
  readonly name?: string;
  read(
    offset: bigint,
    length: bigint,
    options?: { signal?: AbortSignal }
  ): Promise<Uint8Array>;
}
```

Every successful `read()` must return exactly `length` bytes. Built-in
implementations are exported for `Blob`, memory, and Node files.

## `inspectMxf()`

```ts
function inspectMxf(
  source: RandomAccessSource,
  options?: {
    signal?: AbortSignal;
    includeIndex?: boolean; // default false
  }
): Promise<InspectionResult>;
```

`includeIndex` reads and parses the footer index and calculates JPEG 2000
bitrate information. `openTrack()` requires this index and automatically calls
`inspectMxf()` with `includeIndex: true` when no prior inspection is supplied.

```ts
interface InspectionResult {
  structure: MxfStructure;
  headerMetadata: HeaderMetadata;
  metadataGraph: MetadataGraph;
  essence: EssenceSummary;
  descriptor: EssenceDescriptor | null;
  footerIndex: FooterIndex | null;
  bitrate: PictureBitrate | null;
  writerInfo: WriterInfo;
}

interface EssenceSummary {
  type:
    | 'jpeg-2000'
    | 'jpeg-2000-stereoscopic'
    | 'pcm'
    | 'mpeg-2'
    | 'timed-text'
    | 'd-cinema-generic-data'
    | 'dolby-atmos'
    | 'iab'
    | 'unknown';
  description: string;
  editUnitCount: bigint | null;
}

interface WriterInfo {
  productUuid: string;
  productVersion: string;
  companyName: string;
  productName: string;
  encryptedEssence: boolean;
  hmac: boolean;
  assetUuid: string;
  labelSetType: 'SMPTE' | 'MXF Interop' | 'Unknown';
  crypto: null | {
    contextId: string | null;
    micAlgorithm: string | null;       // 32-digit UL hex
    cryptographicKeyId: string | null;
  };
}

interface PictureBitrate {
  maximumMbps: number;
  averageMbps: number;
}
```

UUID strings use lowercase canonical `8-4-4-4-12` form. UL values use 32
lowercase hexadecimal digits without separators.

### MXF structure

```ts
interface MxfStructure {
  sourceSize: bigint;
  randomIndexPack: RandomIndexPack;
  partitions: Partition[];
  headerPartition: Partition | null;
  bodyPartitions: Partition[];
  genericStreamPartitions: Partition[];
  footerPartition: Partition | null;
  issues: MxfIssue[];
}

interface RandomIndexPack {
  offset: bigint;
  size: bigint;
  klv: KlvHeader;
  entries: Array<{ bodySid: number; byteOffset: bigint }>;
  issues: MxfIssue[];
}

interface Partition {
  kind: 'header' | 'body' | 'footer' | 'generic-stream';
  status: string;
  name: string;
  offset: bigint;
  key: Uint8Array;
  klv: KlvHeader;
  majorVersion: number;
  minorVersion: number;
  kagSize: number;
  thisPartition: bigint;
  previousPartition: bigint;
  footerPartition: bigint;
  headerByteCount: bigint;
  indexByteCount: bigint;
  indexSid: number;
  bodyOffset: bigint;
  bodySid: number;
  operationalPattern: Uint8Array;
  operationalPatternUrn: string;
  essenceContainers: Array<{ bytes: Uint8Array; urn: string }>;
  trailingByteCount: number;
  issues: MxfIssue[];
}

interface KlvHeader {
  key: Uint8Array;
  keyHex: string;
  keyUrn: string | null;
  length: bigint;
  headerLength: bigint;
  valueOffset: bigint;
  endOffset: bigint;
  totalLength: bigint;
}

interface MxfIssue {
  code: string;
  [detail: string]: unknown;
}
```

Issues are recoverable structural observations. A condition which prevents a
reliable inspection rejects the operation instead.

### Header metadata and graph

```ts
interface HeaderMetadata {
  offset: bigint;
  length: bigint;
  primer: PrimerPack;
  packets: HeaderMetadataPacket[];
  localSets: HeaderMetadataPacket[];
}

interface HeaderMetadataPacket extends KlvHeader {
  fileOffset: bigint;
  value: Uint8Array;
  dictionaryEntry: MddEntry | null;
  kind: 'primer' | 'fill' | 'local-set';
  primer?: PrimerPack;
  localSet: LocalSet | null;
}

interface PrimerPack {
  count: number;
  itemSize: number;
  entries: PrimerEntry[];
  byTag: Map<number, PrimerEntry>;
  byUl: Map<string, PrimerEntry>;
}

interface LocalSet {
  items: LocalSetItem[];
  byTag: Map<number, LocalSetItem>;
  byUl: Map<string, LocalSetItem>;
}

interface LocalSetItem {
  offset: number;
  tag: number;
  length: number;
  ul: Uint8Array | null;
  ulHex: string | null;
  dictionaryEntry: MddEntry | null;
  value: Uint8Array;
}

interface MddEntry {
  id: number;
  name: string;
  ulHex: string;
  tag: number;
  optional: boolean;
}

interface MetadataGraph {
  objects: MetadataObject[];
  byInstanceUid: Map<string, MetadataObject>;
  issues: MxfIssue[];
}

interface MetadataObject {
  type: string | null;
  keyHex: string;
  offset: bigint;
  length: bigint;
  instanceUid: string | null;
  propertyList: MetadataProperty[];
  properties: Record<string, MetadataProperty>;
  references: MetadataReference[];
}

interface MetadataProperty {
  name: string;
  type: string;
  value: unknown;
  item: LocalSetItem;
  error?: Error;
}

interface MetadataReference {
  property: string;
  identifier: string;
  target: MetadataObject | null;
}
```

### Essence descriptors

`descriptor.type` is the discriminant. Common numeric ratios have the shape
`{ numerator: number, denominator: number }`.

| Type | Stable fields |
| --- | --- |
| `pcm` | `editRate`, `audioSamplingRate`, `locked`, `channelCount`, `quantizationBits`, `blockAlign`, `averageBytesPerSecond`, `linkedTrackId`, `containerDuration`, `essenceContainerUl`, `soundEssenceCoding`, `channelAssignmentUl`, `channelFormat`, `issues` |
| `jpeg-2000`, `jpeg-2000-stereoscopic` | `stereoscopic`, `aspectRatio`, `editRate`, `sampleRate`, `storedWidth`, `storedHeight`, `rsize`, `xsize`, `ysize`, `xOrigin`, `yOrigin`, `tileWidth`, `tileHeight`, `tileXOrigin`, `tileYOrigin`, `componentCount`, `containerDuration`, `components`, `codingStyle`, `quantization`, `extendedCapabilities`, `pictureEssenceCodingUl` |
| `mpeg-2` | `sampleRate`, `frameLayout`, `storedWidth`, `storedHeight`, `aspectRatio`, `pictureEssenceCodingUl`, `componentDepth`, `horizontalSubsampling`, `verticalSubsampling`, `colorSiting`, `codedContentType`, `lowDelay`, `bitRate`, `profileAndLevel`, `containerDuration` |
| `timed-text` | `editRate`, `containerDuration`, `assetId`, `ucsEncoding`, `namespaceName`, `rfc5646LanguageTagList`, `dataEssenceCodingUl`, `displayType`, `intrinsicPictureResolution`, `zPositionInUse`, `resources` |
| `d-cinema-generic-data` | `editRate`, `linkedTrackId`, `containerDuration`, `essenceContainerUl`, `dataEssenceCodingUl` |
| `dolby-atmos` | ST 429-18 D-Cinema immersive audio: generic-data fields plus `family`, `standard`, `wrapping`, `descriptorSet`, `subDescriptorSet`, `immersiveAudioVersion`, `maxChannelCount`, `maxObjectCount`, `immersiveAudioId`, `firstFrame`, `iabSampleRate`; historical `atmosVersion` and `atmosId` aliases remain available |
| `iab` | ST 2067-201 IAB: `family`, `standard`, `wrapping`, descriptor/subdescriptor set names, edit/sample rates, sound descriptor values, `conformsToSpecifications`, and typed `soundfield` MCA metadata |

Timed-text resources have `{ resourceId, mediaType, essenceStreamId }`.

All ST 429-18 immersive-audio subdescriptor properties are optional and are
returned as `null` when absent. `dolby-atmos` is retained as the public
discriminator because it is the historical AS-DCP name for the stored
`DolbyAtmosSubDescriptor`; use `family === 'immersive-audio'` for
standards-neutral application logic. The D-Cinema wrapper and its
`ImmersiveAudioCoding` UL do not by themselves prove whether the bitstream is a
legacy Dolby Atmos stream or an IAB-profile stream.

### Footer index

```ts
interface FooterIndex {
  offset: bigint;
  length: bigint;
  endOffset: bigint;
  segments: IndexSegment[];
  duration: bigint;
  entryCount: number;
  issues: MxfIssue[];
}

interface IndexSegment {
  klv: KlvHeader;
  offset: bigint;
  localSet: LocalSet;
  instanceUid: string;
  editRate: { numerator: number; denominator: number };
  indexStartPosition: bigint;
  indexDuration: bigint;
  editUnitByteCount: number;
  indexSid: number;
  bodySid: number;
  sliceCount: number;
  posTableCount: number;
  omittedRequiredProperties: string[];
  deltaEntries: Array<{
    posTableIndex: number;
    slice: number;
    elementData: number;
  }>;
  indexEntries: Array<{
    temporalOffset: number;
    keyFrameOffset: number;
    flags: number;
    streamOffset: bigint;
  }>;
}
```

## Track reader

```ts
function openTrack(
  source: RandomAccessSource,
  options?: {
    signal?: AbortSignal;
    inspection?: InspectionResult;
    key?: string | Uint8Array;
    verifyHmac?: boolean; // default false
  }
): Promise<TrackReader>;
```

The key is exactly 16 bytes or 32 hexadecimal characters. It is an AES content
key, not a KDM document. `verifyHmac` verifies an existing AS-DCP integrity pack
using the Interop or SMPTE MIC-key derivation. It has no effect when the track
does not declare HMAC values.

An encrypted track without `key` is rejected by `openTrack()`. Encrypted
timed-text main resources use the same frame path. Encrypted timed-text
ancillary generic-stream resources are not currently implemented.

```ts
interface TrackReader {
  readonly source: RandomAccessSource;
  readonly inspection: InspectionResult;
  readonly essenceType: InspectionResult['essence']['type'];
  readonly duration: bigint | null;
  readonly format: {
    keyPrefix: string;
    mediaType: string;
    extension: string | null;
  };
  readonly bodyOffset: bigint;

  readFrame(
    frameNumber: number | bigint,
    options?: { signal?: AbortSignal }
  ): Promise<FrameResult>;

  frames(options?: {
    startFrame?: number | bigint;
    duration?: number | bigint;
    signal?: AbortSignal;
    maxBatchBytes?: number | bigint;
    onProgress?: (progress: FrameProgress) => void;
  }): AsyncGenerator<FrameResult>;

  readTimedTextResource(
    options?: { signal?: AbortSignal }
  ): Promise<TimedTextResult>;

  readAncillaryResource(
    resourceId: string,
    options?: { signal?: AbortSignal }
  ): Promise<AncillaryResourceResult>;
}

interface FrameResult {
  data: Uint8Array;            // plaintext essence
  frameNumber: number;
  fileOffset: bigint;
  streamOffset: bigint;
  klv: KlvHeader;              // container KLV; CryptEssence when encrypted
  mediaType: string;
  encrypted: boolean;
  hmacVerified: true | null;
  plaintextOffset?: bigint;    // encrypted frames only
  sourceKey?: string;          // encrypted triplet SourceKey UL
}

interface FrameProgress {
  completed: bigint;
  total: bigint;
  frameNumber: number;
}
```

`hmacVerified` is `true` only after requested, successful verification. `null`
means verification was not requested or the track has no HMAC. Failed
verification rejects and never returns frame bytes.

`readTimedTextResource()` adds `assetId` and forces
`mediaType: 'application/xml'`. `readAncillaryResource()` returns
`{ data, offset, length, klv, resourceId, mediaType }`.

## Unwrap results

`unwrap()`, `unwrapTimedText()`, and `unwrapPcmWav()` accept the same `key`,
`verifyHmac`, `signal`, and optional prior `inspection` as `openTrack()`.
`unwrap()` adds `filename` to each `FrameResult`.

Timed-text units additionally have:

```ts
type TimedTextUnit =
  | (TimedTextResult & { filename: string; kind: 'timed-text' })
  | (AncillaryResourceResult & {
      filename: string;
      frameNumber: null;
      kind: 'ancillary-resource';
    });
```

PCM WAV output is a stream of:

```ts
interface PcmWavChunk {
  data: Uint8Array;
  filename: string;
  frameNumber: number | null;
  mediaType: 'audio/wav';
  kind: 'header' | 'data';
}
```

## Failure contract

High-level operational errors derive from `AsdcpError` and expose:

```ts
interface AsdcpError extends Error {
  code: string;
  details: Record<string, unknown>;
  cause?: unknown;
}
```

| Class | Meaning |
| --- | --- |
| `InspectionError` | The MXF could not be reliably inspected. The originating low-level parser or source error is available as `cause`. |
| `TrackReaderError` | Track opening, indexing, reading, or unwrapping failed. |
| `DecryptionError` | Encrypted-triplet parsing, AES decryption, padding, or integrity verification failed. It is also a `TrackReaderError`. |

Stable high-level error codes are:

- `ERR_INSPECTION`
- `ERR_TRACK_READER`
- `ERR_ENCRYPTION_KEY_REQUIRED`
- `ERR_ENCRYPTED_ANCILLARY_UNSUPPORTED`
- `ERR_DECRYPTION`
- `ERR_DECRYPTION_CHECK`
- `ERR_ENCRYPTED_TRIPLET`
- `ERR_HMAC_METADATA`
- `ERR_HMAC_UNSUPPORTED`
- `ERR_HMAC_VERIFICATION`
- `ERR_CRYPTO_UNAVAILABLE`

Invalid API arguments throw `TypeError` or `RangeError`, not `AsdcpError`.
Cancellation preserves the signal's `AbortError`. These cases indicate caller
input or control flow rather than malformed MXF data. Errors thrown by a
consumer's progress callback are also not converted.

# asdcp-js

Native ECMAScript module for inspecting and reading AS-DCP MXF track files in
contemporary browsers and Node.

The API implements the AS-DCP functionality required for parity with
[AS-DCP Lib](https://github.com/cinecert/asdcplib)'s `asdcp-info` and
`asdcp-unwrap`. Inspection also recognizes the typed ST 2067-201 IAB descriptor
and soundfield metadata used by IMF/AS-02 files; the track reader remains scoped
to AS-DCP essence.

D-Cinema immersive-audio track files are reported from their stored ST 429-18
metadata. The historical AS-DCP discriminator `dolby-atmos` remains stable for
compatibility, while `essence.family` and `descriptor.family` identify the
standards-neutral `immersive-audio` family. This matters because the ST 429-18
MXF wrapper alone cannot distinguish legacy Dolby Atmos from standardized IAB.

## Usage

Browser file access:

```js
import { inspectMxf, openTrack } from 'asdcp-js';
import { BlobRandomAccessSource } from 'asdcp-js/browser';

const source = new BlobRandomAccessSource(file);
const inspection = await inspectMxf(source, { includeIndex: true });
const track = await openTrack(source, { inspection });
const firstFrame = await track.readFrame(0);
```

Stereoscopic JPEG 2000 tracks expose explicit eye and paired access. The MXF
index addresses one logical composition edit unit containing consecutive left
and right codestreams:

```js
const left = await track.readStereoscopicFrame(0, { eye: 'left' });
const right = await track.readStereoscopicFrame(0, { eye: 'right' });
const pair = await track.readStereoscopicFramePair(0);
```

`unwrap()` defaults to both eyes for stereoscopic tracks and uses `L.j2c` and
`R.j2c` filenames. Pass `eye: 'left'` or `eye: 'right'` to extract one eye.

Encrypted essence uses a 128-bit key value obtained from a (D)KDM or another
trusted key source. `verifyHmac` corresponds to `asdcp-unwrap -m`:

```js
const track = await openTrack(source, {
  key: '00112233445566778899aabbccddeeff',
  verifyHmac: true
});
const firstFrame = await track.readFrame(0);
```

Node.js file access:

```js
import { inspectMxf } from 'asdcp-js';
import { NodeFileRandomAccessSource } from 'asdcp-js/node';

const source = await NodeFileRandomAccessSource.open('picture.mxf');
try {
  console.log(await inspectMxf(source));
} finally {
  await source.close();
}
```

Applications can provide their own random-access source. A source exposes a
BigInt `size`, an optional BigInt `maxReadBytes`, and an asynchronous
`read(offset, length, { signal })` method returning a `Uint8Array`.

Low-level MXF parsing is available from `asdcp-js/mxf`. That entry point is an
advanced API; most consumers should use `inspectMxf()` and `openTrack()`.

The complete `inspectMxf()`, track-reader, unwrap-result, and error contracts are
documented in [docs/api.md](docs/api.md).

## Development

Node.js 20 or newer is required.

```sh
npm run check
```

MDD verification uses the checked-in provenance manifest and does not require an
upstream source checkout. Regeneration is an explicit maintenance operation:

```sh
ASDCP_SOURCE_DIR=<asdcplib-reference>/asdcplib-src npm run generate:mdd
```

For native parity testing, build AS-DCP Lib 2.13.3 in the separate reference
project and point `ASDCP_FIXTURE_DIR` at a real-world DCP fixture tree:

```sh
cd <asdcplib-reference>
npm run build
cd <asdcp-js>
ASDCP_REFERENCE_DIR=<asdcplib-reference>/build/asdcplib-2.13.3/src \
  ASDCP_FIXTURE_DIR=/path/to/dcps npm run test:parity
```

`ASDCP_INFO_BIN` and `ASDCP_UNWRAP_BIN` may be used instead of
`ASDCP_REFERENCE_DIR`.

Use `npm pack` to create the exact package archive consumed by downstream
applications.

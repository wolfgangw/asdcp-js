# asdcp-js

Native ECMAScript module for inspecting and reading AS-DCP MXF track files in
contemporary browsers and Node.

The API implements the AS-DCP functionality required for parity with
[AS-DCP Lib](https://github.com/cinecert/asdcplib)'s `asdcp-info` and `asdcp-unwrap`. It does not implement AS-02.

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

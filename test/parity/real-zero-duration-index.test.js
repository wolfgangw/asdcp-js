// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import test from 'node:test';
import { formatAsdcpInfo } from '../../src/adapters/asdcp-info-formatter.js';
import { NodeFileRandomAccessSource } from '../../src/adapters/node-file-source.js';
import { inspectMxf } from '../../src/asdcp/inspect.js';
import { openTrack } from '../../src/asdcp/track-reader.js';
import { assertReferenceTools, runNative } from '../helpers/native-tools.js';

const fixtureBase = process.env.ASDCP_FIXTURE_DIR
  ? resolve(process.env.ASDCP_FIXTURE_DIR)
  : resolve(import.meta.dirname, '../fixtures/real');
const fixtureRoot = resolve(
  fixtureBase,
  'callas_walking_lucia/dcp/OF/plaintext/25fps/CallasWalkingL_SHR-25_F-133_XX-XX_INT_MOS_2K_FMM_20240202_FMM_SMPTE_OV'
);

test('plaintext Callas tracks accept omitted index defaults and match native index output', async (context) => {
  try {
    await access(fixtureRoot);
  } catch {
    context.skip('Callas plaintext fixtures are not installed');
    return;
  }
  const paths = (await readdir(fixtureRoot))
    .filter((name) => name.toLowerCase().endsWith('.mxf'))
    .map((name) => resolve(fixtureRoot, name))
    .sort();
  assert.equal(paths.length, 2);
  const tools = await assertReferenceTools();

  for (const path of paths) {
    await context.test(basename(path), async () => {
      const source = await NodeFileRandomAccessSource.open(path);
      try {
        const inspected = await inspectMxf(source, { includeIndex: true });
        assert.equal(inspected.essence.editUnitCount, 3675n);
        assert.ok(inspected.footerIndex.segments.every((segment) =>
          segment.sliceCount === 0 && segment.posTableCount === 0));
        assert.deepEqual(inspected.footerIndex.issues, inspected.footerIndex.segments.map((_, segmentIndex) => ({
          code: 'mxf.index.required-property-missing',
          segmentIndex,
          property: 'IndexTableSegmentBase_SliceCount',
          assumedValue: 0
        })));
        const native = await runNative(tools.infoPath, ['-n', path]);
        assert.equal(native.code, 0, native.stderr);
        assert.equal(
          formatAsdcpInfo(inspected, { showIdentity: false, showIndex: true }),
          native.stdout
        );
        const frame = await (await openTrack(source, { inspection: inspected })).readFrame(11);
        assert.ok(frame.data.byteLength > 0);
      } finally {
        await source.close();
      }
    });
  }
});

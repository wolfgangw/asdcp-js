// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import test from 'node:test';
import { formatAsdcpInfo } from '../../src/adapters/asdcp-info-formatter.js';
import { NodeFileRandomAccessSource } from '../../src/adapters/node-file-source.js';
import { inspectMxf } from '../../src/asdcp/inspect.js';
import { assertReferenceTools, runNative } from '../helpers/native-tools.js';

const fixtureBase = process.env.ASDCP_FIXTURE_DIR
  ? resolve(process.env.ASDCP_FIXTURE_DIR)
  : resolve(import.meta.dirname, '../fixtures/real');
const fixtureRoot = resolve(fixtureBase, 'lohnbuchhalter_kremke');

test('real Interop OV and VF tracks match native metadata modes', async (context) => {
  try {
    await access(fixtureRoot);
  } catch {
    context.skip('Interop DCP fixtures are not installed');
    return;
  }

  const files = await findMxfFiles(fixtureRoot);
  assert.equal(files.length, 32, 'expected 8 J2K and 24 PCM Interop tracks');
  const tools = await assertReferenceTools();
  let pictureCount = 0;
  let audioCount = 0;

  for (const path of files) {
    await context.test(basename(path), async () => {
      const source = await NodeFileRandomAccessSource.open(path);
      try {
        const inspected = await inspectMxf(source, { includeIndex: true });
        assert.equal(inspected.writerInfo.labelSetType, 'MXF Interop');
        assert.equal(inspected.writerInfo.encryptedEssence, false);
        assert.equal(inspected.metadataGraph.issues.length, 0);
        assert.equal(inspected.footerIndex.issues.length, 0);
        assert.equal(inspected.footerIndex.duration, inspected.essence.editUnitCount);

        await assertMode(tools.infoPath, path, '-i', formatAsdcpInfo(inspected));
        await assertMode(tools.infoPath, path, '-H', formatAsdcpInfo(inspected, {
          showIdentity: false,
          showHeader: true
        }));
        await assertMode(tools.infoPath, path, '-d', formatAsdcpInfo(inspected, {
          showIdentity: false,
          showDescriptor: true
        }));
        await assertMode(tools.infoPath, path, '-n', formatAsdcpInfo(inspected, {
          showIdentity: false,
          showIndex: true
        }));

        if (inspected.essence.type === 'jpeg-2000') {
          pictureCount += 1;
          await assertMode(tools.infoPath, path, '-c', formatAsdcpInfo(inspected, {
            showIdentity: false,
            showCoding: true
          }));
          await assertMode(tools.infoPath, path, '-r', formatAsdcpInfo(inspected, {
            showIdentity: false,
            showBitrate: true
          }));
        } else {
          audioCount += 1;
          assert.equal(inspected.essence.type, 'pcm');
        }
        assert.ok(source.totalBytesRead < 512n * 1024n, `read ${source.totalBytesRead} bytes`);
      } finally {
        await source.close();
      }
    });
  }

  assert.equal(pictureCount, 8);
  assert.equal(audioCount, 24);
});

async function assertMode(command, path, option, actual) {
  const native = await runNative(command, [option, path]);
  assert.equal(native.code, 0, native.stderr);
  if (actual === native.stdout) return;

  const actualLines = actual.split('\n');
  const nativeLines = native.stdout.split('\n');
  const lineIndex = Array.from(
    { length: Math.max(actualLines.length, nativeLines.length) },
    (_, index) => index
  ).find((index) => actualLines[index] !== nativeLines[index]);

  assert.fail([
    `${option} differs at line ${lineIndex + 1}`,
    `native: ${JSON.stringify(nativeLines[lineIndex])}`,
    `actual: ${JSON.stringify(actualLines[lineIndex])}`
  ].join('\n'));
}

async function findMxfFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findMxfFiles(path));
    else if (entry.name.endsWith('.mxf')) files.push(path);
  }
  return files.sort();
}

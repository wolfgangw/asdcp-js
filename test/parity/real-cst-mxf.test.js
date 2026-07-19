// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { NodeFileRandomAccessSource } from '../../src/adapters/node-file-source.js';
import { inspectMxf } from '../../src/asdcp/inspect.js';

const fixtureBase = process.env.ASDCP_FIXTURE_DIR
  ? resolve(process.env.ASDCP_FIXTURE_DIR)
  : resolve(import.meta.dirname, '../fixtures/real');
const fixtureRoot = resolve(fixtureBase, 'cst');

test('CST Interop picture tracks accept omitted optional quantization metadata', async (context) => {
  try {
    await access(fixtureRoot);
  } catch {
    context.skip('CST DCP fixtures are not installed');
    return;
  }

  const files = await findPictureMxfFiles(fixtureRoot);
  assert.equal(files.length, 14, 'expected seven 2K and seven 4K CST picture tracks');

  for (const path of files) {
    const source = await NodeFileRandomAccessSource.open(path);
    try {
      const inspected = await inspectMxf(source, { includeIndex: true });
      assert.equal(inspected.essence.type, 'jpeg-2000');
      assert.equal(inspected.writerInfo.labelSetType, 'MXF Interop');
      assert.equal(inspected.descriptor.quantization, null);
      assert.ok(inspected.descriptor.codingStyle);
      assert.equal(inspected.metadataGraph.issues.length, 0);
      assert.equal(inspected.footerIndex.issues.length, 0);
    } finally {
      await source.close();
    }
  }
});

async function findPictureMxfFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findPictureMxfFiles(path));
    else if (/video\.mxf$/iu.test(entry.name)) files.push(path);
  }
  return files.sort();
}

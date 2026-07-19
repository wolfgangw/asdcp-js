// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { assertReferenceTools, runNative } from '../helpers/native-tools.js';

const projectRoot = resolve(import.meta.dirname, '../..');

test('native parity tools are the pinned AS-DCP version', async () => {
  const tools = await assertReferenceTools();
  assert.equal(tools.version, '2.13.3');
});

test('behavior inventory flags remain present in native help', async () => {
  const tools = await assertReferenceTools();
  const inventory = JSON.parse(await readFile(resolve(projectRoot, 'compat/asdcp-tools.json'), 'utf8'));
  const [info, unwrap] = await Promise.all([
    runNative(tools.infoPath, ['-h']),
    runNative(tools.unwrapPath, ['-h'])
  ]);
  assert.equal(info.code, 0);
  assert.equal(unwrap.code, 0);
  for (const flag of inventory.asdcpInfo.flags) assert.match(info.stdout, new RegExp(escapeRegex(flag)));
  for (const flag of inventory.asdcpUnwrap.flags) assert.match(unwrap.stdout, new RegExp(escapeRegex(flag)));
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

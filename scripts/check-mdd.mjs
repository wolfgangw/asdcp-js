// SPDX-License-Identifier: BSD-3-Clause

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const provenancePath = resolve(projectRoot, 'compat/mdd-provenance.json');
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
const generatedPath = resolve(projectRoot, provenance.generated.path);
const generated = await readFile(generatedPath);
const generatedSha256 = createHash('sha256').update(generated).digest('hex');

if (generatedSha256 !== provenance.generated.sha256) {
  throw new Error(
    `Generated MDD dictionary checksum mismatch: expected ${provenance.generated.sha256}, ` +
    `got ${generatedSha256}`
  );
}

const { MDD_ENTRIES } = await import(pathToFileURL(generatedPath).href);
if (!Array.isArray(MDD_ENTRIES) || MDD_ENTRIES.length !== provenance.generated.entryCount) {
  throw new Error(
    `Expected ${provenance.generated.entryCount} MDD entries, got ${MDD_ENTRIES?.length ?? 'invalid data'}`
  );
}

for (const [index, entry] of MDD_ENTRIES.entries()) {
  if (entry.id !== index || typeof entry.name !== 'string' || !/^[0-9a-f]{32}$/u.test(entry.ulHex) ||
      !Number.isInteger(entry.tag) || entry.tag < 0 || entry.tag > 0xffff ||
      typeof entry.optional !== 'boolean') {
    throw new Error(`Invalid generated MDD entry at index ${index}`);
  }
}

console.log(
  `MDD dictionary matches pinned ${provenance.source.project} ${provenance.source.version} provenance ` +
  `(${MDD_ENTRIES.length} entries)`
);

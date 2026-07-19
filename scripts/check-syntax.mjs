// SPDX-License-Identifier: BSD-3-Clause

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const files = await collect(resolve(projectRoot, 'src'));
files.push(...await collect(resolve(projectRoot, 'scripts')));
files.push(...await collect(resolve(projectRoot, 'test')));

for (const file of files.filter((path) => ['.js', '.mjs'].includes(extname(path)))) {
  await run(process.execPath, ['--check', file]);
}

console.log(`Syntax checked ${files.length} files`);

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else files.push(path);
  }
  return files;
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

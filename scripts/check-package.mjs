// SPDX-License-Identifier: BSD-3-Clause

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(resolve(tmpdir(), 'asdcp-js-package-'));
const npmCache = resolve(temporary, '.npm-cache');

try {
  await run('npm', ['pack', '--pack-destination', temporary], { cwd: projectRoot });
  const filenames = (await readdir(temporary)).filter((name) => name.endsWith('.tgz'));
  if (filenames.length !== 1) {
    throw new Error(`Expected one package archive, found ${filenames.length}`);
  }
  const [filename] = filenames;
  const tarball = resolve(temporary, filename);
  await run('npm', ['init', '--yes'], { cwd: temporary });
  await run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball
  ], { cwd: temporary });
  await writeFile(resolve(temporary, 'smoke.mjs'), [
    "import { inspectMxf, openTrack, unwrap } from 'asdcp-js';",
    "import { BlobRandomAccessSource } from 'asdcp-js/browser';",
    "import { NodeFileRandomAccessSource } from 'asdcp-js/node';",
    "import { readKlvHeader } from 'asdcp-js/mxf';",
    'for (const value of [inspectMxf, openTrack, unwrap, BlobRandomAccessSource, NodeFileRandomAccessSource, readKlvHeader]) {',
    "  if (typeof value !== 'function') throw new Error('Missing package export');",
    '}',
    "console.log('Package entry points load');",
    ''
  ].join('\n'));
  await run(process.execPath, [resolve(temporary, 'smoke.mjs')], { cwd: temporary });
  console.log(`Checked ${filename}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function run(command, args, { cwd }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, npm_config_cache: npmCache },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const output = Buffer.concat(stdout).toString('utf8');
      if (code === 0) {
        resolveRun(output);
        return;
      }
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      reject(new Error(
        `${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`}): ${errorOutput || output}`
      ));
    });
  });
}

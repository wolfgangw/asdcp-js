// SPDX-License-Identifier: BSD-3-Clause

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const EXPECTED_VERSION = '2.13.3';
const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const referenceDir = process.env.ASDCP_REFERENCE_DIR
  ? resolve(process.env.ASDCP_REFERENCE_DIR)
  : null;

export const nativeTools = {
  infoPath: process.env.ASDCP_INFO_BIN
    ? resolve(process.env.ASDCP_INFO_BIN)
    : referenceDir && resolve(referenceDir, `asdcp-info${executableSuffix}`),
  unwrapPath: process.env.ASDCP_UNWRAP_BIN
    ? resolve(process.env.ASDCP_UNWRAP_BIN)
    : referenceDir && resolve(referenceDir, `asdcp-unwrap${executableSuffix}`)
};

export async function assertReferenceTools() {
  if (!nativeTools.infoPath || !nativeTools.unwrapPath) throw missingToolsError();
  await Promise.all([access(nativeTools.infoPath), access(nativeTools.unwrapPath)]).catch(() => {
    throw missingToolsError();
  });

  const [info, unwrap] = await Promise.all([
    runNative(nativeTools.infoPath, ['-V']),
    runNative(nativeTools.unwrapPath, ['-V'])
  ]);
  const infoVersion = parseVersion(info.stdout);
  const unwrapVersion = parseVersion(unwrap.stdout);
  if (infoVersion !== EXPECTED_VERSION || unwrapVersion !== EXPECTED_VERSION) {
    throw new Error(`Expected AS-DCP ${EXPECTED_VERSION}, got info=${infoVersion}, unwrap=${unwrapVersion}`);
  }

  return { ...nativeTools, version: EXPECTED_VERSION };
}

function missingToolsError() {
  return new Error(
    'AS-DCP 2.13.3 reference tools are missing; set ASDCP_REFERENCE_DIR, or set both ' +
    'ASDCP_INFO_BIN and ASDCP_UNWRAP_BIN'
  );
}

export function runNative(command, args, { input, cwd, env } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveRun({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    }));
    child.stdin.end(input);
  });
}

function parseVersion(output) {
  return output.match(/asdcplib\s+(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

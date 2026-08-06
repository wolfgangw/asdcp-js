// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import { NodeFileRandomAccessSource } from '../../src/adapters/node-file-source.js';
import { unwrap, unwrapPcmWav } from '../../src/asdcp/track-reader.js';
import { assertReferenceTools, runNative } from '../helpers/native-tools.js';

const fixtureBase = process.env.ASDCP_FIXTURE_DIR
  ? resolve(process.env.ASDCP_FIXTURE_DIR)
  : resolve(import.meta.dirname, '../fixtures/real');
const corpusRoot = resolve(fixtureBase, 'lohnbuchhalter_kremke');
const fixtureRoot = resolve(
  fixtureBase,
  'lohnbuchhalter_kremke/LBKremke_FTR-1_F-133_DE-XX_10-VI_2K_SDK_20250922_ET_IOP_OV'
);
const timedTextFixture = resolve(
  fixtureBase,
  'dcpomatic/Bottom30_TST-1_F_XX-XX_MOS_2K_20230220_SMPTE_OV/' +
  'sub_adc3ccf8-0f26-4c36-8129-d8dfc5d47198.mxf'
);
const encryptedFixtureRoot = resolve(import.meta.dirname, '../fixtures/encrypted-mxf');
const encryptedFixture = resolve(
  encryptedFixtureRoot,
  'j2c_d57a3994-f9ba-4596-b50c-c6c21aa6651e.mxf'
);
const encryptedKeyFile = resolve(
  encryptedFixtureRoot,
  'j2c_d57a3994-f9ba-4596-b50c-c6c21aa6651e.key'
);
const stereoscopicFixtures = [
  {
    name: 'interop',
    path: resolve(
      fixtureBase,
      'MadMieter_SHR-3D-25_F_DE-XX_DE_51_2K_CPP_20191025_CPP_IOP-3D_OV/' +
      '01_Render_B_01_5DB2FAA7B0EE0031.mxf'
    ),
    forceNativeStereo: true
  },
  {
    name: 'smpte',
    path: resolve(
      fixtureBase,
      'Atmos/DolbyUnfold_TLR-3D_F_EN-XX_71-ATMOS_2K_20141112_DLB_SMPTE/' +
      'Unfold_Update_3D_Flat__8312263e-e8ae-48b4-9463-29911b5c5b_v.mxf'
    ),
    forceNativeStereo: false
  }
];

test('encrypted J2K extraction and HMAC verification match native asdcp-unwrap', async () => {
  const tools = await assertReferenceTools();
  const directory = await mkdtemp(join(tmpdir(), 'asdcp-js-encrypted-unwrap-'));
  const source = await NodeFileRandomAccessSource.open(encryptedFixture);
  const key = (await readFile(encryptedKeyFile, 'utf8')).trim();

  try {
    const native = await runNative(tools.unwrapPath, [
      '-b', '16777216',
      '-k', key,
      '-m',
      '-f', '0',
      '-d', '1',
      encryptedFixture,
      'native-'
    ], { cwd: directory });
    assert.equal(native.code, 0, native.stderr);

    const units = [];
    for await (const unit of unwrap(source, {
      key,
      verifyHmac: true,
      duration: 1
    })) units.push(unit);
    assert.equal(units.length, 1);
    assert.equal(units[0].hmacVerified, true);
    assertBytesEqual(
      units[0].data,
      await readFile(join(directory, 'native-000000.j2c')),
      'encrypted J2K frame 0'
    );
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SMPTE timed-text XML and ancillary resources match native extraction', async (context) => {
  try {
    await access(timedTextFixture);
  } catch {
    context.skip('DCP-o-matic timed-text fixture is not installed');
    return;
  }
  const tools = await assertReferenceTools();
  const directory = await mkdtemp(join(tmpdir(), 'asdcp-js-timed-text-'));
  const source = await NodeFileRandomAccessSource.open(timedTextFixture);
  const documentName = 'subtitle.xml';
  const fontId = '2d4d564f-366f-4501-9480-82edc177484d';

  try {
    const native = await runNative(tools.unwrapPath, [
      timedTextFixture, join(directory, documentName)
    ]);
    assert.equal(native.code, 0, native.stderr);

    const units = [];
    for await (const unit of unwrap(source, { filePrefix: documentName })) units.push(unit);
    assert.deepEqual(units.map(({ filename, kind, mediaType }) => [filename, kind, mediaType]), [
      [documentName, 'timed-text', 'application/xml'],
      [fontId, 'ancillary-resource', 'application/x-font-opentype']
    ]);
    assertBytesEqual(units[0].data, await readFile(join(directory, documentName)), 'timed-text XML');
    assertBytesEqual(units[1].data, await readFile(join(directory, fontId)), 'timed-text font');
    assert.ok(source.totalBytesRead < 1024n * 1024n, `read ${source.totalBytesRead} bytes`);
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('all plaintext Interop MXFs match native extraction at a nonzero frame', async (context) => {
  try {
    await access(corpusRoot);
  } catch {
    context.skip('Interop DCP fixtures are not installed');
    return;
  }
  const fixtures = await findMxfFiles(corpusRoot);
  assert.equal(fixtures.length, 32, 'expected 8 J2K and 24 PCM Interop tracks');
  const tools = await assertReferenceTools();
  const directory = await mkdtemp(join(tmpdir(), 'asdcp-js-corpus-unwrap-'));
  let pictureCount = 0;
  let audioCount = 0;

  try {
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index];
      const source = await NodeFileRandomAccessSource.open(fixture);
      const prefix = `native-${String(index).padStart(2, '0')}`;
      try {
        if (basename(fixture).includes('_audio_')) {
          const filename = `${prefix}.wav`;
          const native = await runNative(tools.unwrapPath, [
            '-f', '11', '-d', '1', fixture, filename
          ], { cwd: directory });
          assert.equal(native.code, 0, `${basename(fixture)}: ${native.stderr}`);
          const files = await collectWavFiles(unwrapPcmWav(source, {
            startFrame: 11,
            duration: 1,
            filePrefix: filename
          }));
          assertBytesEqual(
            files.get(filename),
            await readFile(join(directory, filename)),
            `${basename(fixture)} frame 11`
          );
          audioCount += 1;
        } else {
          const native = await runNative(tools.unwrapPath, [
            '-b', '16777216', '-f', '11', '-d', '1', fixture, `${prefix}-`
          ], { cwd: directory });
          assert.equal(native.code, 0, `${basename(fixture)}: ${native.stderr}`);
          const units = [];
          for await (const unit of unwrap(source, { startFrame: 11, duration: 1 })) units.push(unit);
          assert.equal(units.length, 1);
          assertBytesEqual(
            units[0].data,
            await readFile(join(directory, `${prefix}-000011.j2c`)),
            `${basename(fixture)} frame 11`
          );
          pictureCount += 1;
        }
        assert.ok(source.totalBytesRead < 40n * 1024n * 1024n, `${basename(fixture)} read ${source.totalBytesRead} bytes`);
      } finally {
        await source.close();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  assert.equal(pictureCount, 8);
  assert.equal(audioCount, 24);
});

test('J2K frame range matches native asdcp-unwrap byte-for-byte', async (context) => {
  try {
    await access(fixtureRoot);
  } catch {
    context.skip('Interop DCP fixture is not installed');
    return;
  }
  const fixture = (await readdir(fixtureRoot))
    .filter((name) => /_OV_01\.mxf$/u.test(name))
    .map((name) => resolve(fixtureRoot, name))[0];
  assert.ok(fixture, 'expected reel 1 J2K fixture');
  const tools = await assertReferenceTools();
  const directory = await mkdtemp(join(tmpdir(), 'asdcp-js-unwrap-'));
  const source = await NodeFileRandomAccessSource.open(fixture);

  try {
    const native = await runNative(tools.unwrapPath, [
      '-b', '16777216', '-f', '11', '-d', '2', fixture, 'native-'
    ], { cwd: directory });
    assert.equal(native.code, 0, native.stderr);

    const units = [];
    for await (const unit of unwrap(source, { startFrame: 11, duration: 2 })) units.push(unit);
    assert.deepEqual(units.map((unit) => unit.filename), ['000011.j2c', '000012.j2c']);
    assert.equal(units.length, 2);
    for (const unit of units) {
      const nativeBytes = await readFile(join(directory, `native-${String(unit.frameNumber).padStart(6, '0')}.j2c`));
      assertBytesEqual(unit.data, nativeBytes, `${basename(fixture)} frame ${unit.frameNumber}`);
    }
    assert.ok(source.totalBytesRead < 40n * 1024n * 1024n, `read ${source.totalBytesRead} bytes`);
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Interop and SMPTE stereoscopic extraction match native left and right codestreams', async (context) => {
  try {
    await Promise.all(stereoscopicFixtures.map(({ path }) => access(path)));
  } catch {
    context.skip('Stereoscopic DCP fixtures are not installed');
    return;
  }
  const tools = await assertReferenceTools();
  const directory = await mkdtemp(join(tmpdir(), 'asdcp-js-stereoscopic-unwrap-'));

  try {
    for (const fixture of stereoscopicFixtures) {
      await context.test(fixture.name, async () => {
        const nativePrefix = `${fixture.name}-native-`;
        const nativeArguments = [
          '-b', '16777216',
          ...(fixture.forceNativeStereo ? ['-3'] : []),
          '-f', '100',
          '-d', '1',
          fixture.path,
          nativePrefix
        ];
        const native = await runNative(tools.unwrapPath, nativeArguments, { cwd: directory });
        assert.equal(native.code, 0, native.stderr);
        const nativeLeft = await readFile(join(directory, `${nativePrefix}000100L.j2c`));
        const nativeRight = await readFile(join(directory, `${nativePrefix}000100R.j2c`));

        const source = await NodeFileRandomAccessSource.open(fixture.path);
        try {
          const both = [];
          for await (const unit of unwrap(source, {
            startFrame: 100,
            duration: 1,
            filePrefix: `${fixture.name}-js-`
          })) both.push(unit);
          assert.deepEqual(both.map(({ filename, eye }) => [filename, eye]), [
            [`${fixture.name}-js-000100L.j2c`, 'left'],
            [`${fixture.name}-js-000100R.j2c`, 'right']
          ]);
          assertBytesEqual(both[0].data, nativeLeft, `${fixture.name} left frame`);
          assertBytesEqual(both[1].data, nativeRight, `${fixture.name} right frame`);

          for (const [eye, expected] of [['left', nativeLeft], ['right', nativeRight]]) {
            const selected = [];
            for await (const unit of unwrap(source, {
              startFrame: 100,
              duration: 1,
              eye
            })) selected.push(unit);
            assert.equal(selected.length, 1);
            assert.equal(selected[0].eye, eye);
            assertBytesEqual(selected[0].data, expected, `${fixture.name} ${eye}-only frame`);
          }
        } finally {
          await source.close();
        }
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PCM multichannel, stereo, and mono WAV ranges match native asdcp-unwrap', async (context) => {
  try {
    await access(fixtureRoot);
  } catch {
    context.skip('Interop DCP fixture is not installed');
    return;
  }
  const fixture = (await readdir(fixtureRoot))
    .filter((name) => /_OV_audio_01\.mxf$/u.test(name))
    .map((name) => resolve(fixtureRoot, name))[0];
  assert.ok(fixture, 'expected reel 1 PCM fixture');
  const tools = await assertReferenceTools();
  const directory = await mkdtemp(join(tmpdir(), 'asdcp-js-wav-'));
  const source = await NodeFileRandomAccessSource.open(fixture);

  try {
    const nativeMulti = await runNative(tools.unwrapPath, [
      '-f', '11', '-d', '2', fixture, 'native.wav'
    ], { cwd: directory });
    assert.equal(nativeMulti.code, 0, nativeMulti.stderr);
    const jsMulti = await collectWavFiles(unwrapPcmWav(source, {
      startFrame: 11,
      duration: 2,
      filePrefix: 'native.wav'
    }));
    assertBytesEqual(jsMulti.get('native.wav'), await readFile(join(directory, 'native.wav')), 'multichannel WAV');

    const nativeStereo = await runNative(tools.unwrapPath, [
      '-2', '-f', '11', '-d', '2', fixture, 'native-stereo'
    ], { cwd: directory });
    assert.equal(nativeStereo.code, 0, nativeStereo.stderr);
    const jsStereo = await collectWavFiles(unwrapPcmWav(source, {
      startFrame: 11,
      duration: 2,
      split: 'stereo',
      filePrefix: 'native-stereo'
    }));
    assert.equal(jsStereo.size, 4);
    for (const [filename, bytes] of jsStereo) {
      assertBytesEqual(bytes, await readFile(join(directory, filename)), filename);
    }

    const nativeMono = await runNative(tools.unwrapPath, [
      '-1', '-f', '11', '-d', '2', fixture, 'native-mono'
    ], { cwd: directory });
    assert.equal(nativeMono.code, 0, nativeMono.stderr);
    const jsMono = await collectWavFiles(unwrapPcmWav(source, {
      startFrame: 11,
      duration: 2,
      split: 'mono',
      filePrefix: 'native-mono'
    }));
    assert.equal(jsMono.size, 8);
    for (const [filename, bytes] of jsMono) {
      assertBytesEqual(bytes, await readFile(join(directory, filename)), filename);
    }
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function assertBytesEqual(actual, expected, message) {
  if (actual.byteLength === expected.byteLength && Buffer.from(actual).equals(expected)) return;
  const limit = Math.min(actual.byteLength, expected.byteLength);
  let difference = 0;
  while (difference < limit && actual[difference] === expected[difference]) difference += 1;
  assert.fail(
    `${message}: differs at byte ${difference}; JS length ${actual.byteLength}, native length ${expected.byteLength}`
  );
}

async function collectWavFiles(chunks) {
  const parts = new Map();
  for await (const chunk of chunks) {
    const current = parts.get(chunk.filename) ?? [];
    current.push(chunk.data);
    parts.set(chunk.filename, current);
  }
  return new Map([...parts].map(([filename, values]) => [filename, Buffer.concat(values)]));
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

// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import test from 'node:test';
import { NodeFileRandomAccessSource } from '../../src/adapters/node-file-source.js';
import { formatAsdcpInfo } from '../../src/adapters/asdcp-info-formatter.js';
import { inspectMxf } from '../../src/asdcp/inspect.js';
import { openMxfStructure } from '../../src/mxf/structure.js';
import { assertReferenceTools, runNative } from '../helpers/native-tools.js';

const fixtureRoot = process.env.ASDCP_FIXTURE_DIR
  ? resolve(process.env.ASDCP_FIXTURE_DIR)
  : resolve(import.meta.dirname, '../fixtures/real');
const fixtures = [
  {
    path: 'OrsonWellesVie_SHR-25_F-133_EN-fr_FR_51_2K_FMM_20251016_FMM_SMPTE_OV/2c56b2b8-f021-469b-b3de-7a51dbe937a1_pcm.mxf',
    size: 477544078n,
    footerOffset: 0x1c76bd4cn,
    assetUuid: '2c56b2b8-f021-469b-b3de-7a51dbe937a1'
  },
  {
    path: 'OrsonWellesVie_SHR-25_F-133_EN-fr_FR_51_2K_FMM_20251016_FMM_SMPTE_OV/aec029d1-246a-43ec-8bc5-6e38101e91db_j2c.mxf',
    size: 4184683719n,
    footerOffset: 0xf96ae3ecn,
    assetUuid: 'aec029d1-246a-43ec-8bc5-6e38101e91db'
  },
  {
    path: 'TheSpiritOfCha_SHR-25_F-133_EN-fr_FR_10_2K_FMM_20251017_FMM_SMPTE_OV/da743557-de77-4e66-a157-7c8cd4f0c2b8_pcm.mxf',
    size: 160988110n,
    footerOffset: 0x09987a8cn,
    assetUuid: 'da743557-de77-4e66-a157-7c8cd4f0c2b8'
  },
  {
    path: 'TheSpiritOfCha_SHR-25_F-133_EN-fr_FR_10_2K_FMM_20251017_FMM_SMPTE_OV/fde4b30f-ea6c-46ec-8414-dce4985069ee_j2c.mxf',
    size: 1120282856n,
    footerOffset: 0x42c5608cn,
    assetUuid: 'fde4b30f-ea6c-46ec-8414-dce4985069ee'
  }
];

const versionedFillFixture = {
  path: 'misc/cpl-metadata-tkr-dcp/d4414283-82fe-4a25-af0a-1cc73e137a7b/dda733ad-8051-428f-98a0-757ba38e4823.mxf',
  assetUuid: 'dda733ad-8051-428f-98a0-757ba38e4823'
};

const stereoscopicFixture = {
  path: '08_Flakschiesslehre_NEU/j2c_4316f306-3d64-4e62-bab6-5cc3b948d5c2_.mxf',
  assetUuid: '4316f306-3d64-4e62-bab6-5cc3b948d5c2'
};

test('real DCP MXFs have matching native identity and bounded JS structure reads', async (context) => {
  const firstPath = resolve(fixtureRoot, fixtures[0].path);
  try {
    await access(firstPath);
  } catch {
    context.skip('real DCP fixtures are not installed');
    return;
  }

  const tools = await assertReferenceTools();
  for (const fixture of fixtures) {
    await context.test(basename(fixture.path), async () => {
      const path = resolve(fixtureRoot, fixture.path);
      const source = await NodeFileRandomAccessSource.open(path);
      try {
        const structure = await openMxfStructure(source);
        assert.equal(source.size, fixture.size);
        assert.equal(structure.randomIndexPack.size, 60n);
        assert.equal(structure.randomIndexPack.offset, fixture.size - 60n);
        assert.deepEqual(structure.randomIndexPack.entries, [
          { bodySid: 0, byteOffset: 0n },
          { bodySid: 1, byteOffset: 0x4000n },
          { bodySid: 0, byteOffset: fixture.footerOffset }
        ]);
        assert.equal(structure.headerPartition.name, 'ClosedCompleteHeader');
        assert.equal(structure.headerPartition.footerPartition, fixture.footerOffset);
        assert.equal(structure.headerPartition.essenceContainers.length, 2);
        assert.equal(structure.bodyPartitions.length, 1);
        assert.equal(structure.footerPartition.name, 'CompleteFooter');
        assert.equal(structure.issues.length, 0);
        assert.ok(source.totalBytesRead < 1024n, `read ${source.totalBytesRead} bytes`);

        const native = await runNative(tools.infoPath, ['-i', path]);
        assert.equal(native.code, 0, native.stderr);
        assert.match(native.stdout, new RegExp(`AssetUUID: ${fixture.assetUuid}`));
        assert.match(native.stdout, /Label Set Type: SMPTE/);

        const inspected = await inspectMxf(source);
        assert.equal(inspected.metadataGraph.issues.length, 0);
        assert.ok(inspected.metadataGraph.objects.length >= 24);
        assert.ok(inspected.metadataGraph.objects.some((object) => object.type === 'CryptographicContext'));
        const nativeIdentity = parseNativeIdentity(native.stdout);
        assert.deepEqual(inspected.writerInfo, {
          productUuid: nativeIdentity.ProductUUID,
          productVersion: nativeIdentity.ProductVersion,
          companyName: nativeIdentity.CompanyName,
          productName: nativeIdentity.ProductName,
          encryptedEssence: nativeIdentity.EncryptedEssence === 'Yes',
          hmac: nativeIdentity.HMAC === 'Yes',
          assetUuid: nativeIdentity.AssetUUID,
          labelSetType: nativeIdentity['Label Set Type'],
          crypto: {
            contextId: nativeIdentity.ContextID,
            micAlgorithm: '060e2b34040101070209020201000000',
            cryptographicKeyId: nativeIdentity.CryptographicKeyID
          }
        });
        const nativeSummary = native.stdout.match(/^.*?\(\d+ edit units?\)\.$/mu)?.[0];
        assert.ok(nativeSummary, native.stdout);
        const summaryMatch = nativeSummary.match(/essence type is (.*), \((\d+) edit units?\)\.$/u);
        assert.equal(inspected.essence.description, summaryMatch[1]);
        assert.equal(inspected.essence.editUnitCount, BigInt(summaryMatch[2]));
        assert.equal(formatAsdcpInfo(inspected), native.stdout);
        assert.ok(source.totalBytesRead < 18000n, `read ${source.totalBytesRead} bytes`);

        const nativeHeader = await runNative(tools.infoPath, ['-H', path]);
        assert.equal(nativeHeader.code, 0, nativeHeader.stderr);
        assert.equal(
          formatAsdcpInfo(inspected, { showIdentity: false, showHeader: true }),
          nativeHeader.stdout
        );

        const nativeDescriptor = await runNative(tools.infoPath, ['-d', path]);
        assert.equal(nativeDescriptor.code, 0, nativeDescriptor.stderr);
        assert.equal(
          formatAsdcpInfo(inspected, { showIdentity: false, showDescriptor: true }),
          nativeDescriptor.stdout
        );
        if (inspected.essence.type.startsWith('jpeg-2000')) {
          const nativeCoding = await runNative(tools.infoPath, ['-c', path]);
          assert.equal(nativeCoding.code, 0, nativeCoding.stderr);
          assert.equal(
            formatAsdcpInfo(inspected, { showIdentity: false, showCoding: true }),
            nativeCoding.stdout
          );
        } else {
          assert.match(
            formatAsdcpInfo(inspected, { showIdentity: false, showCoding: true }),
            /^SMPTE 429 file essence type is PCM audio.*\nSoundEssenceCoding: 060e2b34\.0401010a\.04020201\.01000000 \(SMPTE-382M Default Uncompressed Sound Coding; inferred per ST 382\)\n$/u
          );
          assert.equal(inspected.descriptor.soundEssenceCoding.storedUl, '00000000000000000000000000000000');
          assert.equal(inspected.descriptor.soundEssenceCoding.source, 'st382-default-null-placeholder');
          assert.deepEqual(
            inspected.descriptor.issues.map((issue) => issue.code),
            ['mxf.pcm.null-sound-essence-coding']
          );
        }

        const indexed = await inspectMxf(source, { includeIndex: true });
        assert.equal(indexed.footerIndex.duration, indexed.essence.editUnitCount);
        assert.equal(indexed.footerIndex.issues.length, 0);
        const nativeIndex = await runNative(tools.infoPath, ['-n', path]);
        assert.equal(nativeIndex.code, 0, nativeIndex.stderr);
        assert.equal(
          formatAsdcpInfo(indexed, { showIdentity: false, showIndex: true }),
          nativeIndex.stdout
        );
        if (indexed.essence.type === 'pcm') {
          assert.equal(indexed.footerIndex.entryCount, 0);
          assert.ok(indexed.footerIndex.segments[0].editUnitByteCount > 0);
        } else {
          assert.equal(BigInt(indexed.footerIndex.entryCount), indexed.essence.editUnitCount);
          const nativeRate = await runNative(tools.infoPath, ['-r', path]);
          assert.equal(nativeRate.code, 0, nativeRate.stderr);
          assert.equal(
            formatAsdcpInfo(indexed, { showIdentity: false, showBitrate: true }),
            nativeRate.stdout
          );
        }
        assert.ok(source.totalBytesRead < 190000n, `read ${source.totalBytesRead} bytes with index`);
      } finally {
        await source.close();
      }
    });
  }
});

test('registry-version KLV Fill is not parsed as a metadata Local Set', async (context) => {
  const path = resolve(fixtureRoot, versionedFillFixture.path);
  try {
    await access(path);
  } catch {
    context.skip('CPL metadata test DCP fixture is not installed');
    return;
  }

  const source = await NodeFileRandomAccessSource.open(path);
  try {
    const inspected = await inspectMxf(source);
    assert.equal(inspected.writerInfo.assetUuid, versionedFillFixture.assetUuid);
    assert.equal(inspected.writerInfo.productName, 'mxf-dci');
    assert.equal(inspected.essence.type, 'jpeg-2000');
    assert.equal(inspected.essence.editUnitCount, 4002n);
    assert.ok(inspected.headerMetadata.packets.some((packet) => (
      packet.kind === 'fill'
      && packet.keyHex === '060e2b34010101010301021001000000'
    )));
  } finally {
    await source.close();
  }

  const tools = await assertReferenceTools();
  const native = await runNative(tools.infoPath, ['-i', path]);
  assert.match(native.stdout, /SMPTE 429 file essence type is JPEG 2000 pictures, \(4002 edit units\)\./u);
  assert.match(native.stdout, new RegExp(`AssetUUID: ${versionedFillFixture.assetUuid}`));
});

test('stereoscopic MXF keeps edit rate distinct from picture sample rate', async (context) => {
  const path = resolve(fixtureRoot, stereoscopicFixture.path);
  try {
    await access(path);
  } catch {
    context.skip('Flakschiesslehre stereoscopic fixture is not installed');
    return;
  }

  const source = await NodeFileRandomAccessSource.open(path);
  try {
    const inspected = await inspectMxf(source, { includeIndex: true });
    assert.equal(inspected.writerInfo.assetUuid, stereoscopicFixture.assetUuid);
    assert.equal(inspected.essence.type, 'jpeg-2000-stereoscopic');
    assert.deepEqual(inspected.descriptor.editRate, { numerator: 25, denominator: 1 });
    assert.deepEqual(inspected.descriptor.sampleRate, { numerator: 50, denominator: 1 });
    assert.deepEqual(inspected.footerIndex.segments[0].editRate, { numerator: 25, denominator: 1 });

    const tools = await assertReferenceTools();
    const native = await runNative(tools.infoPath, ['-d', path]);
    assert.equal(native.code, 0, native.stderr);
    assert.equal(
      formatAsdcpInfo(inspected, { showIdentity: false, showDescriptor: true }),
      native.stdout
    );
  } finally {
    await source.close();
  }
});

function parseNativeIdentity(output) {
  return Object.fromEntries(output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*([^:]+):\s*(.*?)\s*$/u);
    return match ? [[match[1].trim(), match[2]]] : [];
  }));
}

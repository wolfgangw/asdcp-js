// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { findMddByUl, mdd, MDD_ENTRIES } from '../../src/mxf/dictionary.js';

test('generated MDD dictionary retains upstream identities and tags', () => {
  assert.equal(MDD_ENTRIES.length, 587);
  assert.deepEqual(mdd('Identification'), {
    id: 87,
    name: 'Identification',
    ulHex: '060e2b34025301010d01010101013000',
    tag: 0,
    optional: false
  });
  assert.equal(mdd('Identification_CompanyName').tag, 0x3c01);
  assert.equal(mdd('FileDescriptor_ContainerDuration').tag, 0x3002);
  assert.equal(findMddByUl(mdd('WaveAudioDescriptor').ulHex).name, 'WaveAudioDescriptor');
});

test('unknown MDD names and ULs have explicit results', () => {
  assert.throws(() => mdd('NotAnMddEntry'), RangeError);
  assert.equal(findMddByUl('ffffffffffffffffffffffffffffffff'), null);
});

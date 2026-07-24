// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import { isInteropStereoscopicPicture } from '../../src/asdcp/inspect.js';

test('recognizes AS-DCP Interop stereoscopic edit-rate and sample-rate pairs', () => {
  for (const editRate of [24, 25, 30, 48, 50, 60, 96, 100, 120]) {
    assert.equal(isInteropStereoscopicPicture({
      labelSetType: 'MXF Interop',
      essenceType: 'jpeg-2000',
      editRate: rational(editRate),
      sampleRate: rational(editRate * 2)
    }), true, `${editRate}/${editRate * 2}`);
  }
});

test('does not infer Interop stereoscopic essence from an arbitrary doubled rate', () => {
  assert.equal(isInteropStereoscopicPicture({
    labelSetType: 'MXF Interop',
    essenceType: 'jpeg-2000',
    editRate: rational(23_976, 1000),
    sampleRate: rational(47_952, 1000)
  }), false);
});

test('does not use Interop rate inference for SMPTE or non-picture essence', () => {
  const rates = { editRate: rational(25), sampleRate: rational(50) };
  assert.equal(isInteropStereoscopicPicture({
    ...rates,
    labelSetType: 'SMPTE',
    essenceType: 'jpeg-2000'
  }), false);
  assert.equal(isInteropStereoscopicPicture({
    ...rates,
    labelSetType: 'MXF Interop',
    essenceType: 'pcm'
  }), false);
});

test('accepts equivalent rational representations of a recognized rate pair', () => {
  assert.equal(isInteropStereoscopicPicture({
    labelSetType: 'MXF Interop',
    essenceType: 'jpeg-2000',
    editRate: rational(50, 2),
    sampleRate: rational(100, 2)
  }), true);
});

function rational(numerator, denominator = 1) {
  return { numerator, denominator };
}

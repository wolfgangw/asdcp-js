// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InspectionError,
  MemoryRandomAccessSource,
  inspectMxf
} from '../../src/index.js';

test('inspectMxf wraps malformed-input failures and preserves their cause', async () => {
  const source = new MemoryRandomAccessSource(new Uint8Array(4), { name: 'bad.mxf' });
  await assert.rejects(
    inspectMxf(source),
    (error) => (
      error instanceof InspectionError
      && error.code === 'ERR_INSPECTION'
      && error.details.sourceName === 'bad.mxf'
      && error.cause?.name === 'RandomIndexPackError'
    )
  );
});

test('inspectMxf keeps programmer errors and cancellation distinct from data failures', async () => {
  await assert.rejects(inspectMxf(null), TypeError);

  const controller = new AbortController();
  controller.abort();
  const source = new MemoryRandomAccessSource(new Uint8Array(32));
  await assert.rejects(
    inspectMxf(source, { signal: controller.signal }),
    (error) => error.name === 'AbortError' && !(error instanceof InspectionError)
  );
});

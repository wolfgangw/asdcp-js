// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AsdcpError,
  createWritableStreamSink,
  DecryptionError,
  formatAsdcpInfo,
  inspectEncryptedTripletHeader,
  InspectionError,
  inspectMxf,
  MemoryRandomAccessSource,
  openTrack,
  OutputSinkError,
  SourceRangeError,
  TrackReader,
  TrackReaderError,
  unwrap,
  unwrapPcmWav,
  unwrapTimedText,
  validateRange,
  writeUnwrappedFiles
} from '../../src/index.js';
import {
  BlobRandomAccessSource,
  createFileSystemDirectorySink,
  writeUnwrappedFilesToDirectory
} from '../../src/browser.js';
import { NodeFileRandomAccessSource } from '../../src/node.js';
import {
  openMxfStructure,
  parseIabDescriptor,
  readKlvHeader
} from '../../src/mxf.js';

test('documented package entry points expose the supported API', () => {
  for (const value of [
    AsdcpError,
    BlobRandomAccessSource,
    createFileSystemDirectorySink,
    createWritableStreamSink,
    DecryptionError,
    formatAsdcpInfo,
    inspectEncryptedTripletHeader,
    inspectMxf,
    InspectionError,
    MemoryRandomAccessSource,
    NodeFileRandomAccessSource,
    openMxfStructure,
    parseIabDescriptor,
    openTrack,
    OutputSinkError,
    readKlvHeader,
    SourceRangeError,
    TrackReader,
    TrackReaderError,
    unwrap,
    unwrapPcmWav,
    unwrapTimedText,
    validateRange,
    writeUnwrappedFiles,
    writeUnwrappedFilesToDirectory
  ]) {
    assert.equal(typeof value, 'function');
  }
});

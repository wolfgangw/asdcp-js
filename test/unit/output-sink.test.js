// SPDX-License-Identifier: BSD-3-Clause

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFileSystemDirectorySink,
  createWritableStreamSink,
  OutputSinkError,
  writeUnwrappedFiles,
  writeUnwrappedFilesToDirectory
} from '../../src/io/output-sink.js';

test('output router writes interleaved chunks to independent streams', async () => {
  const files = new Map();
  const events = [];
  const sink = createWritableStreamSink((filename) => {
    const chunks = [];
    files.set(filename, chunks);
    return new WritableStream({
      write(chunk) { chunks.push(Uint8Array.from(chunk)); }
    });
  });

  const result = await writeUnwrappedFiles(chunks([
    ['left.wav', [1]],
    ['right.wav', [2]],
    ['left.wav', [3, 4]],
    ['right.wav', [5]]
  ]), sink, { onProgress: (event) => events.push(event) });

  assert.deepEqual(concat(files.get('left.wav')), Uint8Array.of(1, 3, 4));
  assert.deepEqual(concat(files.get('right.wav')), Uint8Array.of(2, 5));
  assert.deepEqual(result, { filesWritten: 2, chunksWritten: 4, bytesWritten: 5n });
  assert.equal(events.at(-1).bytesWritten, 5n);
});

test('output router aborts every open file when a write fails', async () => {
  const states = new Map();
  const failure = new Error('write failed');
  const sink = {
    open(filename) {
      const state = { aborted: null, closed: false };
      states.set(filename, state);
      return {
        write(data) {
          if (filename === 'bad.j2c' && data[0] === 9) throw failure;
        },
        close() { state.closed = true; },
        abort(reason) { state.aborted = reason; }
      };
    }
  };

  await assert.rejects(writeUnwrappedFiles(chunks([
    ['good.j2c', [1]],
    ['bad.j2c', [2]],
    ['bad.j2c', [9]]
  ]), sink), failure);
  assert.equal(states.get('good.j2c').aborted, failure);
  assert.equal(states.get('bad.j2c').aborted, failure);
  assert.equal(states.get('good.j2c').closed, false);
});

test('output router aborts a newly opened output with an invalid interface', async () => {
  let aborted = false;
  await assert.rejects(writeUnwrappedFiles(chunks([
    ['invalid.j2c', [1]]
  ]), {
    open() {
      return { abort() { aborted = true; } };
    }
  }), /must expose write\(\) and close\(\)/u);
  assert.equal(aborted, true);
});

test('output router observes cancellation and aborts open streams', async () => {
  const controller = new AbortController();
  let aborted = false;
  const sink = {
    open() {
      return {
        write() { controller.abort(new Error('cancelled')); },
        close() {},
        abort() { aborted = true; }
      };
    }
  };

  await assert.rejects(writeUnwrappedFiles(chunks([
    ['frame.j2c', [1]],
    ['frame.j2c', [2]]
  ]), sink, { signal: controller.signal }), /cancelled/u);
  assert.equal(aborted, true);
});

test('directory consumer creates and closes browser file handles', async () => {
  const files = new Map();
  const createOptions = [];
  const directory = {
    async getFileHandle(filename, options) {
      assert.deepEqual(options, { create: true });
      return {
        async createWritable(options) {
          createOptions.push(options);
          const state = { chunks: [], closed: false };
          files.set(filename, state);
          return {
            write(data) { state.chunks.push(Uint8Array.from(data)); },
            close() { state.closed = true; },
            abort() {}
          };
        }
      };
    }
  };

  const result = await writeUnwrappedFilesToDirectory(chunks([
    ['000001.j2c', [1, 2]],
    ['000002.j2c', [3]]
  ]), directory);
  assert.deepEqual(result, { filesWritten: 2, chunksWritten: 2, bytesWritten: 3n });
  assert.deepEqual(createOptions, [{ keepExistingData: false }, { keepExistingData: false }]);
  assert.equal(files.get('000001.j2c').closed, true);
  assert.deepEqual(concat(files.get('000001.j2c').chunks), Uint8Array.of(1, 2));
});

test('directory sink rejects filenames containing paths', async () => {
  const sink = createFileSystemDirectorySink({ getFileHandle() {} });
  await assert.rejects(sink.open('../escape.j2c'), OutputSinkError);
  await assert.rejects(sink.open('nested/file.j2c'), OutputSinkError);
});

async function* chunks(entries) {
  for (const [filename, data] of entries) {
    yield { filename, data: Uint8Array.from(data), mediaType: 'application/octet-stream' };
  }
}

function concat(values) {
  const length = values.reduce((sum, value) => sum + value.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

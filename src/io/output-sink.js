// SPDX-License-Identifier: BSD-3-Clause

export class OutputSinkError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OutputSinkError';
    this.details = details;
  }
}

export async function writeUnwrappedFiles(chunks, sink, { signal, onProgress } = {}) {
  if (!chunks?.[Symbol.asyncIterator] && !chunks?.[Symbol.iterator]) {
    throw new TypeError('chunks must be an iterable or async iterable');
  }
  if (!sink || typeof sink.open !== 'function') {
    throw new TypeError('sink must expose open(filename, metadata)');
  }

  const outputs = new Map();
  let bytesWritten = 0n;
  let chunksWritten = 0;
  try {
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      validateChunk(chunk);
      let output = outputs.get(chunk.filename);
      if (!output) {
        const writable = await sink.open(chunk.filename, {
          mediaType: chunk.mediaType ?? 'application/octet-stream',
          signal
        });
        try {
          output = normalizeWritable(writable, chunk.filename);
        } catch (error) {
          await abortUnnormalized(writable, error);
          throw error;
        }
        outputs.set(chunk.filename, output);
      }
      await output.write(chunk.data);
      bytesWritten += BigInt(chunk.data.byteLength);
      chunksWritten += 1;
      onProgress?.({
        filename: chunk.filename,
        filesOpened: outputs.size,
        chunksWritten,
        bytesWritten
      });
    }
    signal?.throwIfAborted();
    for (const output of outputs.values()) await output.close();
  } catch (error) {
    await Promise.allSettled(
      [...outputs.values()].map((output) => output.abort(error))
    );
    throw error;
  }

  return {
    filesWritten: outputs.size,
    chunksWritten,
    bytesWritten
  };
}

export function createWritableStreamSink(openStream) {
  if (typeof openStream !== 'function') throw new TypeError('openStream must be a function');
  return {
    open(filename, metadata) {
      return openStream(filename, metadata);
    }
  };
}

export function createFileSystemDirectorySink(directoryHandle, { keepExistingData = false } = {}) {
  if (!directoryHandle || typeof directoryHandle.getFileHandle !== 'function') {
    throw new TypeError('directoryHandle must expose getFileHandle()');
  }
  return {
    async open(filename) {
      validateFileName(filename);
      const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
      if (!fileHandle || typeof fileHandle.createWritable !== 'function') {
        throw new OutputSinkError('File handle does not expose createWritable()', { filename });
      }
      return fileHandle.createWritable({ keepExistingData });
    }
  };
}

export function writeUnwrappedFilesToDirectory(chunks, directoryHandle, options = {}) {
  const { keepExistingData = false, ...writeOptions } = options;
  return writeUnwrappedFiles(
    chunks,
    createFileSystemDirectorySink(directoryHandle, { keepExistingData }),
    writeOptions
  );
}

function normalizeWritable(writable, filename) {
  if (!writable) throw new OutputSinkError('Sink returned no writable output', { filename });
  if (typeof writable.getWriter === 'function') {
    const writer = writable.getWriter();
    let state = 'open';
    return {
      write(data) {
        if (state !== 'open') throw new OutputSinkError('Output is not open', { filename, state });
        return writer.write(data);
      },
      async close() {
        if (state !== 'open') return;
        try {
          await writer.close();
          state = 'closed';
        } catch (error) {
          state = 'failed';
          throw error;
        } finally {
          writer.releaseLock();
        }
      },
      async abort(reason) {
        if (state !== 'open') return;
        try {
          await writer.abort(reason);
          state = 'aborted';
        } finally {
          writer.releaseLock();
        }
      }
    };
  }
  if (typeof writable.write !== 'function' || typeof writable.close !== 'function') {
    throw new OutputSinkError('Writable output must expose write() and close()', { filename });
  }
  let state = 'open';
  return {
    write(data) {
      if (state !== 'open') throw new OutputSinkError('Output is not open', { filename, state });
      return writable.write(data);
    },
    async close() {
      if (state !== 'open') return;
      await writable.close();
      state = 'closed';
    },
    async abort(reason) {
      if (state !== 'open') return;
      if (typeof writable.abort === 'function') await writable.abort(reason);
      state = 'aborted';
    }
  };
}

async function abortUnnormalized(writable, reason) {
  if (!writable) return;
  try {
    if (typeof writable.abort === 'function') {
      await writable.abort(reason);
      return;
    }
    if (typeof writable.getWriter === 'function') {
      const writer = writable.getWriter();
      try {
        await writer.abort(reason);
      } finally {
        writer.releaseLock();
      }
    }
  } catch {
    // Preserve the interface error that made this output unusable.
  }
}

function validateChunk(chunk) {
  if (!chunk || typeof chunk.filename !== 'string' || chunk.filename.length === 0) {
    throw new OutputSinkError('Each output chunk must have a filename');
  }
  if (!(chunk.data instanceof Uint8Array)) {
    throw new OutputSinkError('Each output chunk must contain Uint8Array data', {
      filename: chunk.filename
    });
  }
}

function validateFileName(filename) {
  if (filename.length === 0 || filename === '.' || filename === '..' ||
      filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    throw new OutputSinkError('Output filename must be a plain filename without a path', { filename });
  }
}

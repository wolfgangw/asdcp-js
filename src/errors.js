// SPDX-License-Identifier: BSD-3-Clause

export class AsdcpError extends Error {
  constructor(message, { code = 'ERR_ASDCP', details = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class InspectionError extends AsdcpError {
  constructor(message, details = {}, options = {}) {
    super(message, {
      code: options.code ?? 'ERR_INSPECTION',
      details,
      cause: options.cause
    });
  }
}

export class TrackReaderError extends AsdcpError {
  constructor(message, details = {}, options = {}) {
    super(message, {
      code: options.code ?? 'ERR_TRACK_READER',
      details,
      cause: options.cause
    });
  }
}

export class DecryptionError extends TrackReaderError {
  constructor(message, details = {}, options = {}) {
    super(message, details, {
      code: options.code ?? 'ERR_DECRYPTION',
      cause: options.cause
    });
  }
}

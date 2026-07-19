// SPDX-License-Identifier: BSD-3-Clause

export const RANDOM_INDEX_PACK_KEY_HEX = '060e2b34020501010d01020101110100';
export const GENERIC_STREAM_PARTITION_KEY_HEX = '060e2b34020501010d01020101031100';

const partitionKinds = new Map([
  ['060e2b34020501010d01020101020100', { kind: 'header', closed: false, complete: false, name: 'OpenHeader' }],
  ['060e2b34020501010d01020101020300', { kind: 'header', closed: false, complete: true, name: 'OpenCompleteHeader' }],
  ['060e2b34020501010d01020101020200', { kind: 'header', closed: true, complete: false, name: 'ClosedHeader' }],
  ['060e2b34020501010d01020101020400', { kind: 'header', closed: true, complete: true, name: 'ClosedCompleteHeader' }],
  ['060e2b34020501010d01020101030100', { kind: 'body', closed: false, complete: false, name: 'OpenBodyPartition' }],
  ['060e2b34020501010d01020101030300', { kind: 'body', closed: false, complete: true, name: 'OpenCompleteBodyPartition' }],
  ['060e2b34020501010d01020101030200', { kind: 'body', closed: true, complete: false, name: 'ClosedBodyPartition' }],
  ['060e2b34020501010d01020101030400', { kind: 'body', closed: true, complete: true, name: 'ClosedCompleteBodyPartition' }],
  [GENERIC_STREAM_PARTITION_KEY_HEX, {
    kind: 'generic-stream',
    closed: null,
    complete: null,
    name: 'GenericStreamPartition'
  }],
  ['060e2b34020501010d01020101040200', { kind: 'footer', closed: true, complete: false, name: 'Footer' }],
  ['060e2b34020501010d01020101040400', { kind: 'footer', closed: true, complete: true, name: 'CompleteFooter' }]
]);

export function partitionKindForKeyHex(keyHex) {
  return partitionKinds.get(keyHex) ?? null;
}

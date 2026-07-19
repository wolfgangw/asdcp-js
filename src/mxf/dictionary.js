// SPDX-License-Identifier: BSD-3-Clause

import { MDD_ENTRIES } from '../generated/mdd.js';

const byName = new Map(MDD_ENTRIES.map((entry) => [entry.name, entry]));
const byUl = new Map();
for (const entry of MDD_ENTRIES) {
  const entries = byUl.get(entry.ulHex) ?? [];
  entries.push(entry);
  byUl.set(entry.ulHex, entries);
}

export function mdd(name) {
  const entry = byName.get(name);
  if (!entry) throw new RangeError(`Unknown AS-DCP MDD name: ${name}`);
  return entry;
}

export function findMddByUl(ulHex) {
  return byUl.get(ulHex)?.[0] ?? null;
}

export function findAllMddByUl(ulHex) {
  return byUl.get(ulHex)?.slice() ?? [];
}

export { MDD_ENTRIES };

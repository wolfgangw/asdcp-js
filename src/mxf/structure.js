// SPDX-License-Identifier: BSD-3-Clause

import { readPartitionPack } from './partition.js';
import { readRandomIndexPack } from './random-index-pack.js';

export async function openMxfStructure(source, { signal } = {}) {
  const randomIndexPack = await readRandomIndexPack(source, { signal });
  const partitions = [];
  const issues = [...randomIndexPack.issues];

  for (let index = 0; index < randomIndexPack.entries.length; index += 1) {
    const entry = randomIndexPack.entries[index];
    const partition = await readPartitionPack(source, entry.byteOffset, { signal });
    partitions.push(partition);
    issues.push(...partition.issues.map((issue) => ({ ...issue, partitionIndex: index })));
    if (partition.bodySid !== entry.bodySid) {
      issues.push({
        code: 'mxf.rip.body-sid-mismatch',
        partitionIndex: index,
        ripBodySid: entry.bodySid,
        partitionBodySid: partition.bodySid
      });
    }
    if (index > 0 && partition.previousPartition !== partitions[index - 1].offset) {
      issues.push({
        code: 'mxf.partition.previous-offset-mismatch',
        partitionIndex: index,
        expected: partitions[index - 1].offset,
        actual: partition.previousPartition
      });
    }
  }

  const headerPartition = partitions.find((partition) => partition.kind === 'header') ?? null;
  const bodyPartitions = partitions.filter((partition) => partition.kind === 'body');
  const genericStreamPartitions = partitions.filter((partition) => partition.kind === 'generic-stream');
  const footerPartition = partitions.find((partition) => partition.kind === 'footer') ?? null;
  if (!headerPartition) issues.push({ code: 'mxf.structure.header-partition-missing' });
  if (!footerPartition) issues.push({ code: 'mxf.structure.footer-partition-missing' });
  if (headerPartition && footerPartition && headerPartition.footerPartition !== footerPartition.offset) {
    issues.push({
      code: 'mxf.structure.footer-pointer-mismatch',
      expected: footerPartition.offset,
      actual: headerPartition.footerPartition
    });
  }

  return {
    sourceSize: source.size,
    randomIndexPack,
    partitions,
    headerPartition,
    bodyPartitions,
    genericStreamPartitions,
    footerPartition,
    issues
  };
}

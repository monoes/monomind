import type { MonographNode, MonographEdge } from '../types.js';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

export function toObsidian(nodes: MonographNode[], edges: MonographEdge[], outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });

  const adjOut = new Map<string, string[]>();
  for (const e of edges) {
    const targets = adjOut.get(e.sourceId) ?? [];
    targets.push(e.targetId);
    adjOut.set(e.sourceId, targets);
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (const node of nodes) {
    const links = (adjOut.get(node.id) ?? [])
      .map(tid => nodeMap.get(tid)?.name)
      .filter(Boolean)
      .map(name => `- [[${name}]]`)
      .join('\n');

    const content = `---
label: ${node.label}
file: ${node.filePath ?? ''}
exported: ${node.isExported}
community: ${node.communityId ?? 'none'}
---

# ${node.name}

**Type:** ${node.label}
**Language:** ${node.language ?? 'unknown'}

## Outgoing links

${links || '_none_'}
`;

    const filename = node.name.replace(/[<>:"/\\|?*]/g, '_');
    writeFileSync(join(outputDir, `${filename}.md`), content);
  }
}

// packages/@monomind/cli/src/orgrt/visualization.ts
// Flow visualization tools for org runtime - generates Mermaid diagrams from event streams
import type { BusEvent } from './types.js';

/** Generate Mermaid flowchart from org events for visual debugging */
export function generateMermaidFlow(events: BusEvent[]): string {
  const lines: string[] = ['graph TD'];
  const edges = new Set<string>();
  const nodes = new Set<string>();
  let nodeId = 0;

  // Generate nodes and edges from events
  for (const e of events) {
    const fromNode = e.from ?? 'system';
    const toNode = e.to ?? 'system';

    // Create nodes for roles
    if (!nodes.has(fromNode)) {
      nodes.add(fromNode);
      lines.push(`  ${nodeId++}[${fromNode}]`);
    }
    if (e.to && !nodes.has(toNode)) {
      nodes.add(toNode);
      lines.push(`  ${nodeId++}[${toNode}]`);
    }

    // Create edges based on event type
    let edgeLabel = '';
    let edgeStyle = '';

    switch (e.type) {
      case 'message':
        edgeLabel = e.subject ?? 'msg';
        edgeStyle = '';
        break;
      case 'xorg':
        edgeLabel = 'xorg';
        edgeStyle = '.dashed'; // Inter-org messages
        break;
      case 'tool':
        edgeLabel = `🔧 ${e.tool}`;
        edgeStyle = e.decision === 'deny' ? '.line.dashed.red' : '';
        break;
      case 'audit':
        edgeLabel = `⚠️ ${e.reason ?? 'audit'}`;
        edgeStyle = '.line.dashed.orange';
        break;
      case 'question':
        edgeLabel = `❓ ${e.msg ?? 'question'}`;
        edgeStyle = '.line.dashed.blue';
        break;
      case 'status':
        edgeLabel = `📊 ${e.msg ?? 'status'}`;
        edgeStyle = '.line.dotted.gray';
        break;
      default:
        continue; // Skip other event types for cleaner diagrams
    }

    // Avoid duplicate edges
    const edgeKey = `${fromNode}->${toNode}:${edgeLabel}`;
    if (!edges.has(edgeKey)) {
      edges.add(edgeKey);
      lines.push(`  ${fromNode} -->${edgeStyle}|${edgeLabel}| ${toNode}`);
    }
  }

  // Add styling for different elements
  lines.push('  classDef system fill:#f9f,stroke:#333,stroke-width:2px');
  lines.push('  classDef boss fill:#bbf,stroke:#333,stroke-width:2px');
  lines.push('  classDef specialist fill:#bfb,stroke:#333,stroke-width:1px');

  return lines.join('\n');
}

/** Generate Mermaid sequence diagram from org events showing timeline */
export function generateMermaidSequence(events: BusEvent[]): string {
  const lines: string[] = ['sequenceDiagram'];
  const participants = new Set<string>();

  // Collect all participants
  for (const e of events) {
    if (e.from) participants.add(e.from);
    if (e.to) participants.add(e.to);
  }

  // Declare participants
  for (const p of participants) {
    lines.push(`  participant ${p}`);
  }

  // Add events in sequence
  for (const e of events) {
    const from = e.from ?? 'System';
    const to = e.to ?? 'System';

    switch (e.type) {
      case 'message':
        lines.push(`  ${from}->>${to}: ${e.subject ?? 'message'}`);
        if (e.msg) {
          lines.push(`  Note over ${from},${to}: ${e.msg.slice(0, 50)}...`);
        }
        break;
      case 'xorg':
        lines.push(`  ${from}->>${to}: [xorg] ${e.subject ?? 'message'}`);
        break;
      case 'tool': {
        const toolLabel =
          e.decision === 'deny' ? `🔧 ${e.tool} DENIED: ${e.reason ?? ''}` : `🔧 ${e.tool}`;
        lines.push(`  ${from}->>${to}: ${toolLabel}`);
        break;
      }
      case 'question':
        lines.push(`  ${from}->>${to}: ❓ Question: ${e.msg ?? ''}`);
        break;
      case 'audit':
        lines.push(`  ${from}->>${to}: ⚠️ Audit: ${e.reason ?? e.msg ?? ''}`);
        break;
    }
  }

  return lines.join('\n');
}

/** Generate Mermaid state diagram showing org lifecycle */
export function generateMermaidState(events: BusEvent[]): string {
  const lines: string[] = ['stateDiagram-v2'];
  const states = new Set<string>();
  const transitions = new Set<string>();

  // Extract states and transitions from events
  for (const e of events) {
    if (e.type === 'status' && e.from) {
      states.add(e.from);
    }

    // Track message flow as transitions
    if (e.type === 'message' && e.from && e.to) {
      const transition = `${e.from} => ${e.to}: ${e.subject ?? 'message'}`;
      if (!transitions.has(transition)) {
        transitions.add(transition);
      }
    }
  }

  // Add states
  for (const state of states) {
    lines.push(`  [*] => ${state}`);
  }

  // Add transitions
  for (const transition of transitions) {
    lines.push(`  ${transition}`);
  }

  lines.push(`  ${states.size ? Array.from(states)[0] : '[*'} => [*]`);

  return lines.join('\n');
}

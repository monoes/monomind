// packages/@monomind/cli/__tests__/orgrt/batch2-report-features.test.ts
// Tests for Batch 2 reporting features: --tool filter and --format mermaid
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportAction } from '../../src/commands/org-observe.js';
import { ORG_DIR, type BusEvent } from '../../src/orgrt/types.js';

describe('Batch 2 report features', () => {
  const setupOrgRun = (cwd: string, orgName: string, events: BusEvent[]): void => {
    // Use a fixed run ID that matches RUN_ID_RE: /^run-[A-Za-z0-9-]+$/
    const run = 'run-20250130120000-abc';
    mkdirSync(join(cwd, ORG_DIR, orgName, run), { recursive: true });
    writeFileSync(
      join(cwd, ORG_DIR, orgName, run, 'bus.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
  };

  it('org report --audit --tool <name> filters tool audit trail by tool name', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-tool-'));
    try {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'test.json'), JSON.stringify({
        name: 'test',
        roles: [{ id: 'boss', reports_to: null }],
      }));

      const events: BusEvent[] = [
        { id: '1', ts: 1000, org: 'test', run: 'run-20250130120000-abc', type: 'tool', from: 'coder', tool: 'Write', decision: 'allow', data: {} },
        { id: '2', ts: 2000, org: 'test', run: 'run-20250130120000-abc', type: 'tool', from: 'coder', tool: 'Bash', decision: 'allow', data: {} },
        { id: '3', ts: 3000, org: 'test', run: 'run-20250130120000-abc', type: 'tool', from: 'boss', tool: 'Write', decision: 'deny', reason: 'policy', data: {} },
      ];
      setupOrgRun(cwd, 'test', events);

      const output: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { output.push(a.join(' ')); });

      const res = await reportAction({
        args: ['test'],
        flags: { run: 'run-20250130120000-abc', audit: true, tool: 'Write' },
        cwd,
        interactive: false,
      } as any, 'test');

      spy.mockRestore();

      expect(res?.success).toBe(true);
      const outputText = output.join('\n');
      // Should only show Write tool events (2 events), not Bash (1 event)
      expect(outputText.match(/Write/g)).toHaveLength(2);
      expect(outputText).not.toContain('Bash');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('org report --audit --tool returns empty when no events match', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-tool-empty-'));
    try {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'test.json'), JSON.stringify({
        name: 'test',
        roles: [{ id: 'boss', reports_to: null }],
      }));

      const events: BusEvent[] = [
        { id: '1', ts: 1000, org: 'test', run: 'run-20250130120000-abc', type: 'tool', from: 'coder', tool: 'Write', decision: 'allow', data: {} },
      ];
      setupOrgRun(cwd, 'test', events);

      const output: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { output.push(a.join(' ')); });

      const res = await reportAction({
        args: ['test'],
        flags: { run: 'run-20250130120000-abc', audit: true, tool: 'Read' },
        cwd,
        interactive: false,
      } as any, 'test');

      spy.mockRestore();

      expect(res?.success).toBe(true);
      const outputText = output.join('\n');
      expect(outputText).toContain('No tool events found for tool "Read"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('org report --format mermaid generates valid Mermaid flowchart', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-mermaid-'));
    try {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'test.json'), JSON.stringify({
        name: 'test',
        roles: [{ id: 'boss', reports_to: null }],
      }));

      const events: BusEvent[] = [
        { id: '1', ts: 1000, org: 'test', run: 'run-20250130120000-abc', type: 'message', from: 'boss', to: 'coder', subject: 'task', msg: 'do it' },
        { id: '2', ts: 2000, org: 'test', run: 'run-20250130120000-abc', type: 'message', from: 'coder', to: 'boss', subject: 'done', msg: 'finished' },
        { id: '3', ts: 3000, org: 'test', run: 'run-20250130120000-abc', type: 'xorg', from: 'test:boss', to: 'other:lead', subject: 'sync', msg: 'hello' },
      ];
      setupOrgRun(cwd, 'test', events);

      const output: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { output.push(a.join(' ')); });

      const res = await reportAction({
        args: ['test'],
        flags: { run: 'run-20250130120000-abc', format: 'mermaid' },
        cwd,
        interactive: false,
      } as any, 'test');

      spy.mockRestore();

      expect(res?.success).toBe(true);
      const outputText = output.join('\n');

      // Check Mermaid structure
      expect(outputText).toContain('flowchart TD');
      expect(outputText).toContain('boss[boss]');
      expect(outputText).toContain('coder[coder]');
      expect(outputText).toContain('lead[lead]');
      expect(outputText).toContain('boss -->|task| coder');
      expect(outputText).toContain('coder -->|done| boss');
      expect(outputText).toContain('boss -->|sync| lead');
      expect(outputText).toContain('classDef');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('org report --format mermaid handles empty runs', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-mermaid-empty-'));
    try {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'test.json'), JSON.stringify({
        name: 'test',
        roles: [{ id: 'boss', reports_to: null }],
      }));

      const events: BusEvent[] = [
        { id: '1', ts: 1000, org: 'test', run: 'run-20250130120000-abc', type: 'status', msg: 'started' },
      ];
      setupOrgRun(cwd, 'test', events);

      const output: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { output.push(a.join(' ')); });

      const res = await reportAction({
        args: ['test'],
        flags: { run: 'run-20250130120000-abc', format: 'mermaid' },
        cwd,
        interactive: false,
      } as any, 'test');

      spy.mockRestore();

      expect(res?.success).toBe(true);
      const outputText = output.join('\n');
      // Should still output valid Mermaid with no message nodes
      expect(outputText).toContain('flowchart TD');
      expect(outputText).toContain('0 messages exchanged');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('org report defaults to regular report when --format is not specified', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-report-default-'));
    try {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'test.json'), JSON.stringify({
        name: 'test',
        roles: [{ id: 'boss', reports_to: null }],
        run_config: { budget_tokens: 1000 },
      }));

      const events: BusEvent[] = [
        { id: '1', ts: 1000, org: 'test', run: 'run-20250130120000-abc', type: 'status', msg: 'started' },
        { id: '2', ts: 2000, org: 'test', run: 'run-20250130120000-abc', type: 'status', from: 'boss', reason: 'org-complete', data: { outcome: 'achieved', summary: 'done' } },
      ];
      setupOrgRun(cwd, 'test', events);

      const output: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { output.push(a.join(' ')); });

      const res = await reportAction({
        args: ['test'],
        flags: { run: 'run-20250130120000-abc' },
        cwd,
        interactive: false,
      } as any, 'test');

      spy.mockRestore();

      expect(res?.success).toBe(true);
      const outputText = output.join('\n');
      // Should show regular report, not Mermaid
      expect(outputText).toContain('ORG REPORT');
      expect(outputText).toContain('Duration:');
      expect(outputText).toContain('Outcome:');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

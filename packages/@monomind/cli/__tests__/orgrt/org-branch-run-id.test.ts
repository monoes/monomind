// packages/@monomind/cli/__tests__/orgrt/org-branch-run-id.test.ts
//
// Regression test for #292: `org branch <org> <run> <label>` reads as though
// <label> names the new run. It does not — checkpoint-ops generates the run id
// and the label is only a note. A scripted caller therefore had to scrape the
// real id out of human-readable stdout (the Org Arena demo did exactly that,
// and printed a replay command for a run that did not exist).
//
// The contract asserted here: the created run id is readable as a field via
// `--format json`, the label is recorded as a note in `.branch-source`, and the
// command's own help does not present the label as the new run's name.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { branchAction } from '../../src/commands/org-observe.js';
import { orgCommand } from '../../src/commands/org.js';
import { ORG_DIR } from '../../src/orgrt/types.js';
import type { CommandContext } from '../../src/types.js';

const SOURCE_RUN = 'run-20250130-aaaa';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'org-branch-292-'));
  const runDir = join(root, ORG_DIR, 'growth', SOURCE_RUN);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'bus.jsonl'), `${JSON.stringify({ type: 'status', msg: 'hi' })}\n`);
  return root;
}

const ctxFor = (root: string, args: string[], flags: Record<string, unknown> = {}): CommandContext =>
  ({ args, flags: { _: [], ...flags }, cwd: root, interactive: false }) as CommandContext;

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('org branch — the created run id is readable, not prose (#292)', () => {
  it('--format json reports the run that actually exists on disk', async () => {
    const root = fixture();
    roots.push(root);

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    const res = await branchAction(
      ctxFor(root, ['growth', SOURCE_RUN, 'pre-outage'], { format: 'json' }),
      'growth',
    );
    expect(res.success).toBe(true);

    const payload = JSON.parse(lines.join('').trim());
    expect(payload.v).toBe(1);
    expect(payload.org).toBe('growth');
    expect(payload.from).toBe(SOURCE_RUN);
    expect(payload.label).toBe('pre-outage');

    // The whole point: `run` names a run a later command can be pointed at.
    expect(typeof payload.run).toBe('string');
    expect(existsSync(join(root, ORG_DIR, 'growth', payload.run, 'bus.jsonl'))).toBe(true);
  });

  it('records the label as a note in .branch-source', async () => {
    const root = fixture();
    roots.push(root);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const res = await branchAction(
      ctxFor(root, ['growth', SOURCE_RUN, 'pre-outage'], { format: 'json' }),
      'growth',
    );
    expect(res.success).toBe(true);
    const { run } = res.data as { run: string };

    const marker = JSON.parse(
      readFileSync(join(root, ORG_DIR, 'growth', run, '.branch-source'), 'utf8'),
    );
    expect(marker.from).toBe(SOURCE_RUN);
    expect(marker.label).toBe('pre-outage');
  });

  it('help does not put the label in the new run\'s name position', () => {
    const branch = (orgCommand.subcommands ?? []).find((c) => c.name === 'branch');
    expect(branch).toBeDefined();

    const help = [
      branch!.description,
      ...(branch!.examples ?? []).map((e) => `${e.command} ${e.description}`),
    ].join('\n');

    // The misleading example from #292 must be gone...
    expect(help).not.toContain('abc-branch');
    // ...the label must read as a label, and the generated id must be findable
    // non-interactively.
    expect(help).toMatch(/<label>/);
    expect(help).toMatch(/--format json/);
  });
});

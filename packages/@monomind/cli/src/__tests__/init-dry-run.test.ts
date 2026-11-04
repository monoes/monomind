import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import '../commands/init.js';
import { planDryRun, runInitDryRun } from '../commands/init-dry-run.js';
import { initWroteLine } from '../init/written-files.js';
import type { CommandContext } from '../types.js';

const dirs: string[] = [];
const mk = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'init-dry-'));
  dirs.push(d);
  return d;
};
const put = (root: string, rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const tree = (root: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(root, p));
    }
  };
  walk(root);
  return out.sort();
};

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('planDryRun', () => {
  it('classifies create / skip (identical) / modify / skip (kept)', () => {
    const scratch = mk();
    const cwd = mk();
    put(scratch, '.claude/a.md', 'new');
    put(scratch, '.claude/same.md', 'same');
    put(scratch, '.claude/changed.md', 'v2');
    put(cwd, '.claude/same.md', 'same');
    put(cwd, '.claude/changed.md', 'v1');
    const byPath = (entries: ReturnType<typeof planDryRun>) =>
      Object.fromEntries(entries.map((e) => [e.path, e.action]));

    expect(
      byPath(planDryRun(scratch, cwd, { force: false, ifMissing: false, initialized: false })),
    ).toEqual({
      '.claude/a.md': 'create',
      '.claude/same.md': 'skip',
      '.claude/changed.md': 'modify',
    });
    expect(
      byPath(planDryRun(scratch, cwd, { force: false, ifMissing: true, initialized: false }))[
        '.claude/changed.md'
      ],
    ).toBe('skip');
    expect(
      byPath(planDryRun(scratch, cwd, { force: false, ifMissing: false, initialized: true }))[
        '.claude/changed.md'
      ],
    ).toBe('skip');
    expect(
      byPath(planDryRun(scratch, cwd, { force: true, ifMissing: false, initialized: true }))[
        '.claude/changed.md'
      ],
    ).toBe('modify');
  });
});

describe('init --dry-run', () => {
  it('lists files and writes nothing to the project', async () => {
    const cwd = mk();
    put(cwd, 'package.json', '{}');
    const before = tree(cwd);
    const ctx = {
      cwd,
      flags: { 'dry-run': true, 'no-graph': true, platforms: 'claude', json: true },
      args: [],
      interactive: false,
    } as unknown as CommandContext;
    const result = await runInitDryRun(ctx, cwd);
    expect(result.success).toBe(true);
    const data = result.data as { files: { path: string; action: string }[] };
    expect(data.files.some((f) => f.path === 'CLAUDE.md' && f.action === 'create')).toBe(true);
    expect(tree(cwd)).toEqual(before);
  }, 120_000);
});

describe('initWroteLine', () => {
  it('summarises written files and points to a next step', () => {
    const line = initWroteLine({
      filesCreated: 3,
      filesUpdated: 1,
      filesUnchanged: 0,
      directoriesCreated: 2,
    });
    expect(line).toBe('Wrote 4 files (3 created, 1 updated). Try next: monomind doctor');
  });
});

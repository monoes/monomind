# Cleanup --scratch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `monomind cleanup --scratch` prunes stale taskdev scratch and abandoned loop state, reusing cleanup's dry-run/`--force` semantics.

**Architecture:** One new pure function `findStaleScratch(cwd, now)` in `cleanup.ts` plus an early branch in the existing `action` when `--scratch` is set. No new files in `src`; one new test file.

**Tech Stack:** TypeScript, node:fs sync APIs, vitest.

## Global Constraints

- `progress.md` in `.monomind/taskdev/` is NEVER pruned (it is the taskdev recovery ledger).
- Unreadable/unparseable loop JSON is skipped, never deleted.
- Only plain files are removed — never directories; symlinks are not followed (lstat only).
- Existing `cleanup` behavior without `--scratch` must be byte-for-byte unchanged.
- Thresholds: taskdev scratch stale after 7 days (mtime); loop JSON stale when `nextRunAt` is >24h in the past; `.stop` files stale when no sibling `<id>.json` exists.
- Files stay under 500 lines (repo rule) — cleanup.ts is 273 lines and stays well under.

---

### Task 1: `--scratch` flag, stale-scratch scan, and tests

**Files:**
- Modify: `packages/@monomind/cli/src/commands/cleanup.ts`
- Test: `packages/@monomind/cli/src/__tests__/cleanup-scratch.test.ts` (create)

**Interfaces:**
- Consumes: `cleanupCommand` (existing `Command` export), `CommandContext` with `{ args, flags, cwd, interactive }`.
- Produces: exported `findStaleScratch(cwd: string, now: number): { path: string; description: string; size: number }[]` (exported for tests); `cleanupCommand.action` handles `flags.scratch === true`.

- [ ] **Step 1: Write the failing test**

Create `packages/@monomind/cli/src/__tests__/cleanup-scratch.test.ts`:

```typescript
// packages/@monomind/cli/src/__tests__/cleanup-scratch.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupCommand, findStaleScratch } from '../commands/cleanup.js';

const DAY = 24 * 60 * 60 * 1000;

/** Build a fixture project with a mix of fresh and stale scratch. */
function makeFixture(): { cwd: string; now: number } {
  const cwd = mkdtempSync(join(tmpdir(), 'cleanup-scratch-'));
  const now = Date.now();
  const old = new Date(now - 8 * DAY);
  const taskdev = join(cwd, '.monomind', 'taskdev');
  const loops = join(cwd, '.monomind', 'loops');
  mkdirSync(taskdev, { recursive: true });
  mkdirSync(loops, { recursive: true });

  // taskdev: one stale brief, one fresh report, one stale ledger (must survive)
  writeFileSync(join(taskdev, 'task-1-brief.md'), 'old brief');
  utimesSync(join(taskdev, 'task-1-brief.md'), old, old);
  writeFileSync(join(taskdev, 'task-2-report.md'), 'fresh report');
  writeFileSync(join(taskdev, 'progress.md'), 'ledger');
  utimesSync(join(taskdev, 'progress.md'), old, old);

  // loops: one abandoned (nextRunAt 2 days ago), one live (nextRunAt in 1 min),
  // one orphaned stopfile, one stopfile paired with a live loop, one corrupt json
  writeFileSync(join(loops, 'dead-1.json'), JSON.stringify({ id: 'dead-1', nextRunAt: now - 2 * DAY }));
  writeFileSync(join(loops, 'live-1.json'), JSON.stringify({ id: 'live-1', nextRunAt: now + 60_000 }));
  writeFileSync(join(loops, 'ghost.stop'), 'stop');
  writeFileSync(join(loops, 'live-1.stop'), 'stop');
  writeFileSync(join(loops, 'corrupt.json'), '{not json');
  return { cwd, now };
}

describe('cleanup --scratch', () => {
  it('findStaleScratch identifies exactly the stale set', () => {
    const { cwd, now } = makeFixture();
    try {
      const paths = findStaleScratch(cwd, now).map(s => s.path).sort();
      expect(paths).toEqual([
        join('.monomind', 'loops', 'dead-1.json'),
        join('.monomind', 'loops', 'ghost.stop'),
        join('.monomind', 'taskdev', 'task-1-brief.md'),
      ]);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('is a no-op when the scratch directories do not exist', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cleanup-empty-'));
    try {
      expect(findStaleScratch(cwd, Date.now())).toEqual([]);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('dry run (default) reports but deletes nothing', async () => {
    const { cwd } = makeFixture();
    try {
      const res = await cleanupCommand.action!({ args: [], flags: { scratch: true }, cwd, interactive: false } as any);
      expect(res?.success).toBe(true);
      expect(existsSync(join(cwd, '.monomind', 'taskdev', 'task-1-brief.md'))).toBe(true);
      expect(existsSync(join(cwd, '.monomind', 'loops', 'dead-1.json'))).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('--force deletes the stale set and preserves everything else', async () => {
    const { cwd } = makeFixture();
    try {
      const res = await cleanupCommand.action!({ args: [], flags: { scratch: true, force: true }, cwd, interactive: false } as any);
      expect(res?.success).toBe(true);
      // deleted
      expect(existsSync(join(cwd, '.monomind', 'taskdev', 'task-1-brief.md'))).toBe(false);
      expect(existsSync(join(cwd, '.monomind', 'loops', 'dead-1.json'))).toBe(false);
      expect(existsSync(join(cwd, '.monomind', 'loops', 'ghost.stop'))).toBe(false);
      // preserved
      expect(existsSync(join(cwd, '.monomind', 'taskdev', 'progress.md'))).toBe(true);
      expect(existsSync(join(cwd, '.monomind', 'taskdev', 'task-2-report.md'))).toBe(true);
      expect(existsSync(join(cwd, '.monomind', 'loops', 'live-1.json'))).toBe(true);
      expect(existsSync(join(cwd, '.monomind', 'loops', 'live-1.stop'))).toBe(true);
      expect(existsSync(join(cwd, '.monomind', 'loops', 'corrupt.json'))).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('plain cleanup (no --scratch) still scans the artifact list, not scratch', async () => {
    const { cwd } = makeFixture();
    try {
      const res = await cleanupCommand.action!({ args: [], flags: {}, cwd, interactive: false } as any);
      expect(res?.success).toBe(true);
      // dry run by default: nothing deleted, and .monomind reported as one artifact dir
      expect(existsSync(join(cwd, '.monomind', 'taskdev', 'task-1-brief.md'))).toBe(true);
      const found = (res?.data as { found?: { path: string }[] })?.found ?? [];
      expect(found.some(f => f.path === '.monomind')).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/@monomind/cli && npx vitest run src/__tests__/cleanup-scratch.test.ts`
Expected: FAIL — `findStaleScratch` is not exported / `--scratch` unhandled.

- [ ] **Step 3: Implement**

In `packages/@monomind/cli/src/commands/cleanup.ts`:

3a. After the `KEEP_CONFIG_PATHS` const (line ~36), add:

```typescript
/** Scratch pruning (--scratch): taskdev handoff files and loop state. */
const SCRATCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // taskdev scratch older than this is stale
const LOOP_STALE_GRACE_MS = 24 * 60 * 60 * 1000;      // a live loop reschedules every <=1h; overdue by a day = abandoned

/**
 * Find stale mastermind scratch under `.monomind/taskdev/` and `.monomind/loops/`.
 * Exported for tests. Never returns `progress.md` (the taskdev recovery ledger),
 * directories, or loop JSON it cannot parse — deleting the unclassifiable loses data.
 */
export function findStaleScratch(cwd: string, now: number): { path: string; description: string; size: number }[] {
  const out: { path: string; description: string; size: number }[] = [];
  const taskdevDir = join(cwd, '.monomind', 'taskdev');
  if (existsSync(taskdevDir)) {
    for (const f of readdirSync(taskdevDir)) {
      if (f === 'progress.md') continue; // the ledger is the recovery map — never auto-prune
      try {
        const st = lstatSync(join(taskdevDir, f));
        if (st.isFile() && now - st.mtimeMs > SCRATCH_MAX_AGE_MS) {
          out.push({ path: join('.monomind', 'taskdev', f), description: 'stale taskdev scratch', size: st.size });
        }
      } catch { /* raced away or unreadable — leave it */ }
    }
  }
  const loopsDir = join(cwd, '.monomind', 'loops');
  if (existsSync(loopsDir)) {
    const entries = readdirSync(loopsDir);
    const jsonStems = new Set(entries.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')));
    for (const f of entries) {
      try {
        const st = lstatSync(join(loopsDir, f));
        if (!st.isFile()) continue;
        if (f.endsWith('.json')) {
          const next = (JSON.parse(readFileSync(join(loopsDir, f), 'utf8')) as { nextRunAt?: number }).nextRunAt ?? 0;
          if (now - next > LOOP_STALE_GRACE_MS) {
            out.push({ path: join('.monomind', 'loops', f), description: 'abandoned loop state', size: st.size });
          }
        } else if (f.endsWith('.stop') && !jsonStems.has(f.replace(/\.stop$/, ''))) {
          out.push({ path: join('.monomind', 'loops', f), description: 'orphaned loop stopfile', size: st.size });
        }
      } catch { /* unparseable or unreadable — never delete what we cannot classify */ }
    }
  }
  return out;
}
```

3b. Register the flag in `options` (after the `keep-config` entry):

```typescript
    {
      name: 'scratch',
      short: 's',
      description: 'Prune only stale mastermind scratch (.monomind/taskdev, abandoned .monomind/loops state)',
      type: 'boolean',
      default: false,
    },
```

3c. Add an example (after the `--force --keep-config` example):

```typescript
    {
      command: 'cleanup --scratch --force',
      description: 'Delete stale taskdev scratch and abandoned loop state',
    },
```

3d. At the top of `action`, right after `const dryRun = !force;`, add the scratch branch:

```typescript
    if (ctx.flags.scratch === true) {
      output.writeln();
      output.writeln(output.bold(dryRun ? 'Monomind Scratch Cleanup (dry run)' : 'Monomind Scratch Cleanup'));
      output.writeln();
      const stale = findStaleScratch(cwd, Date.now());
      if (stale.length === 0) {
        output.writeln(output.info('No stale scratch found.'));
        return { success: true, message: 'Nothing to clean' };
      }
      let removed = 0;
      let removedSize = 0;
      for (const item of stale) {
        const sizeStr = formatSize(item.size);
        if (dryRun) {
          output.writeln(output.warning(`  [would remove] file  ${item.path}  (${sizeStr}) - ${item.description}`));
        } else {
          try {
            rmSync(join(cwd, item.path), { force: true });
            output.writeln(output.success(`  [removed] file  ${item.path}  (${sizeStr}) - ${item.description}`));
            removed++;
            removedSize += item.size;
          } catch (err) {
            output.writeln(output.error(`  [failed] file  ${item.path}  - ${err instanceof Error ? err.message : String(err)}`));
          }
        }
      }
      output.writeln();
      if (dryRun) {
        output.writeln(output.dim(`  ${stale.length} stale file(s). This was a dry run. Use --force to delete.`));
        output.writeln();
        return { success: true, message: `Dry run: ${stale.length} stale scratch file(s) found`, data: { found: stale, dryRun } };
      }
      output.writeln(`  Removed ${removed} file(s) totaling ${formatSize(removedSize)}`);
      output.writeln();
      return { success: true, message: `Removed ${removed} stale scratch file(s)`, data: { found: stale, removedCount: removed, removedSize, dryRun } };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/@monomind/cli && npx vitest run src/__tests__/cleanup-scratch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify no regression + typecheck**

Run: `cd packages/@monomind/cli && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (or only pre-existing errors — report any).

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/src/commands/cleanup.ts packages/@monomind/cli/src/__tests__/cleanup-scratch.test.ts
git commit -m "feat(cli): cleanup --scratch prunes stale taskdev scratch and abandoned loop state

Co-Authored-By: nokhodian <nokhodian@gmail.com>"
```

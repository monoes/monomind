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
  // live loops that would be misclassified as abandoned by a naive `?? 0` check
  writeFileSync(join(loops, 'live-zero.json'), JSON.stringify({ id: 'live-zero', nextRunAt: 0, status: 'running' }));
  writeFileSync(join(loops, 'live-null.json'), JSON.stringify({ id: 'live-null', nextRunAt: null }));
  writeFileSync(join(loops, 'weird.json'), JSON.stringify({ id: 'weird', nextRunAt: 'soon' }));
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

  it('never classifies live nextRunAt (0, null, non-numeric) as abandoned', () => {
    const { cwd, now } = makeFixture();
    try {
      const paths = findStaleScratch(cwd, now).map(s => s.path);
      expect(paths).not.toContain(join('.monomind', 'loops', 'live-zero.json'));
      expect(paths).not.toContain(join('.monomind', 'loops', 'live-null.json'));
      expect(paths).not.toContain(join('.monomind', 'loops', 'weird.json'));
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
      expect(existsSync(join(cwd, '.monomind', 'loops', 'live-zero.json'))).toBe(true);
      expect(existsSync(join(cwd, '.monomind', 'loops', 'live-null.json'))).toBe(true);
      expect(existsSync(join(cwd, '.monomind', 'loops', 'weird.json'))).toBe(true);
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

describe('findOrphanedProjectData (--data)', () => {
  it('classifies dirs by origin marker: live kept, orphaned pruned, lancedb flagged, unknown age-gated', async () => {
    const { findOrphanedProjectData } = await import('../commands/cleanup.js');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const base = mkdtempSync(join(tmpdir(), 'proj-data-'));
    const liveProject = mkdtempSync(join(tmpdir(), 'live-proj-'));
    try {
      // live with ACTIVE store: the dir is named lancedb but holds the current
      // engine's memory.db — must NEVER be flagged (the critical data-loss case)
      mkdirSync(join(base, 'live-abc', 'lancedb'), { recursive: true });
      writeFileSync(join(base, 'live-abc', 'lancedb', 'memory.db'), 'sqlite');
      writeFileSync(join(base, 'live-abc', 'origin.json'), JSON.stringify({ path: liveProject }));
      // live with genuine dead LanceDB leftovers (*.lance, no memory.db)
      mkdirSync(join(base, 'live-old', 'lancedb', 'default.lance'), { recursive: true });
      writeFileSync(join(base, 'live-old', 'origin.json'), JSON.stringify({ path: liveProject }));
      // orphan: origin recorded, path gone, but parent volume IS mounted
      mkdirSync(join(base, 'gone-def'), { recursive: true });
      writeFileSync(join(base, 'gone-def', 'origin.json'), JSON.stringify({ path: join(tmpdir(), 'no-such-project-xyz') }));
      // origin unreachable because the whole volume is absent — must be kept
      mkdirSync(join(base, 'unmounted-vol'), { recursive: true });
      writeFileSync(join(base, 'unmounted-vol', 'origin.json'), JSON.stringify({ path: '/Volumes/no-such-volume-zz/project' }));
      // unknown fresh: no marker, recent mtime
      mkdirSync(join(base, 'fresh-ghi'), { recursive: true });
      // unknown old: no marker, 60 days old
      mkdirSync(join(base, 'old-jkl'), { recursive: true });
      const old = (Date.now() - 60 * 24 * 3600 * 1000) / 1000;
      utimesSync(join(base, 'old-jkl'), old, old);
      // unknown old dir whose memory.db was written recently — active, keep
      mkdirSync(join(base, 'old-active', 'lancedb'), { recursive: true });
      writeFileSync(join(base, 'old-active', 'lancedb', 'memory.db'), 'sqlite');
      utimesSync(join(base, 'old-active'), old, old);

      const now = Date.now();
      const normal = findOrphanedProjectData(base, now, false);
      const paths = normal.map(o => o.path);
      expect(paths).not.toContain(join(base, 'live-abc', 'lancedb')); // LIVE store — never prunable
      expect(paths).not.toContain(join(base, 'live-abc'));
      expect(paths).toContain(join(base, 'live-old', 'lancedb'));     // genuine LanceDB leftovers
      expect(paths).toContain(join(base, 'gone-def'));                // provably orphaned
      expect(paths).not.toContain(join(base, 'unmounted-vol'));       // volume absent ≠ project deleted
      expect(paths).not.toContain(join(base, 'fresh-ghi'));           // unknown but recent
      expect(paths).toContain(join(base, 'old-jkl'));                 // unknown and stale
      expect(paths).not.toContain(join(base, 'old-active'));          // recent memory.db write = active

      const aggressive = findOrphanedProjectData(base, now, true);
      expect(aggressive.map(o => o.path)).toContain(join(base, 'fresh-ghi')); // aggressive prunes unprovable
      expect(aggressive.map(o => o.path)).not.toContain(join(base, 'live-abc'));
      expect(aggressive.map(o => o.path)).not.toContain(join(base, 'live-abc', 'lancedb'));
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(liveProject, { recursive: true, force: true });
    }
  });
});

/**
 * i-052 commit 3, AC-6/AC-7 — `startServer` must warn about a git-tracked
 * `.monomind/dashboard-token` at STARTUP, not only at `monomind init`
 * (executor.ts). The dashboard is what writes the file; a user who never
 * re-runs `init` after it got committed (e.g. any project inited before
 * commits 1-2 shipped `.gitignore` coverage for it) would otherwise never
 * see this warning at all.
 *
 * Own server instance, own real git-tracked temp project, own port — kept
 * separate from ui-server-security.test.ts's shared `beforeAll` server so
 * this doesn't plant a tracked credential file in a fixture other tests
 * share.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// server.mjs is plain ESM shipped as-is; import it directly.
// @ts-expect-error — .mjs sibling has no type declarations
import * as uiServer from '../src/ui/server.mjs';

const { startServer } = uiServer as any;

let projectDir: string;
let httpServer: any;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'monomind-dashboard-startup-warn-'));
  mkdirSync(join(projectDir, '.monomind'), { recursive: true });
});

afterEach(async () => {
  try {
    httpServer?.closeAllConnections?.();
    httpServer?.close();
  } catch {
    /* best effort */
  }
  rmSync(projectDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it('AC-6: warns at dashboard startup when dashboard-token is already git-tracked', async () => {
  execFileSync('git', ['init', '--quiet'], { cwd: projectDir });
  const secret = /* value */ 'FAKE-STARTUP-WARN-should-never-print';
  writeFileSync(join(projectDir, '.monomind', 'dashboard-token'), secret);
  execFileSync('git', ['add', '.monomind/dashboard-token'], { cwd: projectDir });

  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = await startServer({ port: 4923, projectDir, openBrowser: false });
  httpServer = res.server;

  const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
  expect(printed).toContain('.monomind/dashboard-token');
  expect(printed).toContain('git rm --cached .monomind/dashboard-token');
  expect(printed).not.toContain(secret);
}, 30_000);

it('AC-7 (control): no warning when dashboard-token does not exist yet', async () => {
  execFileSync('git', ['init', '--quiet'], { cwd: projectDir });

  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = await startServer({ port: 4924, projectDir, openBrowser: false });
  httpServer = res.server;

  const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
  expect(printed).not.toContain('dashboard-token exposure');
}, 30_000);

it('AC-7 (control): no warning when dashboard-token exists but is untracked', async () => {
  execFileSync('git', ['init', '--quiet'], { cwd: projectDir });
  writeFileSync(join(projectDir, '.monomind', 'dashboard-token'), 'untracked-value');

  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = await startServer({ port: 4925, projectDir, openBrowser: false });
  httpServer = res.server;

  const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
  expect(printed).not.toContain('dashboard-token exposure');
}, 30_000);

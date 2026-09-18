/**
 * Guard for #284: `overrides` blocks in package.json are dead under pnpm v10
 * (workspace overrides come from pnpm-workspace.yaml) but read as protection.
 * These tests pin both halves — the real repo stays clean, and a reintroduced
 * block fails with a per-entry verdict.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-overrides-source.mjs');

const WORKSPACE_YAML = `packages:
  - 'packages/@scope/*'

overrides:
  sharp: '>=0.35.4'
  vitest: '>=4.1.11 <5'

onlyBuiltDependencies:
  - better-sqlite3
`;

const made = [];
afterEach(() => {
  while (made.length) rmSync(made.pop(), { recursive: true, force: true });
});

function fixture({ rootOverrides, memberOverrides, memberResolutions } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'overrides-guard-'));
  made.push(dir);
  writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), WORKSPACE_YAML);
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'root', ...(rootOverrides ? { overrides: rootOverrides } : {}) }),
  );
  const member = path.join(dir, 'packages/@scope/thing');
  mkdirSync(member, { recursive: true });
  writeFileSync(
    path.join(member, 'package.json'),
    JSON.stringify({
      name: '@scope/thing',
      ...(memberOverrides ? { overrides: memberOverrides } : {}),
      ...(memberResolutions ? { resolutions: memberResolutions } : {}),
    }),
  );
  return dir;
}

const run = (root) => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf-8' });

describe('check-overrides-source.mjs (#284)', () => {
  it('passes on this repo — no package.json declares overrides or resolutions', () => {
    const r = run(REPO_ROOT);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('sourced only from pnpm-workspace.yaml');
  });

  it('passes on a clean fixture', () => {
    const r = run(fixture());
    expect(r.status).toBe(0);
  });

  it('fails on a root overrides block and reports an already-covered entry as deletable', () => {
    const r = run(fixture({ rootOverrides: { sharp: '>=0.35.4' } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('package.json declares "overrides"');
    expect(r.stderr).toContain('already identical in pnpm-workspace.yaml');
  });

  it('flags an entry that disagrees with pnpm-workspace.yaml and names the applied range', () => {
    const r = run(fixture({ rootOverrides: { vitest: '^4.1.11' } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('DISAGREES with pnpm-workspace.yaml (>=4.1.11 <5)');
  });

  it('flags an entry that exists in no override source at all', () => {
    const r = run(fixture({ rootOverrides: { 'onnxruntime-node': '>=1.27.0' } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NOT in pnpm-workspace.yaml');
    expect(r.stderr).toContain('applied nowhere');
  });

  it("flags a workspace member's own overrides, which pnpm and npm both ignore", () => {
    const r = run(fixture({ memberOverrides: { sharp: '>=0.35.4' } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(path.join('packages/@scope/thing', 'package.json'));
  });

  it('flags a yarn-style resolutions block too', () => {
    const r = run(fixture({ memberResolutions: { sharp: '>=0.35.4' } }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('declares "resolutions"');
  });

  it('reports every offending manifest in one run', () => {
    const r = run(
      fixture({ rootOverrides: { sharp: '>=0.35.4' }, memberOverrides: { vitest: '^4.1.11' } }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('@scope/thing');
    expect(r.stderr.match(/declares "overrides"/g)).toHaveLength(2);
  });
});

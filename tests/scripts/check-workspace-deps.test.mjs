/**
 * Regression test for #148: monomind@2.9.14 published with 5 unresolved
 * `workspace:*` deps despite this guard existing (issue #130). Root cause —
 * this script only scanned dependencies/devDependencies/peerDependencies,
 * silently missing the 4 of 5 affected deps that live under
 * optionalDependencies (@monoes/hooks, @monoes/mcp, @monoes/memory,
 * @monoes/routing) and only catching @monoes/monograph.
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  '../../packages/@monomind/cli/scripts/check-workspace-deps.mjs',
);

function run(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

describe('check-workspace-deps.mjs scans optionalDependencies too (#148)', () => {
  it('lists all 5 known workspace:* deps, including the 4 under optionalDependencies', () => {
    const r = run({});
    expect(r.status).toBe(0);
    for (const dep of [
      '@monoes/monograph',
      '@monoes/hooks',
      '@monoes/mcp',
      '@monoes/memory',
      '@monoes/routing',
    ]) {
      expect(r.stdout).toContain(dep);
    }
  });

  it('blocks a simulated plain-npm publish, citing the optionalDependencies-only deps', () => {
    const r = run({
      npm_lifecycle_event: 'prepublishOnly',
      npm_config_user_agent: 'npm/10.0.0',
      MONOMIND_ALLOW_NPM_PUBLISH: '',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('@monoes/hooks');
    expect(r.stderr).toContain('@monoes/routing');
  });

  it('allows a simulated pnpm publish', () => {
    const r = run({ npm_lifecycle_event: 'prepublishOnly', npm_config_user_agent: 'pnpm/9.0.0' });
    expect(r.status).toBe(0);
  });
});

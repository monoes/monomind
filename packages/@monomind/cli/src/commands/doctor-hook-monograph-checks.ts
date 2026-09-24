/**
 * Doctor — can the hooks keep the graph fresh? (#328)
 *
 * The MCP server brings its own @monoes/monograph, but the hooks
 * (monograph-freshen.cjs at SessionStart, the post-edit rebuild, the grep gate
 * and search hints) resolve their own copy. When they can't, the graph goes
 * stale without a word and, past 50 commits, the gate and hints switch off.
 * This check runs the hooks' own resolver (the project's copy of
 * utils/monograph-resolve.cjs, else the one bundled with this package), so it
 * reports exactly what the hooks see.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HealthCheck } from './doctor-env-checks.js';

const NAME = 'Hook graph rebuild';
const REL = join('.claude', 'helpers', 'utils', 'monograph-resolve.cjs');
const HERE = dirname(fileURLToPath(import.meta.url));

export interface ResolveOptions {
  globalRoot?: string | null;
  npxCacheDir?: string;
  pathEnv?: string;
}

interface Diagnosis {
  resolved: { source: string; version: string; pkgDir: string } | null;
  cliBin: string | null;
  dbExists: boolean;
  behind: number | null;
  canRebuild: boolean;
  problem: string | null;
  fix: string | null;
  lastStatus: { ok: boolean; message?: string; fix?: string | null; repeats?: number } | null;
}

interface ResolveModule {
  STALE_LIMIT: number;
  diagnose(projectDir: string, opts?: ResolveOptions): Diagnosis;
}

function loadResolver(cwd: string): ResolveModule | null {
  const candidates = [
    join(cwd, REL),
    // src/commands → ../.. is the package root; dist/src/commands → ../../..
    join(HERE, '..', '..', REL),
    join(HERE, '..', '..', '..', REL),
  ];
  const file = candidates.find((p) => existsSync(p));
  try {
    return file ? (createRequire(import.meta.url)(file) as ResolveModule) : null;
  } catch {
    return null;
  }
}

export async function checkHookMonograph(
  cwd: string = process.cwd(),
  opts?: ResolveOptions,
): Promise<HealthCheck> {
  const mod = loadResolver(cwd);
  if (!mod) {
    return {
      name: NAME,
      status: 'warn',
      message: 'utils/monograph-resolve.cjs is missing, so the hooks cannot rebuild the graph',
      fix: 'npx monomind init upgrade',
    };
  }
  const d = mod.diagnose(cwd, opts);
  const limit = mod.STALE_LIMIT;
  const pastLimit = d.dbExists && d.behind !== null && d.behind > limit;
  if (!d.canRebuild) {
    return {
      name: NAME,
      status: pastLimit ? 'fail' : 'warn',
      message: pastLimit
        ? `Graph ${d.behind} commits behind HEAD and the hooks can't rebuild it: ${d.problem}`
        : `The hooks can't rebuild the graph: ${d.problem}`,
      fix: d.fix ?? undefined,
    };
  }
  if (pastLimit) {
    return {
      name: NAME,
      status: 'warn',
      message: `Graph ${d.behind} commits behind HEAD (limit ${limit}): the grep gate and search hints are off until it is rebuilt`,
      fix: 'npx monomind monograph build',
    };
  }
  if (d.lastStatus && d.lastStatus.ok === false) {
    const times = (d.lastStatus.repeats ?? 1) > 1 ? ` (${d.lastStatus.repeats}x)` : '';
    return {
      name: NAME,
      status: 'warn',
      message: `Last hook rebuild failed${times}: ${d.lastStatus.message}`,
      fix: d.lastStatus.fix ?? 'cat .monomind/graph/build.log',
    };
  }
  const via = d.resolved
    ? `@monoes/monograph v${d.resolved.version} (${d.resolved.source})`
    : `monomind monograph build (${d.cliBin})`;
  return { name: NAME, status: 'pass', message: `Hooks rebuild the graph with ${via}` };
}

/**
 * Doctor — monograph checks: installed monograph/memory packages and graph
 * freshness. Extracted from doctor-project-checks.ts.
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyNativeModuleError,
  extractNativeModulePackageName,
} from '../utils/native-error.js';
import {
  type HealthCheck,
  MAX_DOCTOR_BUILD_LOG_SCAN_BYTES,
  MAX_DOCTOR_PKG_BYTES,
} from './doctor-env-checks.js';

// Resolve an installed package's package.json through Node's real ESM
// resolution algorithm instead of guessing relative node_modules layouts.
// The old candidate-path approach assumed a nested install shape that never
// matches how npm actually hoists dependencies (flat local installs, npx's
// isolated cache dir, and global installs all put @monoes/* packages as
// siblings, not nested under this package's dist/ output) — so it always
// reported "not found" even when the package was present and importable.
// import.meta.resolve() is used (rather than createRequire().resolve()())
// because @monoes/monograph and @monoes/memory are ESM-only (no "require"
// export condition), so a CJS require.resolve() fails outright even when the
// package is installed. Their exports maps also don't expose a "./package.json"
// subpath, so the entry file is resolved first and package.json is found by
// walking up from it.
function _findInstalledPackageJson(
  specifier: string,
): { path: string; pkg: Record<string, unknown> } | null {
  try {
    const entryUrl = import.meta.resolve(specifier);
    let dir = dirname(fileURLToPath(entryUrl));
    for (;;) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate) && statSync(candidate).size <= MAX_DOCTOR_PKG_BYTES) {
        try {
          const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
          if (pkg.name === specifier) return { path: candidate, pkg };
        } catch {
          /* keep walking */
        }
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

export async function checkMonograph(): Promise<HealthCheck> {
  const found = _findInstalledPackageJson('@monoes/monograph');
  if (found) {
    return {
      name: 'Monograph',
      status: 'pass',
      message: `v${found.pkg.version || '?'} available (knowledge graph engine)`,
    };
  }
  return {
    name: 'Monograph',
    status: 'warn',
    message: 'Package not found (knowledge graph disabled)',
    fix: 'npm install -g monomind@latest',
  };
}

function formatAge(ms: number): string {
  // Filesystem mtime can round to whole seconds and land a hair ahead of
  // Date.now() for a file written moments ago — clamp so that never reads
  // as a negative, nonsensical age.
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

/**
 * Best-effort "when was this package's own install last touched" probe,
 * used only to soften a build.log-based failure (see #244) — never to
 * harden one, so a wrong or missing answer here is always safe. Resolves
 * `pkgName` from `cwd` (works through pnpm's symlinked store too, since
 * `require.resolve` follows symlinks to the real file) and returns the
 * latest mtime among its package.json and any `build/`/`prebuilds/` binary
 * output, or null if the package can't be resolved at all — the caller
 * treats null as "no evidence either way," not as "confirmed still broken."
 */
function findNativeModuleLastModifiedMs(pkgName: string, cwd: string): number | null {
  try {
    const require = createRequire(join(cwd, 'noop.js'));
    const entry = require.resolve(pkgName, { paths: [cwd] });
    let pkgDir = dirname(entry);
    for (let i = 0; i < 12 && !existsSync(join(pkgDir, 'package.json')); i++) {
      const parent = dirname(pkgDir);
      if (parent === pkgDir) return null;
      pkgDir = parent;
    }
    let latestMs = statSync(join(pkgDir, 'package.json')).mtimeMs;
    for (const sub of ['build', 'prebuilds']) {
      const subDir = join(pkgDir, sub);
      if (!existsSync(subDir)) continue;
      const stack = [subDir];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const entryName of readdirSync(current)) {
          const full = join(current, entryName);
          const st = statSync(full);
          if (st.isDirectory()) stack.push(full);
          else if (st.mtimeMs > latestMs) latestMs = st.mtimeMs;
        }
      }
    }
    return latestMs;
  } catch {
    return null;
  }
}

async function monographFreshnessCore(): Promise<HealthCheck> {
  try {
    const cwd = process.cwd();
    const dbPath = join(cwd, '.monomind', 'monograph.db');
    const lockPath = join(cwd, '.monomind', 'graph', 'build.lock');
    const statsPath = join(cwd, '.monomind', 'graph', 'stats.json');
    const logPath = join(cwd, '.monomind', 'graph', 'build.log');
    const hasDb = existsSync(dbPath);
    if (!hasDb && !existsSync(statsPath)) {
      // No graph yet — but that's one of three very different situations: a
      // build is genuinely still running, one already ran and crashed (e.g.
      // executor.ts's initKnowledgeGraph or monograph-freshen.cjs's detached
      // spawn hit a native-module ABI mismatch), or nothing was ever
      // attempted. Both spawners share this same build.lock/build.log pair,
      // so this one check covers either origin.
      //
      // Lock existence (not freshness) is the right signal here: both
      // spawners write build.lock with their OWN pid (the short-lived parent
      // that immediately exits after spawning a detached child — not the
      // child actually doing the build, so checking that pid's liveness
      // would be checking the wrong process) and unlink it in a `finally`
      // that runs on both success and a thrown/rejected build — so it's only
      // ever left behind while the child is still actually running, or in
      // the rare case of a hard OS-level kill that bypassed the `finally`.
      // A large monorepo's first index can legitimately run well past any
      // fixed "freshness" window, so age must not turn a live build into a
      // false failure report. Neither spawner passes buildAsync an
      // onProgress callback, so a clean run writes nothing to build.log
      // until it's done — there's no heartbeat to check the log against, so
      // this is worded to cover both "still running" and "was killed
      // without cleaning up" rather than asserting liveness that can't
      // actually be confirmed from disk.
      if (existsSync(lockPath)) {
        const ageMs = (() => {
          try {
            return Date.now() - statSync(lockPath).mtimeMs;
          } catch {
            return 0;
          }
        })();
        return {
          name: 'Graph freshness',
          status: 'warn',
          message: `Monograph build in progress, or was interrupted — started ${formatAge(ageMs)} ago`,
        };
      }
      if (existsSync(logPath)) {
        let logTail = '';
        try {
          const raw = readFileSync(logPath, 'utf8');
          // Bound the scan to the last MAX_BUILD_LOG_SCAN_BYTES, not the last
          // 4000 — that window was cutting the actual "Error:"/"Exception:"
          // text out of real Node uncaught-exception dumps. A native-module
          // load failure (e.g. `bindings` walking a dozen candidate .node
          // paths before giving up) prints its message and stack FIRST, then
          // a long list of tried paths — a single such dump easily runs
          // 7-8KB, so a 4000-char tail can land entirely inside the path
          // list and see no error keyword at all, even though the log is
          // nothing but a crash report. 64KB comfortably fits many realistic
          // crash dumps (including chained causes) while still bounding this
          // append-only, never-truncated file for a long-lived project that
          // has failed and retried many times.
          logTail =
            raw.length > MAX_DOCTOR_BUILD_LOG_SCAN_BYTES
              ? raw.slice(-MAX_DOCTOR_BUILD_LOG_SCAN_BYTES)
              : raw;
        } catch {
          /* unreadable log — treat as no evidence, fall through below */
        }
        // build.log only proves a build ran at some point — a *successful*
        // build also writes into it before producing monograph.db, so its
        // mere existence isn't evidence of failure (e.g. monograph.db was
        // deleted afterward, leaving a clean run's log behind). Only treat
        // this as a failure when the tail actually looks error-shaped;
        // otherwise this isn't distinguishable from "never built" and
        // should read that way rather than as an unsupported "fail".
        const classified = logTail ? classifyNativeModuleError(logTail) : null;
        const looksLikeFailure = classified !== null || /error|exception|traceback/i.test(logTail);
        if (looksLikeFailure) {
          let logMtimeMs = 0;
          let logAgeStr = '';
          try {
            logMtimeMs = statSync(logPath).mtimeMs;
            logAgeStr = ` (${formatAge(Date.now() - logMtimeMs)} ago)`;
          } catch {
            /* ignore */
          }
          if (classified) {
            // build.log is append-only (see the comment above), so this
            // failure might be historical — already fixed by a `npm
            // rebuild` that ran after this log entry, just not yet
            // confirmed by a fresh `monograph build`. When the implicated
            // module's own files are demonstrably newer than the log entry,
            // that's concrete on-disk evidence it was touched since, so
            // soften to a warning instead of asserting it's still broken.
            // No evidence either way (can't resolve the module, or its
            // files are no newer) falls through to the unchanged 'fail'.
            const pkgName = extractNativeModulePackageName(logTail);
            const moduleMs = pkgName ? findNativeModuleLastModifiedMs(pkgName, cwd) : null;
            if (pkgName && moduleMs !== null && moduleMs > logMtimeMs) {
              return {
                name: 'Graph freshness',
                status: 'warn',
                message:
                  `${classified}${logAgeStr} — but \`${pkgName}\` was modified more recently ` +
                  `(${formatAge(Date.now() - moduleMs)} ago) than this log entry, so it may ` +
                  'already be fixed. Run monograph build to confirm.',
                fix: 'mcp__monomind__monograph_build codeOnly:true',
              };
            }
          }
          return classified
            ? { name: 'Graph freshness', status: 'fail', message: `${classified}${logAgeStr}` }
            : {
                name: 'Graph freshness',
                status: 'fail',
                message: `Monograph build failed${logAgeStr} — see .monomind/graph/build.log for details`,
                fix: 'cat .monomind/graph/build.log',
              };
        }
      }
      return {
        name: 'Graph freshness',
        status: 'warn',
        message: 'No monograph graph built yet',
        fix: 'mcp__monomind__monograph_build codeOnly:true',
      };
    }
    // Deliberately NOT folding build.lock's mtime into this — a lock only
    // means "a build started," not "the graph was built at this time," and
    // counting it here would report a stale graph as freshly-built the
    // moment a rebuild kicks off, before it's actually produced anything.
    let buildMs = 0;
    if (hasDb) {
      try {
        buildMs = Math.max(buildMs, statSync(dbPath).mtimeMs);
      } catch {
        /* ignore */
      }
    }
    try {
      buildMs = Math.max(buildMs, statSync(statsPath).mtimeMs);
    } catch {
      /* ignore */
    }
    if (buildMs === 0)
      return {
        name: 'Graph freshness',
        status: 'warn',
        message: 'Graph exists but build time unknown',
      };

    const buildIso = new Date(buildMs).toISOString();
    let commitsBehind = 0;
    try {
      const out = execSync(`git rev-list --count --since='${buildIso}' HEAD 2>/dev/null`, {
        encoding: 'utf8',
        timeout: 2000,
        cwd,
      }).trim();
      commitsBehind = parseInt(out, 10) || 0;
    } catch {
      /* git unavailable */
    }

    const ageStr = `${formatAge(Date.now() - buildMs)} ago`;
    if (commitsBehind === 0)
      return {
        name: 'Graph freshness',
        status: 'pass',
        message: `FRESH — built ${ageStr}, 0 commits behind`,
      };
    if (commitsBehind <= 5)
      return {
        name: 'Graph freshness',
        status: 'warn',
        message: `${commitsBehind} commit(s) behind — built ${ageStr}`,
        fix: 'mcp__monomind__monograph_build codeOnly:true',
      };
    return {
      name: 'Graph freshness',
      status: 'fail',
      message: `STALE — ${commitsBehind} commits behind (built ${ageStr})`,
      fix: 'mcp__monomind__monograph_build codeOnly:true',
    };
  } catch {
    return { name: 'Graph freshness', status: 'warn', message: 'Could not check graph freshness' };
  }
}

export async function checkMonoesMemory(): Promise<HealthCheck> {
  // See _findInstalledPackageJson() above checkMonograph(): resolve through
  // Node's ESM module resolution instead of guessing a node_modules layout
  // that doesn't match how npm actually hoists dependencies.
  const found = _findInstalledPackageJson('@monoes/memory');
  if (found) {
    return {
      name: 'Vector Memory',
      status: 'pass',
      message: `@monoes/memory v${found.pkg.version || '?'} (HNSW search enabled)`,
    };
  }
  return {
    name: 'Vector Memory',
    status: 'warn',
    message: '@monoes/memory not installed (vector search disabled)',
    fix: 'npm install @monoes/memory',
  };
}

/** Whether the project's graph indexes tool-managed assets (.pi/, .claude agents and skills); null when unknown. */
export function readToolAssetsSetting(cwd: string): boolean | null {
  const dbPath = join(cwd, '.monomind', 'monograph.db');
  if (!existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const db = new DatabaseSync(`file:${dbPath}?immutable=1`, { readOnly: true });
    try {
      const row = db.prepare("SELECT value FROM index_meta WHERE key = 'tool_assets'").get() as
        | { value: string }
        | undefined;
      return row ? row.value === '1' : false;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function checkMonographFreshness(): Promise<HealthCheck> {
  const check = await monographFreshnessCore();
  const on = readToolAssetsSetting(process.cwd());
  if (on === null) return check;
  const note = `tool-asset indexing ${on ? 'on' : 'off (opt in: monomind monograph build --tool-assets)'}`;
  return { ...check, message: `${check.message} · ${note}` };
}

/**
 * Semantic (plain-language) search needs a local embedding model and vectors for
 * the graph's summaries. Without either, search quietly falls back to keywords —
 * this says so, and what to run.
 */
export async function checkMonographSemantic(
  cwd: string = process.cwd(),
  modelAvailable?: () => Promise<boolean>,
): Promise<HealthCheck> {
  const name = 'Graph semantic search';
  try {
    const dbPath = join(cwd, '.monomind', 'monograph.db');
    if (!existsSync(dbPath)) return { name, status: 'pass', message: 'No graph built yet' };
    // Immutable read-only: `doctor` must not touch the project, and a normal open of
    // a WAL database (or monograph's own openDb, which migrates) writes files.
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const db = new DatabaseSync(`file:${dbPath}?immutable=1`, { readOnly: true });
    const count = (sql: string): number => {
      try {
        return Number((db.prepare(sql).get() as { n: number }).n);
      } catch {
        return 0; // table missing: an index from before that feature
      }
    };
    let status: { total: number; embedded: number; model: string | null };
    try {
      const model = (() => {
        try {
          return (
            (
              db.prepare("SELECT value FROM index_meta WHERE key = 'embedding_model'").get() as
                | { value: string }
                | undefined
            )?.value ?? null
          );
        } catch {
          return null;
        }
      })();
      status = {
        total: count('SELECT COUNT(*) AS n FROM node_summaries_fts'),
        embedded: count(
          'SELECT COUNT(*) AS n FROM node_embeddings e JOIN node_summaries_fts s ON s.node_id = e.node_id',
        ),
        model,
      };
    } finally {
      db.close();
    }
    if (status.total === 0)
      return {
        name,
        status: 'warn',
        message: 'Graph has no symbol summaries (built before they existed) — keyword search only',
        fix: 'mcp__monomind__monograph_build force:true',
      };
    if (status.embedded >= status.total)
      return {
        name,
        status: 'pass',
        message: `${status.embedded}/${status.total} summaries embedded (${status.model})`,
      };
    const available = await (
      modelAvailable ?? (await import('../mcp-tools/monograph/semantic.js')).semanticModelAvailable
    )();
    if (!available)
      return {
        name,
        status: 'warn',
        message: `Embedding model not installed — plain-language search is keyword only (${status.embedded}/${status.total} embedded)`,
        fix: 'monomind download-embeddings',
      };
    return {
      name,
      status: 'warn',
      message: `${status.embedded}/${status.total} summaries embedded — catching up in the background`,
      fix: 'monomind monograph embed',
    };
  } catch {
    return { name, status: 'warn', message: 'Could not check semantic search' };
  }
}

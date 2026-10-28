/**
 * Helpers Generator
 * Creates utility scripts in .claude/helpers/
 */

import {
  generateMemoryHelper,
  generatePostCommitHook,
  generatePreCommitHook,
  generateSessionManager,
} from './helpers-core-scripts.js';
import { generateHookHandler } from './helpers-hook-handler.js';
import {
  generateCrossPlatformSessionManager,
  generateWindowsBatchWrapper,
  generateWindowsDaemonManager,
} from './helpers-platform-scripts.js';
import { generateStatuslineHook, generateStatuslineScript } from './statusline-generator.js';
import type { InitOptions } from './types.js';

export {
  generateCrossPlatformSessionManager,
  generateHookHandler,
  generateMemoryHelper,
  generatePostCommitHook,
  generatePreCommitHook,
  generateSessionManager,
  generateWindowsBatchWrapper,
  generateWindowsDaemonManager,
};

// ── Canonical helper-file registry ──────────────────────────────────────────
// Single source of truth for which top-level .claude/helpers/ files are
// critical, what generates each one as a fallback, and which of the
// previously-independent call sites (doctor's staleness check, init
// upgrade's force-sync step, init upgrade's broader fallback-if-missing
// step) need to know about it. These 3 lists used to be hardcoded
// separately in doctor-project-checks.ts and executor.ts and drifted
// (one helper was missing from one of them for 3 releases) — see
// docs/mastermind/plans/2026-07-17-app-audit-plan.md.
export interface HelperFileSpec {
  /** Force-overwritten from source (or regenerated as fallback) on every `init upgrade` run. */
  forceSync?: boolean;
  /** Checked for staleness/existence by `doctor` (in addition to everything under handlers/ and utils/, discovered dynamically). */
  doctorTracked?: boolean;
  /** Fallback content generator, used when the file can't be copied from source. */
  generate?: () => string;
}

export const HELPER_FILES: Record<string, HelperFileSpec> = {
  'hook-handler.cjs': { forceSync: true, doctorTracked: true, generate: generateHookHandler },
  'statusline.cjs': { forceSync: true, doctorTracked: true },
  'monograph-freshen.cjs': { forceSync: true, doctorTracked: true },
  'control-start.cjs': { forceSync: true, doctorTracked: true },
  // Regenerates skill-registry.json (which jev-catalog.cjs reads) from the
  // live skill trees and the Org library. No fallback generator: if it can't
  // be copied there is nothing to regenerate the registry with. init/upgrade
  // run it; the index is never copied.
  'build-skill-registry.cjs': { forceSync: true, doctorTracked: true },
  // Builds .monomind/registry.json (project, ~/.claude/agents and extra
  // agents); the CLI's src/agents/registry-builder.ts loads the same file, and
  // SessionStart (handlers/pick-core.cjs) rebuilds a stale registry with it.
  'agent-registry.cjs': { forceSync: true, doctorTracked: true },
  // The Org skill library read from CommonJS; required by build-skill-registry.cjs
  // and jev-catalog.cjs.
  'org-skill-index.cjs': { forceSync: true, doctorTracked: true },
  // The Jev candidate catalogs (agents + unified skills), required by
  // jev-picker.cjs; without it the catalogs are empty and routing stays keyword.
  'jev-catalog.cjs': { forceSync: true, doctorTracked: true },
  // The Jev decision-model picker, required by handlers/route-handler.cjs and
  // by the CLI's src/decision/jev.ts. No fallback generator: without it the
  // hook keeps keyword routing.
  'jev-picker.cjs': { forceSync: true, doctorTracked: true },
  // The secret redactor jev-picker.cjs requires; without it the picker fails to
  // load and the hook keeps keyword routing.
  'redact-secrets.cjs': { forceSync: true, doctorTracked: true },
  // The keyword ranker jev-picker.cjs requires for its candidate shortlist;
  // without it the picker fails to load and the hook keeps keyword routing.
  'pick-rank.cjs': { forceSync: true, doctorTracked: true },
  // The pick learning loop: handlers/pick-core.cjs, capture-handler.cjs and
  // session-handler.cjs require it, and so does the CLI's
  // src/decision/pick-stats.ts. Without it picks keep their keyword order.
  'pick-stats.cjs': { forceSync: true, doctorTracked: true },
  'memory.cjs': { generate: generateMemoryHelper },
  'session.cjs': { generate: generateSessionManager },
  'pre-commit': { generate: generatePreCommitHook },
  'post-commit': { generate: generatePostCommitHook },
};

/**
 * Permissions for a helper file, the same from `init` and `init upgrade`.
 * Every .cjs/.js helper is run as `node <file>` (hooks, statusline, the codex
 * and opencode bridges), so only what is executed directly is 0755: shell
 * scripts, .mjs entry points (shebang) and the extensionless git hooks.
 */
export function helperFileMode(name: string): number {
  return /\.(sh|mjs)$/.test(name) || !/\.[^./]+$/.test(name) ? 0o755 : 0o644;
}

export const FORCE_SYNC_HELPERS: string[] = Object.keys(HELPER_FILES).filter(
  (name) => HELPER_FILES[name].forceSync,
);

export const DOCTOR_TRACKED_HELPERS: string[] = Object.keys(HELPER_FILES).filter(
  (name) => HELPER_FILES[name].doctorTracked,
);

// Helper file names this product shipped in the past under a name it no
// longer uses (e.g. before a rename). Deliberately absent from HELPER_FILES —
// nothing should still be writing these — so `init --force` and `doctor`
// track them separately: `doctor` warns a project still has one on disk and
// points at `init --force`, which deletes it once settings.json has been
// regenerated to stop referencing it.
export const OBSOLETE_HELPER_NAMES: string[] = [
  'graphify-freshen.cjs', // renamed to monograph-freshen.cjs (2026-09-16)
  'auto-memory-hook.mjs', // a no-op since AutoMemoryBridge was removed; hooks dropped (#417)
  'intelligence.cjs', // pattern store helper removed; nothing loads it (also retired by hash, see retired-files-data.ts)
  'router.cjs', // legacy skill keyword matcher removed; the prompt hook's pick never used it
];

// Fallback generators for force-synced helpers (used when source is missing
// the file entirely). Previously duplicated by hand as two separate maps
// that disagreed on membership — the "source found but file missing" path
// lacked a fallback that the "source not found" path had, so a
// corrupted/incomplete source copy could silently ship without the helper.
export const FORCE_SYNC_GENERATORS: Record<string, () => string> = Object.fromEntries(
  Object.entries(HELPER_FILES)
    .filter(([, spec]) => spec.forceSync && spec.generate)
    .map(([name, spec]) => [name, spec.generate as () => string]),
);

// Broader fallback-if-missing-after-copy step (used during a fresh `init`,
// not `init upgrade`) — includes non-force-synced scaffold files too
// (pre-commit/post-commit/session/memory).
export const INIT_FALLBACK_HELPERS: Record<string, () => string> = Object.fromEntries(
  Object.entries(HELPER_FILES)
    .filter(([, spec]) => spec.generate)
    .map(([name, spec]) => [name, spec.generate as () => string]),
);

/**
 * Generate all helper files
 */
export function generateHelpers(options: InitOptions): Record<string, string> {
  const helpers: Record<string, string> = {};

  if (options.components.helpers) {
    // Unix/macOS shell scripts
    helpers['pre-commit'] = generatePreCommitHook();
    helpers['post-commit'] = generatePostCommitHook();

    // Cross-platform Node.js scripts
    helpers['session.js'] = generateCrossPlatformSessionManager();
    helpers['memory.js'] = generateMemoryHelper();

    // Windows-specific scripts
    helpers['daemon-manager.ps1'] = generateWindowsDaemonManager();
    helpers['daemon-manager.cmd'] = generateWindowsBatchWrapper();
  }

  if (options.components.statusline) {
    helpers['statusline.cjs'] = generateStatuslineScript(options); // .cjs for ES module compatibility
    helpers['statusline-hook.sh'] = generateStatuslineHook(options);
  }

  return helpers;
}

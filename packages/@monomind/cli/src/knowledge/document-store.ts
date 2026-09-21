/**
 * Document store addressing — which store a scope writes to, and how to reach
 * it.
 *
 * A scope is either a project scope (stored under the project root) or the
 * `global` scope (the personal cross-project brain). Every other module in the
 * pipeline needs the same answer to "where does this scope live", so the rule
 * is defined once here rather than duplicated per caller.
 *
 * @module v1/cli/knowledge/document-store
 */

import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
// Static import is safe and deliberate: memory-bridge imports only node builtins
// at module scope (everything heavy is lazy), and the project-root rule must not
// be duplicated — two copies of "which directory is this project" is exactly the
// bug this default exists to fix.
import { getProjectRoot } from '../memory/memory-bridge.js';
import { profileStoreDir } from './profile-store.js';

export const KNOWLEDGE_NS_PREFIX = 'knowledge:';
// Global brain constants — canonical definitions live in memory-bridge.ts
// (GLOBAL_BRAIN / GLOBAL_BRAIN_DIR); duplicated here because the bridge is
// imported lazily and these are needed synchronously.
export const GLOBAL_BRAIN_SENTINEL = '@global';
export const globalBrainRoot = (): string =>
  process.env.MONOMIND_GLOBAL_BRAIN_DIR || path.join(os.homedir(), '.monomind', 'global-brain');
/** scope 'global' routes to the personal cross-project store. */
export const isGlobalScope = (scope: string): boolean => scope === 'global';
/** A `profile:<id>` scope routes to that profile's own store, one directory
 *  per profile inside the global brain — the same shape as `global`, one
 *  level down. Undefined for every other scope, so nothing else moves.
 *  See knowledge/profile-store.ts for why the directory lives there. */
export const effectiveRoot = (scope: string, rootDir: string): string =>
  isGlobalScope(scope) ? globalBrainRoot() : (profileStoreDir(scope) ?? rootDir);
export const storeDbPath = (scope: string): string | undefined =>
  isGlobalScope(scope) ? GLOBAL_BRAIN_SENTINEL : profileStoreDir(scope);

export function namespace(scope: string): string {
  return `${KNOWLEDGE_NS_PREFIX}${scope}`;
}

export function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** The store root for a scope: the global brain for `global`, else the project. */
export function getKnowledgeRoot(scope = 'shared', rootDir = getProjectRoot()): string {
  return effectiveRoot(scope, rootDir);
}

// ── Lazy bridge import ─────────────────────────────────────────────

let _bridge: typeof import('../memory/memory-bridge.js') | null | undefined;
export async function getBridge() {
  if (_bridge === null) return null;
  if (_bridge) return _bridge;
  try {
    _bridge = await import('../memory/memory-bridge.js');
    return _bridge;
  } catch {
    _bridge = null;
    return null;
  }
}

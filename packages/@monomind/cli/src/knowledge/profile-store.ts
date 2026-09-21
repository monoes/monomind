/**
 * Per-profile capture stores (the browser track's profile feature).
 *
 * mono-agent has profiles — work, personal, a client — and a page captured
 * from the browser can name the one it belongs to (`meta.profile` on the
 * capture envelope). The promise that makes that worth having is negative:
 * a page saved into `work` must NOT come back from a search of `personal`.
 *
 * WHICH MECHANISM, AND WHY. A store here is three things — a vector db
 * directory (`dbPath`), a namespace, and the root the `doc-metadata.jsonl`
 * lives under — and `scope` already decides all three (see
 * document-pipeline: `namespace()`, `effectiveRoot()`, `storeDbPath()`).
 * `global` is the existing proof: one scope value routes to a directory
 * outside any project. A profile is the same shape, so it is expressed the
 * same way — a scope of `profile:<id>` — rather than as a second, parallel
 * "which brain" parameter threaded through ingest, search, cite and
 * related. Nothing here is a new concept; it is one more value of an
 * existing one.
 *
 * WHERE THE DIRECTORY GOES. Inside the global brain
 * (`~/.monomind/global-brain/profiles/<id>`), not beside it. That is not
 * cosmetic: `memory-bridge.getDbPath` refuses any dbPath outside the
 * project, the per-project data dir, or the global brain, and — this is the
 * dangerous part — a refused path does not throw, it silently falls back to
 * the DEFAULT store. A profile brain anywhere else would quietly put every
 * profile's captures in one database, which is the exact failure this
 * feature exists to prevent. Being inside the global brain also inherits
 * its protection from `cleanup --data`, which prunes `~/.monomind/projects`
 * and deliberately never touches its sibling.
 *
 * UNTRUSTED INPUT. The profile id arrives from a browser extension and
 * becomes a directory name. `isValidProfileId` is the guard, kept
 * deliberately identical to Go's `profiledir.ValidProfileID` — the two
 * sides of this contract must reject exactly the same strings.
 *
 * @module v1/cli/knowledge/profile-store
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Scopes of the form `profile:<id>` address one profile's own store. */
export const PROFILE_SCOPE_PREFIX = 'profile:';

/** Where a profile's brain lives inside the global brain. */
const PROFILE_BRAIN_DIR = 'profiles';

/** Resolved lazily so a test's env override works whatever the import order. */
const globalBrainRoot = (): string =>
  process.env.MONOMIND_GLOBAL_BRAIN_DIR || path.join(os.homedir(), '.monomind', 'global-brain');

/**
 * The root mono-agent keeps profile directories under. Mirrors Go's
 * `profiledir` (`~/.monoagent/profiles/<id>/`); the env override exists for
 * tests on this side, since the Go side's own knob is `$HOME`.
 */
const profilesRoot = (): string =>
  process.env.MONOAGENT_PROFILES_DIR || path.join(os.homedir(), '.monoagent', 'profiles');

/**
 * isValidProfileId mirrors `profiledir.ValidProfileID` (Go): non-empty, no
 * path separator, no parent-directory component. Every other function here
 * returns undefined for an id this rejects, so a hostile id can never
 * become a path — not even a path that is then refused.
 */
export function isValidProfileId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const value = id.trim();
  if (!value) return false;
  if (value.includes('/') || value.includes('\\')) return false;
  if (value.includes('..')) return false;
  return true;
}

/** The scope value addressing one profile's store, or undefined. */
export function profileScope(id: unknown): string | undefined {
  return isValidProfileId(id) ? `${PROFILE_SCOPE_PREFIX}${id.trim()}` : undefined;
}

/** The profile id inside a `profile:<id>` scope, or undefined for any other. */
export function parseProfileScope(scope: unknown): string | undefined {
  if (typeof scope !== 'string' || !scope.startsWith(PROFILE_SCOPE_PREFIX)) return undefined;
  const id = scope.slice(PROFILE_SCOPE_PREFIX.length);
  return isValidProfileId(id) ? id.trim() : undefined;
}

/** True for a scope that names a profile. */
export const isProfileScope = (scope: unknown): boolean => parseProfileScope(scope) !== undefined;

// Directories already materialized in this process. See profileBrainDir.
const created = new Set<string>();

/**
 * profileBrainDir is a profile's store directory — the value used BOTH as
 * the dbPath and as the metadata root, exactly as the global brain uses one
 * directory for both.
 *
 * It creates the directory, which a resolver would not normally do. The
 * reason is specific: `memory-bridge.getDbPath` compares
 * `fs.realpathSync(dbPath)` against `fs.realpathSync(globalBrainDir)`, and
 * a path that does not exist yet cannot be realpath'd. On a machine where
 * the home directory is reached through a symlink, the two sides would then
 * resolve differently, the guard would reject the path, and — because that
 * guard falls back instead of throwing — the profile's captures would land
 * in the default store together with every other profile's. Creating the
 * directory first makes both sides resolvable and the comparison honest.
 */
export function profileBrainDir(id: unknown): string | undefined {
  if (!isValidProfileId(id)) return undefined;
  const dir = path.join(globalBrainRoot(), PROFILE_BRAIN_DIR, id.trim());
  if (!created.has(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      created.add(dir);
    } catch {
      // Best effort: an unwritable brain directory is the store layer's
      // problem to report, not a reason to fail resolution here.
    }
  }
  return dir;
}

/**
 * profileStoreDir is profileBrainDir for a `profile:<id>` SCOPE, and
 * undefined for every other scope — the single function
 * `document-store`'s `effectiveRoot`/`storeDbPath` consult, so that the
 * routing rule lives in one place and the pipeline keeps a two-line hook.
 *
 * DO NOT MOVE THIS DIRECTORY OUT OF THE GLOBAL BRAIN. The nesting looks
 * arbitrary and is not: `memory-bridge.getDbPath` accepts a dbPath only
 * inside the project, the per-project data dir, or the global brain, and a
 * path it does not accept is NOT rejected — it SILENTLY RETURNS THE DEFAULT
 * STORE. So a profile brain sited anywhere else (beside the global brain,
 * under `~/.monoagent`, under the profile's own root) does not fail: every
 * profile's captures quietly land in one database, `work` turns up in a
 * `personal` search, and nothing anywhere reports a problem. The feature
 * fails by succeeding. `src/__tests__/profile-store-dbpath.test.ts` holds
 * both halves of that — this path surviving, and an outside path silently
 * becoming the default.
 */
export function profileStoreDir(scope: unknown): string | undefined {
  const id = parseProfileScope(scope);
  return id === undefined ? undefined : profileBrainDir(id);
}

/**
 * profileInboxDir is where that profile's captures land, as the Go side
 * writes them: `~/.monoagent/profiles/<id>/.monomind/inbox`.
 *
 * Keyed by profile id alone. mono-agent lets a profile's root be moved
 * (`profiles.root_dir`), and the capture inbox deliberately does NOT follow
 * it on either side — see `ProfileInbox` in `internal/capture/profile.go`
 * for why. This path and that one are the same rule written twice, which is
 * the cost of the two repos agreeing about a directory at all.
 */
export function profileInboxDir(id: unknown): string | undefined {
  if (!isValidProfileId(id)) return undefined;
  return path.join(profilesRoot(), id.trim(), '.monomind', 'inbox');
}

/**
 * profileInboxes lists the profile inboxes that exist on this machine, for
 * a sweep that wants to ingest every profile's captures rather than only
 * the shared inbox. Missing directories are simply absent; nothing here
 * throws.
 */
export function profileInboxes(): Array<{ id: string; inbox: string; scope: string }> {
  const out: Array<{ id: string; inbox: string; scope: string }> = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(profilesRoot(), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidProfileId(entry.name)) continue;
    const inbox = profileInboxDir(entry.name);
    const scope = profileScope(entry.name);
    if (!inbox || !scope) continue;
    try {
      if (!fs.statSync(inbox).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({ id: entry.name, inbox, scope });
  }
  return out;
}

/**
 * captureScope is the routing rule, applied once per ingest: a capture
 * whose envelope names a profile belongs to that profile's store, whatever
 * scope the caller reached for.
 *
 * The envelope wins on purpose. The profile was chosen by a person at save
 * time, in the browser, and every automatic caller (`doc ingest` on a path
 * outside any project, the dashboard's watcher, an inbox sweep) picks its
 * scope from where the FILE is rather than from what it holds. A caller
 * that genuinely means a particular store says so by passing a
 * `profile:<id>` scope, which is returned untouched.
 */
export function captureScope(scope: string, filePath: string): string {
  if (isProfileScope(scope)) return scope;
  const id = envelopeProfile(filePath);
  return id ? `${PROFILE_SCOPE_PREFIX}${id}` : scope;
}

/** How much `meta.json` is worth reading before deciding it is not one. */
const MAX_META_BYTES = 1024 * 1024;

/**
 * envelopeProfile reads the `profile` out of the capture envelope holding
 * `filePath`, if there is one. Defensive on the same terms as the rest of
 * capture-envelope: `meta.json` is written by a browser extension on a
 * machine we do not control, so every failure — absent, oversized,
 * truncated, wrong-typed, or an id that could escape a directory — is
 * "this capture names no profile", never a thrown error.
 */
export function envelopeProfile(filePath: string): string | undefined {
  try {
    const metaPath = path.join(path.dirname(path.resolve(filePath)), 'meta.json');
    if (!fs.existsSync(metaPath)) return undefined;
    if (fs.statSync(metaPath).size > MAX_META_BYTES) return undefined;
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const id = (raw as Record<string, unknown>).profile;
    return isValidProfileId(id) ? id.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** A human-readable name for a scope, for a listing or a search result. */
export function describeScope(scope: string): string {
  const id = parseProfileScope(scope);
  return id ? `profile ${id}` : scope;
}

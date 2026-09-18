/**
 * Shared shape + leak-detection for the monoes.me `.mcp.json` entry.
 *
 * Plain ESM (not TypeScript) on purpose: `ui/routes-monoes.mjs` ships as-is
 * with no build step and cannot import compiled TypeScript, so this module
 * has to be importable by both it and `init/mcp-generator.ts` (compiled TS
 * *can* import a `.mjs` sibling — the constraint is one-directional).
 *
 * i-066: the monoes.me OAuth access token must never be written into the
 * project's `.mcp.json`. `buildMonoesMcpEntry()` therefore takes no token —
 * removing the parameter is a stronger guarantee than centralizing a shared
 * helper that still accepts one, because there is then nothing for a future
 * third writer to leak. The entry is a local stdio proxy
 * (`mcp/monoes-proxy.ts`) that resolves the Authorization header itself, at
 * request time, from the existing refresh-aware `getValidMonoesToken()`.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

// Deliberately NOT `promisify(execFile)` at module scope: several existing
// init tests (init-e2e.test.ts and friends) `vi.mock('child_process', ...)`
// with a fixed, explicit export list that predates this module and has no
// reason to know about it. `promisify()` requires its argument to already
// be a function, so evaluating it eagerly at import time throws the instant
// any such mock is active — breaking module load for every test that
// merely imports this file transitively, even ones that never touch the
// git check. Deferred to a lazy getter so only an actual call pays for it.
let _execFileAsync;
function execFileAsync(...args) {
  _execFileAsync ??= promisify(execFile);
  return _execFileAsync(...args);
}

/**
 * Build the `monoes` MCP server entry: a local stdio command, never a
 * remote `type: 'http'` entry with an embedded bearer header.
 *
 * i-066 reviewer finding 1: `npx` on win32 is a `.cmd` shim that cannot be
 * spawned directly (ENOENT) — mirrors the identical branch in
 * `platform-adapters/renderers/mcp.ts`'s `mcpCommand()`, which exists for
 * exactly this reason. `os` is a parameter (not read from `process.platform`
 * internally) for the same reason `mcpServerEntry()` already takes one: it
 * makes the win32 shape testable without running on Windows.
 * @param {string} [monoesUrl] - Override for the monoes.me base URL the
 *   proxy talks to (propagated via env so the proxy doesn't need its own
 *   flag). Omit to let the proxy use its own default (https://monoes.me).
 * @param {NodeJS.Platform} [os] - Defaults to process.platform.
 */
export function buildMonoesMcpEntry(monoesUrl, os = process.platform) {
  const env = {};
  if (monoesUrl) env.MONOMIND_MONOES_URL = monoesUrl;
  const baseCommand = ['npx', '-y', 'monomind@latest', 'mcp', 'monoes-proxy'];
  const command = os === 'win32' ? ['cmd', '/c', ...baseCommand] : baseCommand;
  const [executable, ...args] = command;
  return { command: executable, args, env };
}

/**
 * True if `.mcp.json`'s raw text contains a literal bearer token — checked
 * at the specific path this item's writers ever wrote one
 * (`mcpServers.monoes.headers.Authorization`), not a whole-file scan.
 * i-066 reviewer finding 6: a whole-file regex trips on ANY other MCP
 * server the project has configured with an unrelated bearer header. Falls
 * back to the raw regex only when the file fails to parse as JSON (a
 * hand-corrupted file shouldn't silently hide a real leak from this check).
 * Presence-only either way — the value itself is never read into a variable
 * that could be logged.
 * @param {string} raw
 * @returns {boolean}
 */
function _hasLegacyBearerEntry(raw) {
  try {
    const parsed = JSON.parse(raw);
    const auth = parsed?.mcpServers?.monoes?.headers?.Authorization;
    return typeof auth === 'string' && /^Bearer\s+\S+/.test(auth);
  } catch {
    return /"Authorization"\s*:\s*"Bearer\s+[^"]+"/.test(raw);
  }
}

/**
 * Detects whether a project already leaked (or is currently leaking) the
 * monoes.me token — either a literal bearer value still sitting in
 * `.mcp.json` (pre-fix state, or hand-edited back in), or the refresh token
 * file being tracked by git. Returns human-readable reasons that name the
 * file but never the secret value itself — callers must not print anything
 * else about the match (see doc comment on formatMonoesLeakWarning).
 * Async: the git check shells out (see i-066 reviewer finding 4 — callers
 * on a hot path, like the dashboard's status poll, should throttle calls to
 * this rather than call it per-request; this function itself does not
 * cache, since it's also called once at `monomind init` where caching would
 * be meaningless).
 * @param {string} projectDir
 * @returns {Promise<string[]>}
 */
export async function detectMonoesTokenLeak(projectDir) {
  const reasons = [];

  const mcpJsonPath = path.join(projectDir, '.mcp.json');
  try {
    const raw = fs.readFileSync(mcpJsonPath, 'utf8');
    if (_hasLegacyBearerEntry(raw)) {
      reasons.push(
        `.mcp.json contains a literal bearer token (mcpServers.monoes.headers.Authorization)`,
      );
    }
  } catch {
    // no .mcp.json, or unreadable — nothing to check
  }

  const connectionRelPath = path.join('.monomind', 'monoes-connection.json');
  const connectionPath = path.join(projectDir, connectionRelPath);
  if (fs.existsSync(connectionPath)) {
    try {
      await execFileAsync('git', ['ls-files', '--error-unmatch', connectionRelPath], {
        cwd: projectDir,
        timeout: 2000,
      });
      // exit 0 => the file is tracked
      reasons.push(`${connectionRelPath} is tracked by git`);
    } catch {
      // non-zero exit (untracked) or git unavailable — not a leak signal
    }
  }

  return reasons;
}

/**
 * Formats a loud, one-screen warning for `detectMonoesTokenLeak()` results.
 * Names the file(s) and the remedy; never echoes the token value (there is
 * none available to it — the detector only records presence, see above).
 * @param {string[]} reasons
 * @returns {string|null}
 */
export function formatMonoesLeakWarning(reasons) {
  if (reasons.length === 0) return null;
  return [
    '',
    '⚠ ⚠ ⚠  monoes.me token exposure detected — action required  ⚠ ⚠ ⚠',
    ...reasons.map((r) => `  - ${r}`),
    '',
    'Treat this token as COMPROMISED. If it reached git history, rewriting',
    'the file does NOT remove it — anyone with clone access already has it.',
    '',
    '  1. Revoke the token at https://monoes.me (Settings -> Connected apps)',
    '  2. Reconnect: run `monomind ui`, then monoes.me -> Disconnect -> Connect',
    '',
  ].join('\n');
}

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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Build the `monoes` MCP server entry: a local stdio command, never a
 * remote `type: 'http'` entry with an embedded bearer header.
 * @param {string} [monoesUrl] - Override for the monoes.me base URL the
 *   proxy talks to (propagated via env so the proxy doesn't need its own
 *   flag). Omit to let the proxy use its own default (https://monoes.me).
 */
export function buildMonoesMcpEntry(monoesUrl) {
  const env = {};
  if (monoesUrl) env.MONOMIND_MONOES_URL = monoesUrl;
  return {
    command: 'npx',
    args: ['-y', 'monomind@latest', 'mcp', 'monoes-proxy'],
    env,
  };
}

/**
 * Detects whether a project already leaked (or is currently leaking) the
 * monoes.me token — either a literal bearer value still sitting in
 * `.mcp.json` (pre-fix state, or hand-edited back in), or the refresh token
 * file being tracked by git. Returns human-readable reasons that name the
 * file but never the secret value itself — callers must not print anything
 * else about the match (see doc comment on formatMonoesLeakWarning).
 * @param {string} projectDir
 * @returns {string[]}
 */
export function detectMonoesTokenLeak(projectDir) {
  const reasons = [];

  const mcpJsonPath = path.join(projectDir, '.mcp.json');
  try {
    const raw = fs.readFileSync(mcpJsonPath, 'utf8');
    // Presence-only check — deliberately does not capture or log the
    // matched value, only that the shape matched.
    if (/"Authorization"\s*:\s*"Bearer\s+[^"]+"/.test(raw)) {
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
      execFileSync('git', ['ls-files', '--error-unmatch', connectionRelPath], {
        cwd: projectDir,
        stdio: 'ignore',
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

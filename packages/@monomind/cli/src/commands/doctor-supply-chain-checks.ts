/**
 * Doctor — `doctor -c supply-chain`. Local files only, no network, never
 * writes. Four read-only looks at what a host tool would later run or load:
 *  1. projected catalog skills edited after approval (catalog/pins.ts);
 *  2. installed skills, commands and agents whose bytes differ from the hash
 *     `init`/`packs add` recorded (init-manifest.json): changed after install;
 *  3. `.mcp.json` servers that imitate a monomind one, or a `monomind` entry
 *     that does not start monomind;
 *  4. repository git config keys git executes (fsmonitor, hooksPath,
 *     sshCommand, `!` aliases, filter/diff/merge drivers, …).
 * Each is a tripwire with stated limits (see the individual functions).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { verifyPins } from '../catalog/pins.js';
import { readInitManifest } from '../init/init-manifest.js';
import type { HealthCheck } from './doctor-env-checks.js';

const NAME = 'Supply Chain Pins';
const INSTALLED_CONTENT = /^\.claude\/(?:skills|commands|agents)\//;

/** Installed content files whose current bytes differ from the recorded hash. */
export function changedInstalledFiles(root: string): string[] {
  const files = readInitManifest(root)?.files ?? {};
  const out: string[] = [];
  for (const [rel, want] of Object.entries(files)) {
    if (!INSTALLED_CONTENT.test(rel)) continue;
    try {
      const got = createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
      if (got !== want) out.push(rel);
    } catch {
      /* removed: not a content change */
    }
  }
  return out.sort();
}

const KNOWN_MCP = ['monomind', 'monoagent', 'monoes', 'monograph', 'monobrowse', 'monofence'];
const fold = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[-_.\s]/g, '');

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}

/**
 * MCP servers in a `.mcp.json` document that look like a monomind server but
 * are not: a name within one edit of a known name (or equal after case,
 * punctuation and Unicode folding, or non-ASCII), or the `monomind` entry
 * itself running something that never mentions monomind. Names only; it
 * cannot tell a benign server from a malicious one.
 */
export function mcpLookalikes(doc: unknown): string[] {
  const servers = (doc as { mcpServers?: Record<string, unknown> } | null)?.mcpServers;
  if (!servers || typeof servers !== 'object') return [];
  const out: string[] = [];
  for (const [name, def] of Object.entries(servers)) {
    const f = fold(name);
    if (KNOWN_MCP.includes(name)) {
      const d = def as { command?: unknown; args?: unknown; url?: unknown } | null;
      const text = JSON.stringify([d?.command, d?.args, d?.url]);
      if (name === 'monomind' && !/monomind/i.test(text))
        out.push(`"${name}" does not run monomind (${text.slice(0, 120)})`);
      continue;
    }
    const confusable =
      /[^\x20-\x7e]/.test(name) ||
      KNOWN_MCP.some((k) => f === k || (f.length >= 6 && editDistance(f, k) === 1));
    if (confusable) out.push(`"${name}" imitates a monomind server name`);
  }
  return out;
}

const CONVENTIONAL_HOOKS_PATH = new Set(['.husky/_', '.husky', '.githooks', '.git/hooks']);

/**
 * Keys in a git config file that make git run something. A tripwire: it
 * reads one file's text, resolves no includes, and will not see a value set
 * through the environment or a `-c` flag. `core.hooksPath` at a conventional
 * in-repo hook directory is not reported.
 */
export function gitConfigExecKeys(text: string): string[] {
  const out: string[] = [];
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]$/.exec(line);
    if (head) {
      section = (head[2] !== undefined ? `${head[1]}.${head[2]}` : head[1]).toLowerCase();
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(line);
    if (!kv || !section) continue;
    const key = `${section}.${kv[1].toLowerCase()}`;
    const value = kv[2].replace(/\s+[#;].*$/, '').replace(/^"|"$/g, '');
    const bool = /^(?:true|false|yes|no|on|off|0|1)$/i.test(value);
    let hit: boolean;
    if (key === 'core.fsmonitor') hit = !bool;
    else if (key === 'core.hookspath') hit = !CONVENTIONAL_HOOKS_PATH.has(value);
    else if (key.startsWith('alias.')) hit = value.startsWith('!');
    else
      hit =
        ['core.sshcommand', 'core.askpass', 'uploadpack.packobjectshook'].includes(key) ||
        /^(?:filter|merge)\..*\.(?:clean|smudge|process|driver)$/.test(key) ||
        /^diff\..*\.(?:textconv|command)$/.test(key) ||
        /^gpg(?:\..*)?\.program$/.test(key) ||
        /^include(?:if\..*)?\.path$/.test(key);
    if (hit) out.push(`${key} = ${value.slice(0, 100)}`);
  }
  return out;
}

/** The repository's own config file, following a worktree's `.git` pointer. */
function repoConfigPath(root: string): string | undefined {
  const dot = join(root, '.git');
  try {
    if (statSync(dot).isDirectory()) return join(dot, 'config');
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'));
    if (!m) return undefined;
    const gitdir = isAbsolute(m[1].trim()) ? m[1].trim() : resolve(root, m[1].trim());
    const common = join(gitdir, 'commondir');
    return join(
      existsSync(common) ? resolve(gitdir, readFileSync(common, 'utf8').trim()) : dirname(gitdir),
      'config',
    );
  } catch {
    return undefined;
  }
}

export async function checkSupplyChain(root: string = process.cwd()): Promise<HealthCheck> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const fixes: string[] = [];

  for (const p of verifyPins(root)) failures.push(p.message);
  if (failures.length)
    fixes.push(
      'Review with `git diff`; `monomind catalog project --surface <s> --apply` restores the approved copy, or `monomind catalog disable <id>`',
    );

  const changed = changedInstalledFiles(root);
  if (changed.length) {
    warnings.push(
      `${changed.length} installed skill/command/agent file(s) changed since install (your edit, or tampering): ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', …' : ''}`,
    );
    fixes.push('Review `git diff` for those files before trusting them');
  }

  try {
    const lookalikes = mcpLookalikes(JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')));
    if (lookalikes.length) {
      warnings.push(`.mcp.json: ${lookalikes.join('; ')}`);
      fixes.push('Remove or rename the server in .mcp.json if you did not add it');
    }
  } catch {
    /* no or unreadable .mcp.json: checkMcpjsonApprovals covers that */
  }

  const cfg = repoConfigPath(root);
  if (cfg && existsSync(cfg)) {
    const keys = gitConfigExecKeys(readFileSync(cfg, 'utf8'));
    if (keys.length) {
      warnings.push(`git config sets keys git executes: ${keys.join('; ')}`);
      fixes.push(`Check ${cfg}; unset anything you did not set (\`git config --unset <key>\`)`);
    }
  }

  if (failures.length)
    return {
      name: NAME,
      status: 'fail',
      message: [...failures, ...warnings].join('; '),
      fix: fixes.join('; '),
    };
  if (warnings.length)
    return { name: NAME, status: 'warn', message: warnings.join('; '), fix: fixes.join('; ') };
  return {
    name: NAME,
    status: 'pass',
    message: 'Projected skills, installed content, .mcp.json names and git config look unchanged',
  };
}

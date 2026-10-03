// packages/@monomind/cli/src/orgrt/home-write-deny.ts
/**
 * `policy.sandbox.homeWriteAllow`: the role's process tree cannot change the real $HOME, apart from
 * an allowlist (opt-in; a role without it is unchanged). Found in the first paid parallel-sweep
 * trials: a role inside the no-node layer ran `cat > ~/f7.sh <<EOF` and created a file in the real
 * home, because the layer (exec-deny.ts) is `--dev-bind / /` and the SDK sandbox allows writing
 * the home (role-sandbox-restrictions.ts).
 *
 * Mechanism: bubblewrap's tmpfs overlay (`--overlay-src $HOME --tmp-overlay $HOME`) mounted over
 * the home, then the allowlisted subpaths bound back from the host, read-write. So:
 *   - reads of everything in the home still work (toolchains, git config, caches, the runners'
 *     credentials); only the allowlisted paths are the real, shared files;
 *   - every other write (a new file, a rename, a delete, a change to an existing file) succeeds
 *     inside the role's own view, lands in the overlay's memory-backed upper layer, and goes
 *     when the layer ends. It never reaches the real home. A role cannot tell, which is
 *     deliberate: nothing it does there is refused in a way that would break a CLI.
 * Why not the alternatives (measured with the claude CLI 2.1.284 in a temp home): a read-only
 * home makes the CLI's config write fail ("MCP server was not saved"); `~/.claude.json` is
 * written as a temp file in ~ (`.claude.json.tmp.<pid>.<hash>`) and renamed over it, which cannot
 * be allowed by name in advance, and a bind mount of the file itself makes the rename fail with
 * EBUSY. In the overlay the temp file and the rename both work, so the CLI is happy, and the
 * real `~/.claude.json` is not changed by a role (it is not on the allowlist). A tmpfs home would
 * hide the toolchains and credentials; per-entry read-only binds would need every name up front.
 *
 * The layer must come first (right after `--dev-bind / /`): its sources are host paths, so
 * mounting it after the authority mask would cover the mask's binds. Every bind the mask makes
 * later sits on top of it, and is unchanged. What it does NOT cover: a directory the authority
 * mask itself binds read-write from the host inside the home (the rename-protection anchors
 * `~/.local`, `~/.local/share` ..., operator-protected-paths.ts) stays really writable below the
 * top level; and an overlay does not hide the home from a process that never goes through the
 * layer (the daemon itself, a `push` role without the layer).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

const under = (root: string, p: string): boolean => p === root || p.startsWith(root + sep);

const real = (p: string): string | undefined => {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
};

export interface HomeWriteCtx {
  home: string;
  env: NodeJS.ProcessEnv;
  /** `policy.sandbox.homeWriteAllow`: relative to the home, or absolute. */
  allow: string[];
  /** Further paths that must stay really writable when they are under the home: the role's cwd,
   *  the org root, `policy.sandbox.allowWrite`, the temp directory. */
  writable?: Array<string | undefined>;
}

/** bubblewrap arguments that overlay `home` and bind the allowed paths back read-write. Entries
 *  that do not exist are skipped (they would have to be created, in the overlay); an entry that
 *  would reopen the whole home throws. */
export function homeWriteLayer(ctx: HomeWriteCtx): string[] {
  const home = real(ctx.home) ?? resolve(ctx.home);
  const keep = new Set<string>();
  const add = (candidate: string) => {
    const r = real(candidate);
    // outside the home it is not behind the overlay: already the real thing
    if (r && r !== home && under(home, r)) keep.add(r);
  };
  for (const entry of ctx.allow) {
    const abs = isAbsolute(entry) ? resolve(entry) : resolve(home, entry);
    const lexical = abs === home || (!under(home, abs) && !isAbsolute(entry));
    if (!entry.trim() || lexical)
      throw new Error(
        `policy.sandbox.homeWriteAllow: "${entry}" names the home itself or leaves it; list the subpaths that may be written`,
      );
    if (under(home, abs)) add(abs);
  }
  for (const w of ctx.writable ?? []) if (w && isAbsolute(w)) add(w);
  for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME'] as const) {
    const v = ctx.env[k];
    if (v) add(v);
  }
  return [
    '--overlay-src',
    home,
    '--tmp-overlay',
    home,
    ...[...keep].sort((a, b) => a.length - b.length).flatMap((p) => ['--bind', p, p]),
  ];
}

let probed: { available: boolean; reason?: string } | undefined;

/** Whether this bubblewrap can mount a tmpfs overlay (`--tmp-overlay`, bubblewrap 0.11+, and a
 *  kernel that allows overlayfs in a user namespace). Probed once per process. */
export function homeLayerAvailability(): { available: boolean; reason?: string } {
  if (probed) return probed;
  if (process.platform !== 'linux')
    return (probed = { available: false, reason: `no bubblewrap on ${process.platform}` });
  const dir = mkdtempSync(join(tmpdir(), 'mm-home-probe-'));
  try {
    const r = spawnSync(
      'bwrap',
      ['--dev-bind', '/', '/', '--overlay-src', dir, '--tmp-overlay', dir, '--', 'true'],
      { stdio: 'pipe', timeout: 5000, encoding: 'utf8' },
    );
    probed =
      r.status === 0
        ? { available: true }
        : {
            available: false,
            reason: r.error
              ? `bwrap not found (${(r.error as NodeJS.ErrnoException).code ?? r.error.message})`
              : `bwrap cannot mount a tmpfs overlay (exit ${r.status}: ${String(r.stderr).trim().split('\n')[0]})`,
          };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return probed;
}

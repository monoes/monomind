// packages/@monomind/cli/src/orgrt/version-probe.ts
/**
 * Version detection for `agent scan` (doc/agent-exec-protocol.md §6, rev 11)
 * that does not run the runtime unless it has to (issue #337).
 *
 * Many agent CLIs change the machine on `--version`. Measured 2026-09-25 in
 * an empty HOME: grok 1.0.41 downloads its ~159MB native binary into
 * ~/.grok; hermes 0.19.0 writes ~/.hermes/logs and ~/.hermes/.update_check;
 * codex 0.156.1 writes ~/.codex/tmp; opencode 1.18.32 creates its XDG
 * config/data/cache/state dirs; copilot 1.0.88 unpacks into ~/.cache/copilot;
 * a mise shim (crush) writes mise caches and may install the tool.
 *
 * So the version comes from install metadata first — the package.json that
 * owns the binary, or a mise/asdf `installs/<tool>/<version>/` directory —
 * and the binary is only run when its runtime is in SIDE_EFFECT_FREE_VERSION
 * or the caller opts in (`agent scan --probe`). Every run happens in a
 * scratch HOME/XDG/TMPDIR and cwd that is removed afterwards.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { omitAnthropicManagedKeys } from './provider.js';

/** Where a scan entry's `version` came from; `not-probed` = the binary was not run. */
export type VersionSource = 'package.json' | 'install-path' | 'exec' | 'not-probed';

/**
 * Runtimes whose `--version` wrote nothing in an empty HOME (measured
 * 2026-09-25), so scan may run it by default when metadata has no version.
 */
export const SIDE_EFFECT_FREE_VERSION: Readonly<Record<string, string>> = {
  claude: 'claude 2.1.281: prints the version, writes no file',
  antigravity: 'agy 1.2.10: prints the version, writes no file',
  pi: 'pi 0.87.1: prints the version, writes no file',
  'pi-rpc': 'same binary as pi',
};

// mise and asdf keep each tool at installs/<tool>/<version>/; `latest` and
// other aliases are symlinks, resolved away by realpath.
const INSTALL_DIR = /\/installs\/[^/]+\/(v?\d+(?:\.\d+)+[^/]*)\//;

function realpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** `version` of dir/package.json, if that package's `bin` is this binary. */
function ownedVersion(dir: string, real: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(join(dir, 'package.json'), 'utf8'));
    const bins: unknown[] = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});
    const owns = bins.some((b) => typeof b === 'string' && realpath(resolve(dir, b)) === real);
    return owns && typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** The installed version, read from files only — the binary is never run. */
export function versionFromInstall(
  binPath: string,
): { version: string; source: VersionSource } | null {
  const real = realpath(binPath);
  if (!real) return null;
  let dir = dirname(real);
  for (let i = 0; i < 4; i++) {
    const version = ownedVersion(dir, real);
    if (version) return { version, source: 'package.json' };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const m = INSTALL_DIR.exec(real);
  return m ? { version: m[1], source: 'install-path' } : null;
}

/**
 * The environment a `--version` run gets: HOME, XDG dirs, TMPDIR and the
 * tools' own state dirs all point into `scratch`, and the self-update and
 * auto-install switches the tools document are off.
 */
function scratchEnv(scratch: string): Record<string, string> {
  const home = join(scratch, 'home');
  return {
    // o-18: binPath honours the <X>_CLI_BIN override, so this is an
    // arbitrary, env-controlled binary — strip the three ANTHROPIC_* keys
    // the same way every AgentRunner spawn does.
    ...omitAnthropicManagedKeys(process.env),
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    TMPDIR: join(scratch, 'tmp'),
    CODEX_HOME: join(home, '.codex'),
    GROK_HOME: join(home, '.grok'),
    HERMES_HOME: join(home, '.hermes'),
    DISABLE_AUTOUPDATER: '1', // claude
    NO_UPDATE_NOTIFIER: '1', // npm update-notifier
    MISE_AUTO_INSTALL: 'false',
    MISE_EXEC_AUTO_INSTALL: 'false',
    MISE_NOT_FOUND_AUTO_INSTALL: 'false',
  };
}

/** Run `bin --version` in a scratch HOME/cwd with a hard timeout (default 5s). */
export async function execVersion(binPath: string, timeoutMs = 5000): Promise<string | null> {
  const scratch = fs.mkdtempSync(join(tmpdir(), 'monomind-scan-'));
  const cwd = join(scratch, 'cwd');
  fs.mkdirSync(cwd);
  fs.mkdirSync(join(scratch, 'home'));
  fs.mkdirSync(join(scratch, 'tmp'));
  try {
    return await new Promise((done) => {
      const child = execFile(
        binPath,
        ['--version'],
        { timeout: timeoutMs, windowsHide: true, cwd, env: scratchEnv(scratch) },
        // Some CLIs exit non-zero for --version yet still print it.
        (_err, stdout) =>
          done(
            String(stdout ?? '')
              .trim()
              .split('\n')[0] || null,
          ),
      );
      // Belt-and-braces: execFile timeout kills, but a wedged pre-exec spawn
      // also needs the promise settled.
      child.on('error', () => done(null));
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export interface DetectOptions {
  /** Run `--version` for any runtime whose metadata has no version. */
  probe?: boolean;
  /** Per-binary `--version` timeout (default 5s). */
  versionTimeoutMs?: number;
}

/** Version of an installed runtime: metadata, then an allowed or opted-in run. */
export async function detectVersion(
  id: string,
  binPath: string,
  opts: DetectOptions,
): Promise<{ version: string | null; source: VersionSource }> {
  const fromInstall = versionFromInstall(binPath);
  if (fromInstall) return fromInstall;
  if (!opts.probe && !Object.hasOwn(SIDE_EFFECT_FREE_VERSION, id)) {
    return { version: null, source: 'not-probed' };
  }
  return { version: await execVersion(binPath, opts.versionTimeoutMs), source: 'exec' };
}

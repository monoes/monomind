/** Operator-controlled Claude selection; never consult project configuration. */
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { CommandOption } from '../types.js';

export const claudePathOption: CommandOption = {
  name: 'claude-path',
  type: 'string',
  description:
    'Operator-selected Claude Code absolute path (or bundled); overrides environment and home config',
};
const configFile = (home: string): string => join(home, '.monomind', 'config.json');

function checkOperatorDirectory(home: string): void {
  const dir = join(home, '.monomind');
  if (!existsSync(dir)) return;
  if (realpathSync(dir) !== join(realpathSync(home), '.monomind'))
    throw new Error('Operator config directory must not be a symlink');
  const uid = process.getuid?.();
  for (const path of [home, dir]) {
    const st = statSync(path);
    if (
      !st.isDirectory() ||
      (process.platform !== 'win32' &&
        (st.mode & 0o022 || (uid !== undefined && st.uid !== uid && st.uid !== 0)))
    )
      throw new Error(
        'Operator config directory must be owned by this user or root and not group/other-writable',
      );
  }
}

/** A symlink or writable operator config must not redirect trust to project files. */
function readOperatorConfig(home: string): Record<string, unknown> {
  checkOperatorDirectory(home);
  const file = configFile(home);
  if (!existsSync(file)) return {};
  if (realpathSync(file) !== join(realpathSync(home), '.monomind', 'config.json'))
    throw new Error('Operator Claude config must not be a symlink');
  const st = statSync(file);
  if (!st.isFile() || st.size > 1024 * 1024) throw new Error('Invalid operator Claude config file');
  const uid = process.getuid?.();
  if (
    process.platform !== 'win32' &&
    (st.mode & 0o022 || (uid !== undefined && st.uid !== uid && st.uid !== 0))
  )
    throw new Error(
      'Operator Claude config must be owned by this user or root and not group/other-writable',
    );
  const config: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Operator Claude config must be an object');
  return config as Record<string, unknown>;
}
/** Whether an untrusted config file names a claude.path; only read, never trusted. */
function namesClaudePath(home: string): boolean {
  try {
    const claude = (JSON.parse(readFileSync(configFile(home), 'utf8')) as Record<string, unknown>)
      ?.claude;
    return !!claude && typeof claude === 'object' && 'path' in claude;
  } catch {
    return existsSync(configFile(home)); // unreadable or invalid: cannot tell, so refuse
  }
}
let warnedUntrusted = false;
/** Reading never breaks Claude for an operator who set nothing: an untrusted home or config
 *  that names no claude.path is "no operator choice" with one warning; one that names a path is refused. */
function readOperatorConfigForSelection(home: string): Record<string, unknown> {
  try {
    return readOperatorConfig(home);
  } catch (error) {
    if (namesClaudePath(home)) throw error;
    if (!warnedUntrusted) {
      warnedUntrusted = true;
      process.stderr.write(
        `monomind: ignoring operator Claude config (${(error as Error).message}); no claude.path is set\n`,
      );
    }
    return {};
  }
}
export function operatorClaudePath(home = homedir()): string | undefined {
  const config = readOperatorConfigForSelection(home);
  const claude = config.claude;
  if (!claude || typeof claude !== 'object') return undefined;
  const path = (claude as Record<string, unknown>).path;
  if (path === undefined) return undefined;
  if (typeof path !== 'string' || !path.trim())
    throw new Error('Operator claude.path must be a non-empty string');
  return path.trim();
}
export function setOperatorClaudePath(path: string, home = homedir()): void {
  if (path !== 'bundled' && !isAbsolute(path))
    throw new Error('claude.path must be an absolute path or bundled');
  const config = readOperatorConfig(home);
  config.claude = {
    ...(config.claude && typeof config.claude === 'object' ? config.claude : {}),
    path,
  };
  const file = configFile(home);
  mkdirSync(join(home, '.monomind'), { recursive: true, mode: 0o700 });
  checkOperatorDirectory(home);
  const pending = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(pending, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(pending, 0o600);
    renameSync(pending, file);
  } finally {
    rmSync(pending, { force: true });
  }
}
export function selectClaudePath(
  env: NodeJS.ProcessEnv,
  home: string,
  flag?: string,
): { path: string; source: string } | undefined {
  if (flag !== undefined) return { path: flag.trim(), source: '--claude-path' };
  const value = env.MONOMIND_CLAUDE_PATH?.trim();
  if (value)
    return {
      path: value,
      source:
        env.MONOMIND_CLAUDE_PATH_SOURCE === '--claude-path'
          ? '--claude-path'
          : 'MONOMIND_CLAUDE_PATH',
    };
  const configured = operatorClaudePath(home);
  return configured ? { path: configured, source: 'config claude.path' } : undefined;
}
/** Apply at CLI entry before creating runtime sandboxes or loading the SDK. */
export function applyClaudePathFlag(flags: Record<string, unknown>): void {
  const value = flags['claude-path'];
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || (value !== 'bundled' && !isAbsolute(value)))
    throw new Error('--claude-path must be an absolute path or bundled');
  process.env.MONOMIND_CLAUDE_PATH = value;
  process.env.MONOMIND_CLAUDE_PATH_SOURCE = '--claude-path';
}

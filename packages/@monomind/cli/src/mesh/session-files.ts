import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Hooks run in their own process and cannot see the MCP server's hub credentials. The server
 * leaves them in `<mesh dir>/sessions/<pid>.json` (0600) under the pid of the agent host it runs
 * under (Claude Code, opencode, ...): the hooks of the same session find them by walking their own
 * ancestors. Only the host's pid is used: the host's own parent is usually a terminal shell or an
 * IDE that outlives the session, and a file under it handed this session's name to every later
 * session started from there.
 */
const MAX_WRAPPERS = 4;

/**
 * `sh -c '...'` and `npx`/`npm exec` sit between a host and the hook or MCP server it starts: a pid
 * that is one of them is skipped on the way up to the host. A login or interactive shell is not.
 */
const WRAPPER =
  /^(?:\S*\/)?(?:sh|bash|dash|zsh|ksh|fish)(?:\s+-[a-zA-Z]+)*?\s+-[a-zA-Z]*c[a-zA-Z]*(?:\s|$)|^npm exec\b|^(?:\S*\/)?(?:npx|pnpx|bunx)(?:\s|$)|\bnpx-cli\.js(?:\s|$)|\bnpm-cli\.js\s+(?:exec|x)(?:\s|$)|^(?:\S*\/)?pnpm\s+dlx(?:\s|$)/;

export function isWrapperCommand(args: string): boolean {
  return WRAPPER.test(args.trim());
}

export function parentOf(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) || undefined;
  } catch {
    try {
      const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 500,
      });
      return Number(out.trim()) || undefined;
    } catch {
      return undefined;
    }
  }
}

function commandOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    try {
      return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 500,
      });
    } catch {
      return '';
    }
  }
}

/**
 * The pid of the agent host this process runs under: its parent, or the first ancestor above it
 * that is not a `sh -c` or `npx` wrapper. Undefined when there is no parent to key on.
 */
export function sessionHostPid(from: number = process.ppid): number | undefined {
  let pid: number | undefined = from;
  for (let i = 0; pid && pid > 1 && i < MAX_WRAPPERS; i++) {
    if (!isWrapperCommand(commandOf(pid))) return pid;
    pid = parentOf(pid);
  }
  return from > 1 ? from : undefined;
}

function hostPids(host: number | undefined): number[] {
  return host && host > 1 ? [host] : [];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface SessionFiles {
  write(auth: { addr: string; key: string; alias?: string }): void;
  remove(): void;
}

export function createSessionFiles(dir: string): SessionFiles {
  const sessions = join(dir, 'sessions');
  let written: string[] = [];
  const remove = () => {
    for (const f of written) {
      for (const g of [f, f.replace(/\.json$/, '.shown')]) {
        try {
          unlinkSync(g);
        } catch {
          /* already gone */
        }
      }
    }
    written = [];
  };
  return {
    write(auth) {
      try {
        mkdirSync(sessions, { recursive: true, mode: 0o700 });
        // Files of sessions that died without saying goodbye.
        for (const f of readdirSync(sessions)) {
          const pid = Number(f.replace(/\.(json|shown|name)$/, ''));
          if (Number.isInteger(pid) && !alive(pid)) unlinkSync(join(sessions, f));
        }
        written = []; // the same files are overwritten below; a `.shown` marker must survive
        for (const pid of hostPids(sessionHostPid())) {
          const file = join(sessions, `${pid}.json`);
          const tmp = `${file}.${process.pid}.tmp`;
          writeFileSync(tmp, JSON.stringify({ ...auth, pid: process.pid }), { mode: 0o600 });
          renameSync(tmp, file);
          written.push(file);
        }
      } catch {
        /* the hook is a convenience: without the file a session just reads its inbox on request */
      }
    },
    remove,
  };
}

const NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The name of this Claude session, shared with the SessionStart hook that sets the session title:
 * whichever of the two runs first writes it (`<pid>.name`, exclusive create), the other adopts it.
 */
export function claimSessionName(
  dir: string,
  make: () => string,
  host: number | undefined = sessionHostPid(),
): string {
  const sessions = join(dir, 'sessions');
  const pids = hostPids(host);
  const read = (): string | undefined => {
    for (const pid of pids) {
      try {
        const n = readFileSync(join(sessions, `${pid}.name`), 'utf8').trim();
        if (NAME.test(n)) return n;
      } catch {
        /* none for this pid */
      }
    }
    return undefined;
  };
  const existing = read();
  if (existing) return existing;
  const name = make();
  try {
    mkdirSync(sessions, { recursive: true, mode: 0o700 });
    for (const pid of pids) {
      try {
        writeFileSync(join(sessions, `${pid}.name`), name, { flag: 'wx', mode: 0o600 });
      } catch {
        /* another writer got there first */
      }
    }
  } catch {
    /* the name is a convenience; this session just keeps its own */
  }
  return read() ?? name;
}

/** The hub gave the session a different name than the one claimed (it was taken): keep them equal. */
export function settleSessionName(
  dir: string,
  name: string,
  host: number | undefined = sessionHostPid(),
): void {
  for (const pid of hostPids(host)) {
    try {
      writeFileSync(join(dir, 'sessions', `${pid}.name`), name, { mode: 0o600 });
    } catch {
      /* no claim was written */
    }
  }
}

/**
 * The address of the Claude session this process runs under, if any: the session's MCP server left
 * its credentials under the pid of one of the ancestors. Never throws.
 */
export function findAncestorSessionAddr(
  dir: string,
  from: number = process.pid,
): string | undefined {
  let pid: number | undefined = from;
  for (let i = 0; pid && pid > 1 && i < 8; i++, pid = parentOf(pid)) {
    try {
      const s = JSON.parse(readFileSync(join(dir, 'sessions', `${pid}.json`), 'utf8')) as {
        addr?: unknown;
      };
      if (typeof s.addr === 'string' && s.addr) return s.addr;
    } catch {
      /* not this ancestor */
    }
  }
  return undefined;
}

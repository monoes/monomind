// packages/@monomind/cli/src/orgrt/agent-exec-read.ts
/**
 * `agent exec --access read` (#388): read the project and the web, never
 * edit, never run an arbitrary command, never spawn a subagent. Enforced
 * in-process by `readAccessCanUseTool` on claude (canUseTool plus the
 * PreToolUse hook `coverEveryToolCall` installs, so every call is seen).
 * Other runtimes map `read` to their CLI's own read-only mode instead
 * (runner-access.ts lists which ones have one).
 *
 * Shell: only through an allowlist of command prefixes (the
 * `--allow-bash-prefix` machinery, with READ_BASH_PREFIXES as the default
 * list), a single literal invocation (agent-exec-shell-syntax.ts plus no
 * subshell parentheses), and no argument that makes an allowed command
 * write or run something (find -exec/-delete/-fprint*, rg --pre, git
 * --output/--ext-diff).
 */

import { hasUnsafeShellSyntax } from './agent-exec-shell-syntax.js';

/** Native tools a read turn may call (Claude Code names). `Skill` only reads
 *  a SKILL.md into context; `ToolSearch` only loads deferred tool schemas
 *  (WebFetch/WebSearch can be deferred). */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'Skill',
  'ToolSearch',
]);

/** Default read-only shell prefixes; `--allow-bash-prefix` adds to them. */
export const READ_BASH_PREFIXES: readonly string[] = [
  'git status',
  'git diff',
  'git log',
  'git show',
  'git blame',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'rg',
  'grep',
  'find',
];

/** find actions that run a command, delete, or write a file. */
const FIND_DENIED = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
]);

/** Split a command already cleared by hasUnsafeShellSyntax into words, with
 *  quotes and backslashes removed the way bash would (so `'-delete'` is
 *  seen as `-delete`). */
export function shellWords(cmd: string): string[] {
  const words: string[] = [];
  let cur = '';
  let has = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) words.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) words.push(cur);
  return words;
}

/** Unquoted `(` or `)` — a subshell or a function definition. */
function hasSubshell(cmd: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '\\' && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(' || c === ')') return true;
  }
  return false;
}

/** Why an argument of an allowed command is refused, or null. */
function deniedArgument(words: string[]): string | null {
  const [cmd, sub] = words;
  if (cmd === 'find') {
    const bad = words.find((w) => FIND_DENIED.has(w));
    if (bad) return `find ${bad} is not allowed in read access`;
  }
  if (cmd === 'rg' && words.some((w) => w === '--pre' || w.startsWith('--pre='))) {
    return 'rg --pre runs a command and is not allowed in read access';
  }
  if (cmd === 'git' && ['diff', 'log', 'show', 'blame', 'status'].includes(sub)) {
    const bad = words.find(
      (w) => w.startsWith('--output') || w === '--ext-diff' || w.startsWith('--ext-diff='),
    );
    if (bad) return `git ${sub} ${bad} is not allowed in read access`;
  }
  return null;
}

export type ShellVerdict = { ok: true } | { ok: false; message: string };

/** Whether one Bash command is allowed in read access. */
export function checkReadOnlyCommand(
  command: string,
  extraPrefixes: readonly string[] = [],
): ShellVerdict {
  const cmd = command.trim();
  const prefixes = [...READ_BASH_PREFIXES, ...extraPrefixes];
  if (!prefixes.some((p) => cmd === p || cmd.startsWith(`${p} `))) {
    return {
      ok: false,
      message: `read access allows only these shell commands: ${prefixes.join(', ')}.`,
    };
  }
  if (hasUnsafeShellSyntax(cmd) || hasSubshell(cmd)) {
    return {
      ok: false,
      message:
        'read access allows one literal command: only plain words, \'single-quoted\' text and simple "double-quoted" text (no pipes, redirects, chaining, substitution, globs or subshells). Wrap anything else, such as regexes, globs or non-ASCII text, in single quotes.',
    };
  }
  const bad = deniedArgument(shellWords(cmd));
  return bad ? { ok: false, message: bad } : { ok: true };
}

type Decision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/**
 * canUseTool for `--access read`: caller tools (both name forms — see
 * agent-exec.ts), READ_TOOLS, and Bash through checkReadOnlyCommand. Every
 * other native tool (Edit, Write, MultiEdit, NotebookEdit, Task/Agent, MCP
 * tools the user's settings load) is denied.
 */
export function readAccessCanUseTool(
  callerToolNames: ReadonlySet<string>,
  extraPrefixes: readonly string[] = [],
): (toolName: string, input: Record<string, unknown>) => Promise<Decision> {
  return async (toolName, input) => {
    if (callerToolNames.has(toolName) || READ_TOOLS.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    if (toolName === 'Bash') {
      const v =
        typeof input.command === 'string'
          ? checkReadOnlyCommand(input.command, extraPrefixes)
          : ({ ok: false, message: 'Bash call without a command' } as const);
      // Return the scanned (trimmed) string: bash must run what was checked.
      return v.ok
        ? { behavior: 'allow', updatedInput: { ...input, command: String(input.command).trim() } }
        : { behavior: 'deny', message: v.message };
    }
    return {
      behavior: 'deny',
      message: `Tool "${toolName}" is not allowed in read access (read files, search, web and read-only git only).`,
    };
  };
}

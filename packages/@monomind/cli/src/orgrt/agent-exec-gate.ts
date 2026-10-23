// packages/@monomind/cli/src/orgrt/agent-exec-gate.ts
// Split out of agent-exec.ts (file-size rule): the canUseTool gate for
// `--access scoped` (the caller's tool list plus `--allow-bash-prefix`) and
// `--access read` (#388, agent-exec-read.ts). `--access full` uses
// agent-exec-access.ts's fullAccessCanUseTool and never reaches this.

import { readAccessCanUseTool } from './agent-exec-read.js';
import { hasUnsafeShellSyntax } from './agent-exec-shell-syntax.js';
import type { SandboxMode } from './runner-sandbox.js';

type Decision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export type ExecCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<Decision>;

/** Scoped access: only the caller's own tools, plus Bash commands that start
 *  with one of `bashPrefixes` and contain no shell metacharacters. */
export function scopedCanUseTool(
  allowedToolNames: ReadonlySet<string>,
  bashPrefixes: readonly string[],
): ExecCanUseTool {
  return async (toolName, input) => {
    if (allowedToolNames.has(toolName)) return { behavior: 'allow', updatedInput: input };
    if (toolName === 'Bash' && bashPrefixes.length > 0 && typeof input.command === 'string') {
      const cmd = input.command.trimStart();
      const matchesPrefix = bashPrefixes.some((p) => cmd === p || cmd.startsWith(`${p} `));
      // Return the scanned string: bash must run exactly what was checked.
      if (matchesPrefix && !hasUnsafeShellSyntax(cmd))
        return { behavior: 'allow', updatedInput: { ...input, command: cmd } };
      if (matchesPrefix)
        return {
          behavior: 'deny',
          message:
            'Bash command refused: only plain words, \'single-quoted\' text and simple "double-quoted" text are allowed (one literal invocation: no chaining, substitution, redirection, globs or expansion). Wrap anything else, such as regexes, globs or non-ASCII text, in single quotes.',
        };
    }
    return {
      behavior: 'deny',
      message:
        toolName === 'Bash' && bashPrefixes.length > 0
          ? `Bash is only allowed for commands starting with: ${bashPrefixes.join(', ')}.`
          : `Tool "${toolName}" was not in the tool list this exec call was given.`,
    };
  };
}

/**
 * The tool names the scoped/read gate allows: each caller tool as the
 * SDK's `mcp__org__<name>` and, for fence runtimes, its bare name. #482: a
 * claude turn under `--sandbox read-only|workspace-write` gets only the
 * prefixed form, so a caller tool named like a native one ("Write",
 * "Bash") can never let that native tool through.
 */
export function execAllowedToolNames(
  runtime: string,
  sandbox: SandboxMode | undefined,
  tools: ReadonlyArray<{ name: string }>,
): Set<string> {
  const prefixedOnly =
    runtime === 'claude' && (sandbox === 'read-only' || sandbox === 'workspace-write');
  return new Set(
    tools.flatMap((t) =>
      prefixedOnly ? [`mcp__org__${t.name}`] : [`mcp__org__${t.name}`, t.name],
    ),
  );
}

/** The gate for a scoped or read turn. */
export function execCanUseTool(
  access: 'scoped' | 'read',
  allowedToolNames: ReadonlySet<string>,
  bashPrefixes: readonly string[],
): ExecCanUseTool {
  return access === 'read'
    ? readAccessCanUseTool(allowedToolNames, bashPrefixes)
    : scopedCanUseTool(allowedToolNames, bashPrefixes);
}

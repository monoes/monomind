// Install/uninstall monograph quality gate into AI coding agents (Claude Code, Codex).

export type AgentHooksTarget = 'claude-code' | 'codex' | 'auto';

export interface SetupHooksOptions {
  root: string;
  target?: AgentHooksTarget;
  command?: string;
  uninstall?: boolean;
}

export interface SetupHooksResult {
  target: AgentHooksTarget;
  installed: boolean;
  modifiedFiles: string[];
  message: string;
}

export const AGENTS_BLOCK_START = '<!-- monograph-gate-start -->';
export const AGENTS_BLOCK_END   = '<!-- monograph-gate-end -->';
export const MONOGRAPH_GATE_SCRIPT = 'npx monograph check --since $(git merge-base HEAD main)';

/** Build the AGENTS.md block content. */
export function buildAgentsMdBlock(command: string): string {
  return [
    AGENTS_BLOCK_START,
    '',
    '## Pre-commit Quality Gate (monograph)',
    '',
    'Before completing any coding task, run:',
    '',
    '```sh',
    command,
    '```',
    '',
    'Fix any new issues before marking the task complete.',
    '',
    AGENTS_BLOCK_END,
  ].join('\n');
}

/** Merge the monograph gate block into AGENTS.md content (idempotent). */
export function mergeAgentsMdBlock(existing: string, block: string): string {
  const startIdx = existing.indexOf(AGENTS_BLOCK_START);
  const endIdx = existing.indexOf(AGENTS_BLOCK_END);
  if (startIdx !== -1 && endIdx !== -1) {
    return existing.slice(0, startIdx) + block + existing.slice(endIdx + AGENTS_BLOCK_END.length);
  }
  return existing ? existing + '\n\n' + block : block;
}

/** Remove the managed block from AGENTS.md. */
export function removeAgentsMdBlock(content: string): string {
  const startIdx = content.indexOf(AGENTS_BLOCK_START);
  const endIdx = content.indexOf(AGENTS_BLOCK_END);
  if (startIdx === -1 || endIdx === -1) return content;
  return content.slice(0, startIdx).trimEnd() + '\n' + content.slice(endIdx + AGENTS_BLOCK_END.length).trimStart();
}

/** Build a Claude Code settings.json PreToolUse hook entry. */
export function buildClaudeCodeHookEntry(command: string): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [{ type: 'command', command: `sh -c '${command} --quiet || true'` }],
        },
      ],
    },
  };
}

/** Merge a hook entry into an existing Claude Code settings object (idempotent). */
export function mergeClaudeCodeSettings(
  existing: Record<string, unknown>,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const result = { $schema: '', ...existing, ...entry };
  if (!result.$schema) delete result.$schema;
  return result;
}

export const DEFAULT_SETUP_RESULT: SetupHooksResult = {
  target: 'auto', installed: false, modifiedFiles: [], message: 'No agent detected',
};

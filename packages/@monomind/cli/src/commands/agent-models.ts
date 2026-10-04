import { applyClaudePathFlag, claudePathOption } from '../orgrt/claude-selection.js';

/**
 * `monomind agent models --runtime <id> [--json]` (#369, capability
 * `agent-models`) — the runtime's own model list. See orgrt/agent-models.ts.
 */

import { listRuntimeModels } from '../orgrt/agent-models.js';
import { reportClaudeSkip } from '../orgrt/claude-sdk.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

export const modelsCommand: Command = {
  name: 'models',
  description: "List a runtime's available models (claude, codex, antigravity, opencode)",
  options: [
    claudePathOption,
    { name: 'runtime', description: 'Runtime id (see agent scan)', type: 'string' },
    { name: 'json', description: 'Emit the protocol JSON shape (§12)', type: 'boolean' },
  ],
  examples: [
    {
      command: 'monomind agent models --runtime claude --json',
      description: "Claude Code's model picker list",
    },
    { command: 'monomind agent models --runtime codex', description: 'Codex models as a table' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    applyClaudePathFlag(ctx.flags);
    const runtime = String(ctx.flags.runtime ?? ctx.args[0] ?? '');
    if (!runtime) {
      output.printError('--runtime <id> is required (see agent scan)');
      return { success: false, exitCode: 2 };
    }
    const result = await listRuntimeModels(runtime);
    const exitCode = result.error?.code === 'unknown-runtime' ? 2 : result.error ? 1 : 0;

    if (ctx.flags.json || ctx.flags.format === 'json') {
      output.printJson(result);
      return { success: exitCode === 0, exitCode, data: result };
    }
    if (result.claude_code) reportClaudeSkip(result.claude_code);
    if (result.error) {
      output.printError(result.error.message);
      return { success: false, exitCode };
    }
    if (!result.supported) {
      output.writeln(
        result.reason ??
          `${runtime} has no model-listing command — pass a model id its CLI accepts.`,
      );
      return { success: true, data: result };
    }
    output.printTable({
      columns: [
        { key: 'id', header: 'Model', width: 34 },
        { key: 'label', header: 'Label', width: 30 },
        { key: 'effort', header: 'Effort', width: 30 },
      ],
      data: result.models.map((m) => ({
        id: m.default ? `${m.id} (default)` : m.id,
        label: m.alias_of
          ? `${m.label} (alias of ${m.alias_of})`
          : m.resolved_id
            ? `${m.label} → ${m.resolved_id}`
            : m.label,
        effort: m.effort_levels?.join(',') ?? '—',
      })),
    });
    return { success: true, data: result };
  },
};

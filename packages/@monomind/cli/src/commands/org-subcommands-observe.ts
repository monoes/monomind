// packages/@monomind/cli/src/commands/org-subcommands-observe.ts
//
// `monomind org` observability subcommands: logs, events, watch, report,
// costs, flow, and the checkpoint tools replay, resume-from, branch, decisions.

import type { Command, CommandContext, CommandResult } from '../types.js';
import { validateOrgName } from './org-control.js';

export const logsSubcommand: Command = {
  name: 'logs',
  description: 'Show (or follow) the formatted event log of an org run',
  options: [
    { name: 'run', description: 'Run id (default: latest)', type: 'string' },
    { name: 'role', description: 'Only events from/to this role', type: 'string' },
    {
      name: 'filter-tool',
      description: 'Filter events by tool name (e.g., Write, Edit)',
      type: 'string',
    },
    { name: 'filter-role', description: 'Filter events by role ID', type: 'string' },
    {
      name: 'tools-only',
      description: 'Show only tool events (exclude messages/status/audit)',
      type: 'boolean',
    },
    {
      name: 'audit-filter',
      description: 'Filter audit events by decision (allow|deny)',
      type: 'string',
    },
    { name: 'follow', short: 'f', description: 'Keep tailing until Ctrl-C', type: 'boolean' },
  ],
  examples: [
    { command: 'monomind org logs growth --follow', description: 'Live-tail the latest run' },
    {
      command: 'monomind org logs growth --tools-only',
      description: 'Show only tool call events',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { logsAction } = await import('./org-observe.js');
    return logsAction(ctx, v.name);
  },
};

export const eventsSubcommand: Command = {
  name: 'events',
  description:
    "Tail a run's bus events as NDJSON — the machine streaming surface (agent-exec-protocol.md §7.3)",
  options: [
    { name: 'run', description: 'Run id (default: latest)', type: 'string' },
    { name: 'follow', short: 'f', description: 'Keep tailing until Ctrl-C', type: 'boolean' },
    {
      name: 'since',
      description: 'Replay cursor: an event id or ISO-8601 timestamp',
      type: 'string',
    },
    {
      name: 'ndjson',
      description: 'Accepted for spec symmetry — NDJSON is the only output mode',
      type: 'boolean',
    },
  ],
  examples: [
    {
      command: 'monomind org events growth --follow',
      description: 'Live NDJSON tail of the latest run',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { eventsAction } = await import('./org-observe.js');
    return eventsAction(ctx, v.name);
  },
};

export const watchSubcommand: Command = {
  name: 'watch',
  description:
    "Live-tail one role's assistant chat text (any runtime) — a filtered, friendlier `logs --follow`",
  options: [
    { name: 'run', description: 'Run id (default: latest)', type: 'string' },
    {
      name: 'follow',
      description:
        'Set --follow=false to print current output once and exit instead of live-tailing',
      type: 'boolean',
      default: true,
    },
    {
      name: 'verbose',
      description: 'Also interleave status events (restart/crash/state-change) into the transcript',
      type: 'boolean',
    },
    {
      name: 'stats',
      description: 'Print a running token/cost line as usage events arrive',
      type: 'boolean',
    },
  ],
  examples: [
    {
      command: 'monomind org watch growth researcher',
      description: "Watch the researcher role's live output",
    },
    {
      command: 'monomind org watch growth researcher --verbose --stats',
      description: 'Also show restarts/crashes and a running token/cost total',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { watchAction } = await import('./org-observe.js');
    return watchAction(ctx, v.name);
  },
};

export const reportSubcommand: Command = {
  name: 'report',
  description: 'Summarize an org run: outcome, per-role activity, tokens, assets, crashes',
  options: [
    { name: 'run', description: 'Run id (default: latest)', type: 'string' },
    { name: 'all', description: 'List all recorded runs from history', type: 'boolean' },
    { name: 'by-role', description: 'Show per-role cost breakdown', type: 'boolean' },
    {
      name: 'context',
      description: 'Show per-role context size and prefix cache read vs write per model call',
      type: 'boolean',
    },
    { name: 'audit', description: 'Show tool audit trail', type: 'boolean' },
    {
      name: 'tool',
      description: 'Filter tool audit by tool name (with --audit)',
      type: 'string',
    },
    { name: 'format', description: 'Output format (mermaid for flowchart)', type: 'string' },
  ],
  examples: [{ command: 'monomind org report growth', description: 'Report on the latest run' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { reportAction } = await import('./org-observe.js');
    return reportAction(ctx, v.name);
  },
};

export const costsSubcommand: Command = {
  name: 'costs',
  description: 'Show per-role cost tracking from runtime.json',
  options: [{ name: 'run', description: 'Run ID (defaults to latest)', type: 'string' }],
  examples: [
    { command: 'monomind org costs growth', description: 'Show cost breakdown for latest run' },
    {
      command: 'monomind org costs growth --run run-20240130-123456',
      description: 'Show cost breakdown for specific run',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { costsAction } = await import('./org-observe.js');
    return costsAction(ctx, v.name);
  },
};

export const flowSubcommand: Command = {
  name: 'flow',
  description: 'Export org flow as Mermaid diagram',
  options: [{ name: 'run', description: 'Run ID (defaults to latest)', type: 'string' }],
  examples: [
    {
      command: 'monomind org flow growth --run run-20250130120000',
      description: 'Export Mermaid flowchart',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { flowAction } = await import('./org-observe.js');
    return flowAction(ctx, v.name);
  },
};

export const replaySubcommand: Command = {
  name: 'replay',
  description:
    'Time-travel debugging: replay a run\'s bus events (does not resume live execution — use "org run --resume" for that)',
  examples: [
    {
      command: 'monomind org replay growth run-20250130120000-abc',
      description: "Replay a checkpoint's events for inspection",
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { replayAction } = await import('./org-observe.js');
    return replayAction(ctx, v.name);
  },
};

export const resumeFromSubcommand: Command = {
  name: 'resume-from',
  description:
    "Resume live execution from the org's persisted checkpoint (restores mailbox/policy/session state; subject to TTL and checksum validation)",
  examples: [
    {
      command: 'monomind org resume-from growth',
      description: 'Resume growth from its last checkpoint',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { resumeFromAction } = await import('./org-observe.js');
    return resumeFromAction(ctx, v.name);
  },
};

export const branchSubcommand: Command = {
  name: 'branch',
  description:
    "Snapshot a run's event log into a new run for replay — usage: org branch <org> <run-id> <label>. The new run's id is generated; <label> is only a note recorded in its .branch-source",
  examples: [
    {
      command: 'monomind org branch growth run-20250130 "before the outage"',
      description:
        'Snapshot run-20250130 into a new generated run id, noting why in .branch-source (the label does not name the run)',
    },
    {
      command: 'monomind org branch growth run-20250130 pre-outage --format json',
      description:
        'Same, printing {"run": "<generated id>", ...} so a script can replay it without parsing prose',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { branchAction } = await import('./org-observe.js');
    return branchAction(ctx, v.name);
  },
};

export const decisionsSubcommand: Command = {
  name: 'decisions',
  description: 'Show Rifft-style decision traces',
  examples: [
    {
      command: 'monomind org decisions growth --run run-20250130',
      description: 'Show decision traces',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const v = validateOrgName(ctx.args[0]);
    if (!v.ok) return v.result;
    const { decisionsAction } = await import('./org-observe.js');
    return decisionsAction(ctx, v.name);
  },
};

/**
 * Static command summaries for `monomind --help`.
 *
 * The main help screen only prints each command's name and description, but
 * reading those from the Command objects meant importing all of the lazy
 * command modules (~1s of module loading). This table lets help render
 * without importing any of them. A test (help-summaries.test.ts) fails when it
 * drifts from the real commands, so edit it alongside a command's description.
 * Hidden commands are intentionally absent.
 */

export interface HelpSummary {
  name: string;
  description: string;
}

export const HELP_SUMMARIES: Record<
  'primary' | 'advanced' | 'utility' | 'analysis' | 'management',
  HelpSummary[]
> = {
  primary: [
    { name: 'init', description: 'Initialize MonoMind in the current directory' },
    { name: 'start', description: 'Start the MonoMind orchestration system' },
    { name: 'status', description: 'Show system status' },
    { name: 'ui', description: 'Start the Monomind Neural Control Room (web UI dashboard)' },
    { name: 'agent', description: 'Agent management commands' },
    {
      name: 'org',
      description: 'SDK-based org runtime — run agent organizations as a controlled daemon',
    },
    { name: 'memory', description: 'Memory management commands' },
    { name: 'doc', description: 'Second Brain — document knowledge management' },
    { name: 'task', description: 'Task management commands' },
    { name: 'session', description: 'Session management commands' },
    { name: 'mcp', description: 'MCP server management' },
    {
      name: 'hooks',
      description:
        'Lifecycle hooks: log edits, outcomes and trajectories to local pattern files and route tasks to agents (no model is trained)',
    },
  ],
  advanced: [
    {
      name: 'security',
      description: 'Security scanning, CVE detection, threat modeling, AI defense',
    },
    {
      name: 'performance',
      description: 'Performance profiling, benchmarking, optimization, metrics',
    },
    {
      name: 'guidance',
      description: 'Wire enforcement gates (destructive-ops + secrets) into Claude Code hooks',
    },
    {
      name: 'design',
      description:
        'Design tooling: anti-pattern detection, OKLCH palette seeding, and design quality checks',
    },
    {
      name: 'mesh',
      description: 'Monomind Mesh: see and message the other agents running on this host',
    },
  ],
  utility: [
    { name: 'config', description: 'Configuration management' },
    { name: 'doctor', description: 'System diagnostics and health checks' },
    { name: 'completions', description: 'Generate shell completion scripts' },
    {
      name: 'crash-reporting',
      description:
        "Enable/disable automatic crash reporting. When a monoes tool crashes interactively, it asks once whether to file a GitHub issue on the tool's own repo — redacted, deduplicated, and skipped entirely if disabled. Until answered, a non-interactive crash (CI, agents) never asks and only saves locally.",
    },
    {
      name: 'events',
      description:
        'Stream live org events from the dashboard as JSONL (headless, for piping into other tools)',
    },
  ],
  analysis: [
    {
      name: 'analyze',
      description: 'Code analysis, diff classification, and change risk assessment',
    },
    {
      name: 'route',
      description: 'Task-to-agent routing through the central picker, with outcome tracking',
    },
    {
      name: 'pick',
      description:
        'Pick the best agents and skills for a task (Jev decision model, keyword fallback)',
    },
    {
      name: 'monograph',
      description: 'Knowledge graph for code and documents — build, search, explore',
    },
    { name: 'tokens', description: 'Token usage tracking and cost visualization' },
    {
      name: 'search',
      description:
        'Search across all content types in this directory. Documents are searched whenever the doc store has any (no rescan after `doc ingest`); other newly added content types need `search scan` or the daily automatic rescan',
    },
  ],
  management: [
    { name: 'providers', description: 'Manage AI providers, models, and configurations' },
    { name: 'update', description: 'Manage @monomind package updates (ADR-025)' },
    { name: 'cleanup', description: 'Remove project artifacts created by monomind/monomind' },
    {
      name: 'platforms',
      description: 'Plan and apply evidence-gated Monomind platform integrations',
    },
    { name: 'packs', description: 'List, add or remove opt-in skill/command/agent packs' },
    {
      name: 'catalog',
      description:
        'Policy-governed skill catalog: stage, inspect, approve, activate, disable, quarantine, release, revoke, list, show, search, audit, project, unproject',
    },
    {
      name: 'mastermind',
      description:
        'List or print portable Mastermind workflows for platforms without native skills',
    },
    { name: 'browse', description: 'Native browser automation via Chrome DevTools Protocol' },
    {
      name: 'deps',
      description: 'Install the heavy dependencies monomind otherwise installs on first use',
    },
    {
      name: 'download-embeddings',
      description: 'Download the semantic-routing embedding model (opt-in, ~88 MB)',
    },
  ],
};

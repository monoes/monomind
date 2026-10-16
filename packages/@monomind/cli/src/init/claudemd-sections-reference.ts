/**
 * CLAUDE.md section generators: CLI/agent/hooks/memory reference, build and
 * test, security, performance, intelligence, second brain, monograph and
 * setup sections.
 */

import { agentCommand } from '../commands/agent.js';
import { hooksCommand } from '../commands/hooks.js';
import { initCommand } from '../commands/init.js';
import { memoryCommand } from '../commands/memory.js';
import { sessionCommand } from '../commands/session.js';
import { taskCommand } from '../commands/task.js';
import { mcpAddHint } from '../platform-adapters/renderers/mcp.js';
import {
  detectOptionalPackages,
  detectStackConventions,
  isCapabilityActive,
  unavailNote,
  workerCountLabel,
} from './claudemd-detect.js';
import { WORKER_COUNT, WORKER_ROWS } from './generated-counts.js';
import { subcommandCount, workerTableRows } from './shared.js';
import type { InitOptions } from './types.js';

export function cliCommandsTable(): string {
  const avail = detectOptionalPackages();
  return `## CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | ${subcommandCount(initCommand)} | Project initialization |
| \`agent\` | ${subcommandCount(agentCommand)} | Agent lifecycle management |
| \`memory\` | ${subcommandCount(memoryCommand)} | SQLite memory with ANN search |
| \`task\` | ${subcommandCount(taskCommand)} | Task creation and lifecycle |
| \`session\` | ${subcommandCount(sessionCommand)} | Session state management |
| \`hooks\` | ${subcommandCount(hooksCommand)} | Edit/outcome logging, agent routing + ${workerCountLabel(avail.hooks)}background workers${unavailNote(avail.hooks)} |

> Note: there is no \`neural\` CLI command. Its pattern commands live under
> \`hooks intelligence\` — a local JSON pattern store; no model is trained.

### Quick CLI Examples

\`\`\`bash
npx monomind init wizard
npx monomind agent spawn -t coder --name my-coder
npx monomind org run <org>   # run an agent org
npx monomind memory search --query "authentication patterns"
npx monomind doctor --fix
\`\`\``;
}

export function agentPicking(): string {
  return `## Agent & Skill Picking

- When a prompt carries a \`[PICK]\` line, use its agent/skill unless it is clearly wrong for the task.
- Before choosing a subagent yourself, call \`mcp__monomind__pick\` if that tool is available, else run \`monomind pick -t "<task>" --json\` (or \`npx -y monomind pick -t "<task>" --json\`), then use its \`name\` as \`subagent_type\`. If \`confident\` is false, nothing fits — pick yourself.
- Load a platform skill with the Skill tool; read an org skill with \`mcp__monomind__org_skill_show {"name":"<name>"}\`.
- Never invent agent names — an uninstalled \`subagent_type\` fails at spawn time.`;
}

export function agentTypes(): string {
  return `## Available Agents (Curated Subset)

The full roster ships as \`.claude/agents/**/*.md\` — this is a hand-picked
fallback subset for when picking (see above) returns nothing; it is not the
complete set.

### Core Development
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### Specialized
\`Security Engineer\`

### Coordination
\`mesh-coordinator\`

### GitHub & Repository
\`pr-manager\`, \`monoswarm-code-review\`, \`issue-tracker\`, \`release-manager\``;
}

export function hooksSystem(): string {
  const avail = detectOptionalPackages();
  const workerHeading = avail.hooks ? ` + ${WORKER_COUNT} Background Workers` : '';
  return `## Hooks System (${subcommandCount(hooksCommand)} Hook Subcommands${workerHeading})

### Essential Hooks

| Hook | Description |
|------|-------------|
| \`pre-task\` / \`post-task\` | Route a task at start, record its outcome at end |
| \`pre-edit\` / \`post-edit\` | File editing with pattern logging |
| \`session-restore\` / \`session-end\` | Session state persistence |
| \`route\` | Route task to optimal agent |
| \`intelligence\` | Local pattern/trajectory store (JSON files; no model is trained) |
| \`worker\` | Background worker management |

### Background Workers (@monoes/hooks, run in-process)${unavailNote(avail.hooks)}

| Worker | Priority | Description |
|--------|----------|-------------|
${workerTableRows(WORKER_ROWS)}

Metrics-producing workers refresh at session start when output is >6h old.
${avail.hooks ? '' : '\n> \\@monoes/hooks is not resolvable in this install — background workers will fail to load (see `hooks worker list`). This is an install/publish gap, not a project misconfiguration.\n'}
\`\`\`bash
npx monomind hooks pre-task --description "[task]"
npx monomind hooks post-task --task-id "[id]" --success true
npx monomind hooks worker run audit
\`\`\``;
}

export function learningProtocol(): string {
  return `## Memory Protocol

### Before Starting Any Task
\`\`\`bash
npx monomind memory search --query "[task keywords]" --namespace patterns
npx monomind hooks route --task "[task description]"
\`\`\`

### After Completing Any Task Successfully
\`\`\`bash
npx monomind memory store --namespace patterns --key "[pattern-name]" --value "[what worked]"
npx monomind hooks post-task --task-id "[id]" --success true
\`\`\`

- ALWAYS check memory before starting new features, debugging, or refactoring
- ALWAYS store patterns in memory after solving bugs, completing features, or finding optimizations`;
}

export function memoryCommands(): string {
  return `## Memory Commands

\`\`\`bash
npx monomind memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns
npx monomind memory search --query "authentication patterns"
\`\`\`

Full command reference: \`npx monomind memory --help\``;
}

export function securityRulesLight(): string {
  return `## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run \`npx monomind security scan\` after security-related changes`;
}

// GH #412: a command line is emitted only for a step the project actually
// has (see detectStackConventions), and the section is dropped when it has
// none — an \`npm run lint\` that does not exist is an instruction that fails.
export function buildAndTest(options: InitOptions): string {
  const { build, test, lint } = detectStackConventions(options.targetDir);
  const commands = [build, test, lint].filter(Boolean);
  if (commands.length === 0) return '';
  const rules = [
    ...(test ? ['- ALWAYS run tests after making code changes'] : []),
    ...(build ? ['- ALWAYS verify build succeeds before committing'] : []),
  ];
  return `## Build & Test

\`\`\`bash
${commands.join('\n')}
\`\`\`${rules.length ? `\n\n${rules.join('\n')}` : ''}`;
}

export function securitySection(): string {
  return `## Security Protocol

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate all user input at system boundaries using Zod schemas
- Always sanitize file paths to prevent directory traversal attacks
- Always use parameterized queries — never concatenate SQL strings
- Run security audit after any authentication or authorization changes

### Security Scanning
\`\`\`bash
npx monomind security scan --depth full
npx monomind security audit --report
npx monomind security cve --check
\`\`\`

### Security Agents
- \`Security Engineer\` — threat modeling, secure code and architecture review
- Use agent routing code 9 (hierarchical/specialized) for security tasks`;
}

export function performanceSection(): string {
  return `## Performance Optimization Protocol

- Always run benchmarks before and after performance changes
- Always profile before optimizing — never guess at bottlenecks
- Prefer algorithmic improvements over micro-optimizations
- Prefer indexed (HNSW) vector search over brute-force scans for pattern lookup
- Keep memory reduction within 50-75% target with quantization

### Performance Tooling
\`\`\`bash
npx monomind performance benchmark --suite all
npx monomind performance profile --target "[component]"
npx monomind performance metrics --format table
\`\`\`

### Performance Agents
- \`Performance Benchmarker\` — bottleneck detection, benchmarking, analysis
- Use agent routing code 7 (hierarchical/specialized) for performance tasks`;
}

export function intelligenceSystem(): string {
  return `## Intelligence System

- **Keyword routing**: The picker routes prompts to agents and skills by keyword match
- **Pick stats**: Pick adherence and subagent outcomes (\`.monomind/pick-stats.json\`) act as a bounded ranking prior on later picks
- **Outcome logging**: Hooks log edits, outcomes and trajectories to local JSON pattern files; route outcomes are scored to measure routing accuracy
- **Pattern search**: SQLite-backed ANN vector search for finding similar past patterns

No model is trained — everything runs in JS on local files.`;
}

// Emitted only where `init` activated the documents capability — every other
// project paid for this section on every request without having an index.
export function secondBrainSection(options: InitOptions): string {
  if (!isCapabilityActive(options.targetDir, 'documents')) return '';
  return `## Second Brain — Document Knowledge Base

This project's documents are indexed for semantic search. Before answering business, compliance, legal, or organizational questions:
- Call \`mcp__monomind__knowledge_search\` (add \`store: "project"\` or \`"global"\` to search one brain only; default merges both, global hits are labeled \`[global]\`)
- Ground the answer in the returned excerpts and cite the source document name
- Add with \`mcp__monomind__knowledge_ingest\`; retract a wrong or stale document with \`mcp__monomind__knowledge_remove\``;
}

export function monographSection(): string {
  return `## Knowledge Graph — Monograph (Use Before Codebase Exploration)

- ALWAYS call \`mcp__monomind__monograph_query\` BEFORE grep/rg/find for code exploration — it returns file path + line from a SQLite code graph. Fall back to grep only if it returns 0 results or the graph is not built (then run \`monograph_build\`).
- Touching 3+ files: \`monograph_suggest\` (pass \`task\`) returns exploration questions ranked by task relevance; \`monograph_context\` shows a symbol's callers/callees/imports; \`monograph_impact\` shows the blast radius of a change.
- Skip it for single-file edits in a file you already know.`;
}

export function setupAndBoundary(): string {
  return `## Quick Setup

\`\`\`bash
# Add MCP server — includes monograph, memory, hooks and more
${mcpAddHint()}

# Verify everything works
npx monomind doctor --fix
\`\`\`

> **Package name changed:** Use \`monomind\` (not \`@monomind/cli@latest\` which is the old name and returns 404).

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents
- When the user names an installed coding agent ("run an agy agent", "ask codex to…", "use grok"), run it right away with \`monomind agent exec --runtime <id or binary> --prompt "…"\` (add \`--access full --cwd <dir>\` for file output) — don't ask first. The \`[AGENT_RUNTIMES]\` session line lists what is installed; on an \`auth\` error, give the user the login command

## Support

- Documentation: https://github.com/monoes/monomind
- Issues: https://github.com/monoes/monomind/issues`;
}

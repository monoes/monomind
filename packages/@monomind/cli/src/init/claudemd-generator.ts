/**
 * CLAUDE.md Generator
 * Generates enforceable, analyzer-optimized Claude Code configuration
 * with template variants for different usage patterns.
 *
 * Templates: minimal | standard | full | security | performance | solo
 * All templates use bullet-format rules with imperative keywords for enforceability.
 */

import { agentCommand } from '../commands/agent.js';
import { hooksCommand } from '../commands/hooks.js';
import { initCommand } from '../commands/init.js';
import { memoryCommand } from '../commands/memory.js';
import { monoswarmCommand } from '../commands/monoswarm.js';
import { sessionCommand } from '../commands/session.js';
import { taskCommand } from '../commands/task.js';
import { WORKER_COUNT, WORKER_ROWS } from './generated-counts.js';
import { _isOptionalPackageResolvable, subcommandCount, workerTableRows } from './shared.js';
import { detectProjectProfile } from './shared-instructions-generator.js';
import type { ClaudeMdTemplate, InitOptions } from './types.js';

// i-035: `monoswarm_init` writes a JSON state record and starts no process —
// nothing links its state to Claude Code's Task agents. The templates used to
// tell every project it "MUST initialize the monoswarm" before complex work;
// this is the honest replacement, worded from the same disclosure this repo
// already carries at .claude/agents/core/coordinator.md:105 and
// packages/@monomind/cli/CLAUDE.md's `adaptive`/`hybrid` topology annotation.
export const HONEST_MONOSWARM_SENTENCE =
  "Monoswarm records topology, roster and votes in a state file; it starts no process, and Claude Code's Task-tool agents do the work.";

/** Build/test/lint commands and layout for the stack actually in the repo. */
interface StackConventions {
  build: string;
  test: string;
  lint: string;
  srcDir: string;
  testDir: string;
}

/**
 * The File Organization and Build & Test sections used to prescribe `/src`
 * and npm unconditionally, which is wrong in every non-Node repo — GH #278
 * hit a Go project that got told to run `npm run build`. Reuse init's own
 * project detection, the same one that already labels
 * `.agents/shared_instructions.md` with "Stack: Go", instead of guessing.
 * A directory that isn't there is dropped rather than invented.
 */
function detectStackConventions(targetDir: string): StackConventions {
  const profile = detectProjectProfile(targetDir);
  const layout = { srcDir: profile.srcDir, testDir: profile.testDir };
  switch (profile.language) {
    case 'go':
      return { build: 'go build ./...', test: 'go test ./...', lint: 'go vet ./...', ...layout };
    case 'rust':
      return { build: 'cargo build', test: 'cargo test', lint: 'cargo clippy', ...layout };
    case 'python':
      return { build: '', test: 'pytest', lint: 'ruff check .', ...layout };
    default: {
      const run =
        profile.packageManager === 'pnpm'
          ? 'pnpm'
          : profile.packageManager === 'yarn'
            ? 'yarn'
            : profile.packageManager === 'bun'
              ? 'bun'
              : 'npm';
      return {
        build: `${run} run build`,
        test: `${run} test`,
        lint: `${run} run lint`,
        ...layout,
      };
    }
  }
}

// --- Optional package availability (P1-23) ---
// The docs below advertise features backed by optionalDependencies (npm may
// silently skip installing these), so the generated CLAUDE.md can say
// "(unavailable in this install)" instead of presenting an unresolvable
// package's features as unconditionally working. Resolution goes through
// _isOptionalPackageResolvable (shared.ts) — the one resolver for this
// question; write-capabilities.ts uses the same helper directly.
interface OptionalPackageAvailability {
  hooks: boolean;
  mcp: boolean;
  routing: boolean;
  monofence: boolean;
}
let _availabilityCache: OptionalPackageAvailability | null = null;
/** Test-only: `_availabilityCache` is module-level, so tests asserting both
 * the resolvable and unresolvable branches must clear it between cases. */
export function _resetOptionalPackageCache(): void {
  _availabilityCache = null;
}
function detectOptionalPackages(): OptionalPackageAvailability {
  if (_availabilityCache) return _availabilityCache;
  _availabilityCache = {
    hooks: _isOptionalPackageResolvable('@monoes/hooks'),
    mcp: _isOptionalPackageResolvable('@monoes/mcp'),
    routing: _isOptionalPackageResolvable('@monoes/routing'),
    monofence: _isOptionalPackageResolvable('monofence-ai'),
  };
  return _availabilityCache;
}
function unavailNote(available: boolean): string {
  return available ? '' : ' _(unavailable in this install)_';
}

// WORKER_COUNT (generated-counts.ts) is a build-time constant, computed
// from source regardless of whether @monoes/hooks resolves at `init` time —
// but printing it when the package is NOT resolvable would claim a count of
// workers that cannot actually run in this install, the same class of lie
// as a wrong number. Shown only when the package is genuinely available.
function workerCountLabel(hooksAvailable: boolean): string {
  return hooksAvailable ? `${WORKER_COUNT} ` : '';
}

// --- Section Generators (each returns enforceable markdown) ---

function behavioralRules(): string {
  return `## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- ALWAYS call \`mcp__monomind__monograph_query\` BEFORE running grep/rg/find via Bash for code exploration — only fall back to Bash grep if monograph returns 0 results or the DB does not exist
- When starting any task that touches 3+ files: call \`mcp__monomind__monograph_suggest\` first to get relevant nodes ranked by task relevance`;
}

function codingPrinciples(): string {
  return `## Coding Principles

### Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### Surgical Changes
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
- Every changed line should trace directly to the user's request.

### Goal-Driven Execution
- Transform tasks into verifiable goals with success criteria.
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- For multi-step tasks, state a brief plan with verification steps.`;
}

function fileOrganization(options: InitOptions): string {
  const { srcDir, testDir } = detectStackConventions(options.targetDir);
  const lines = ['- NEVER save to root folder — use the directories below'];
  if (srcDir) lines.push(`- Use \`/${srcDir}\` for source code files`);
  if (testDir) lines.push(`- Use \`/${testDir}\` for test files`);
  lines.push(
    '- Use `/docs` for documentation and markdown files',
    '- Use `/config` for configuration files',
    '- Use `/scripts` for utility scripts',
    '- Use `/examples` for example code',
  );
  return `## File Organization\n\n${lines.join('\n')}`;
}

function projectArchitecture(options: InitOptions): string {
  return `## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Project Config

- **Topology**: ${options.runtime.topology}
- **Max Agents**: ${options.runtime.maxAgents}
- **Memory**: ${options.runtime.memoryBackend}
- **Neural**: Disabled (keyword routing only)`;
}

function concurrencyRules(): string {
  return `## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message`;
}

function swarmOrchestration(): string {
  return `## Monoswarm Orchestration

- MUST spawn concurrent agents using Claude Code's Task tool
- ${HONEST_MONOSWARM_SENTENCE}`;
}

// Consolidated spawn/anti-drift rule — emitted ONCE in the standard template
// (previously repeated across Monoswarm Orchestration, Anti-Drift, and
// Execution Rules). Kept out of the minimal template entirely.
function swarmRules(): string {
  return `## Monoswarm Rules

- ${HONEST_MONOSWARM_SENTENCE}
- ALWAYS spawn ALL agents in ONE message via the Task tool with \`run_in_background: true\` — CLI tools coordinate, Task agents do the work
- After spawning, STOP — never poll TaskOutput or check monoswarm status; trust agents to return
- When agent results arrive, review ALL results before proceeding
- Keep shared memory namespace for all agents; run frequent checkpoints via \`post-task\` hooks`;
}

function antiDriftConfig(): string {
  return `## Monoswarm Configuration & Anti-Drift

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use \`majority\` consensus for monoswarm
- Run frequent checkpoints via \`post-task\` hooks
- Keep shared memory namespace for all agents`;
}

function autoStartProtocol(): string {
  return `## Monoswarm Protocols & Routing

### Auto-Start Monoswarm Protocol

When the user requests a complex task, spawn agents in background and WAIT:

\`\`\`javascript
// STEP 1: Spawn ALL agents IN BACKGROUND in a SINGLE message
Task({prompt: "Research requirements...", subagent_type: "researcher", run_in_background: true})
Task({prompt: "Design architecture...", subagent_type: "system-architect", run_in_background: true})
Task({prompt: "Implement solution...", subagent_type: "coder", run_in_background: true})
Task({prompt: "Write tests...", subagent_type: "tester", run_in_background: true})
Task({prompt: "Review code quality...", subagent_type: "reviewer", run_in_background: true})
\`\`\`

### Agent Routing

| Code | Task | Agents |
|------|------|--------|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |`;
}

function executionRules(): string {
  return `## Monoswarm Execution Rules

- ALWAYS use \`run_in_background: true\` for all agent Task calls
- ALWAYS put ALL agent Task calls in ONE message for parallel execution
- After spawning, STOP — do NOT add more tool calls or check status
- Never poll TaskOutput or check monoswarm status — trust agents to return
- When agent results arrive, review ALL results before proceeding`;
}

function cliCommandsTable(): string {
  const avail = detectOptionalPackages();
  return `## CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | ${subcommandCount(initCommand)} | Project initialization |
| \`agent\` | ${subcommandCount(agentCommand)} | Agent lifecycle management |
| \`monoswarm\` | ${subcommandCount(monoswarmCommand)} | Multi-agent coordination |
| \`memory\` | ${subcommandCount(memoryCommand)} | SQLite memory with ANN search |
| \`task\` | ${subcommandCount(taskCommand)} | Task creation and lifecycle |
| \`session\` | ${subcommandCount(sessionCommand)} | Session state management |
| \`hooks\` | ${subcommandCount(hooksCommand)} | Self-learning hooks + ${workerCountLabel(avail.hooks)}background workers${unavailNote(avail.hooks)} |

> Note: there is no \`neural\` CLI command. Neural pattern learning was merged
> into \`hooks intelligence\`. See \`doc/concepts/monoswarm.md\` for monoswarm
> coordination and vote strategies.

### Quick CLI Examples

\`\`\`bash
npx monomind init wizard
npx monomind agent spawn -t coder --name my-coder
npx monomind monoswarm init --v1-mode
npx monomind memory search --query "authentication patterns"
npx monomind doctor --fix
\`\`\``;
}

function agentTypes(): string {
  return `## Available Agents (Curated Subset)

The full roster ships as \`.claude/agents/**/*.md\` — this is a hand-picked
subset worth routing to by name; it is not the complete set.

### Core Development
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### Specialized
\`security-architect\`

### Monoswarm Coordination
\`mesh-coordinator\`

### GitHub & Repository
\`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\``;
}

function hooksSystem(): string {
  const avail = detectOptionalPackages();
  const workerHeading = avail.hooks ? ` + ${WORKER_COUNT} Background Workers` : '';
  return `## Hooks System (${subcommandCount(hooksCommand)} Hook Subcommands${workerHeading})

### Essential Hooks

| Hook | Description |
|------|-------------|
| \`pre-task\` / \`post-task\` | Task lifecycle with learning |
| \`pre-edit\` / \`post-edit\` | File editing with pattern logging |
| \`session-restore\` / \`session-end\` | Session state persistence |
| \`route\` | Route task to optimal agent |
| \`intelligence\` | Pattern-learning intelligence system |
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

function learningProtocol(): string {
  return `## Auto-Learning Protocol

### Before Starting Any Task
\`\`\`bash
npx monomind memory search --query "[task keywords]" --namespace patterns
npx monomind hooks route --task "[task description]"
\`\`\`

### After Completing Any Task Successfully
\`\`\`bash
npx monomind memory store --namespace patterns --key "[pattern-name]" --value "[what worked]"
npx monomind hooks post-task --task-id "[id]" --success true --store-results true
\`\`\`

- ALWAYS check memory before starting new features, debugging, or refactoring
- ALWAYS store patterns in memory after solving bugs, completing features, or finding optimizations`;
}

function memoryCommands(): string {
  return `## Memory Commands

\`\`\`bash
npx monomind memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns
npx monomind memory search --query "authentication patterns"
\`\`\`

Full command reference: \`npx monomind memory --help\``;
}

function securityRulesLight(): string {
  return `## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run \`npx monomind security scan\` after security-related changes`;
}

function buildAndTest(options: InitOptions): string {
  const { build, test, lint } = detectStackConventions(options.targetDir);
  const commands = [
    ...(build ? ['# Build', build, ''] : []),
    '# Test',
    test,
    '',
    '# Lint',
    lint,
  ].join('\n');
  return `## Build & Test

\`\`\`bash
${commands}
\`\`\`

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing`;
}

function securitySection(): string {
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
- \`security-architect\` — threat modeling, architecture review
- Use agent routing code 9 (hierarchical/specialized) for security tasks`;
}

function performanceSection(): string {
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
- \`perf-analyzer\` — bottleneck detection, analysis
- Use agent routing code 7 (hierarchical/specialized) for performance tasks`;
}

function intelligenceSystem(): string {
  return `## Intelligence System

- **Keyword routing**: Deterministic task→agent routing via \`createKeywordRouter\`
- **Outcome measurement**: Route and command outcomes are recorded and scored to surface routing accuracy over time
- **Pattern search**: SQLite-backed ANN vector search for finding similar past patterns

Routing and learning are JS-only — no native engine is required. Outcomes
feed back into the recorded metrics so routing quality is measured, not assumed.`;
}

// i-041/i-117 §4: MONOMIND_MEMORY_BACKEND and MONOMIND_MEMORY_PATH had no
// `process.env` reader anywhere in the repo (grepped — see claudemd-truth.test.ts
// and the developer report for the exact commands run). MONOMIND_CONFIG
// (services/config-file-manager.ts) and MONOMIND_LOG_LEVEL
// (mcp-tools/monoswarm-tools.ts) do; ANTHROPIC_API_KEY is read by the SDK,
// not by us. Keep only vars with a real reader — a var nobody reads is the
// same class of lie as a wrong count.
function envVars(): string {
  return `## Environment Variables

\`\`\`bash
MONOMIND_CONFIG=./monomind.config.json
MONOMIND_LOG_LEVEL=info
ANTHROPIC_API_KEY=sk-ant-...
\`\`\``;
}

function secondBrainSection(): string {
  return `## Second Brain — Document Knowledge Base

If the \`documents\` capability is active (check \`.monomind/capabilities.json\`), this project indexes documents (Office, PDF, plain text, and more) into a semantic search engine.

**When documents are indexed, search knowledge before answering questions about business, compliance, legal, or organizational topics:**
- Call \`mcp__monomind__knowledge_search\` with a relevant query (add \`store: "project"\` or \`"global"\` to search one brain only; default merges both)
- Use the returned excerpts as grounding context for your answer
- Cite the source document name when referencing specific information
- Add with \`mcp__monomind__knowledge_ingest\`; retract a wrong or stale document with \`mcp__monomind__knowledge_remove\` (hides it from search immediately, reversible by re-ingesting)

**Global brain:** the user has a personal cross-project knowledge store at \`~/.monomind/global-brain\`. All searches (knowledge_search, doc search, per-prompt injection) automatically merge it with project knowledge — project results win ties, global hits are labeled \`[global]\`. Cite the label so the user knows which brain answered.

**Re-indexing** happens automatically on session start (unchanged files are skipped via content hash).`;
}

function monographSection(): string {
  return `## Knowledge Graph — Monograph (Use Before Codebase Exploration)

Built into monomind — no separate install. Pure TypeScript, parses TS/JS/Python/Go/Rust/C/C++/Java/Ruby/Swift into a SQLite graph with BM25 full-text search.

### MANDATORY: Graph-First, Grep-Last

**Before ANY grep/rg/find via Bash for code navigation:**
1. Call \`mcp__monomind__monograph_query\` first — returns file path + line number
2. Only fall back to Bash grep if monograph returns 0 results or reports DB missing

**When starting any task touching 3+ files:**
1. \`mcp__monomind__monograph_suggest\` — relevant nodes ranked by task description
2. \`mcp__monomind__monograph_context\` — 360° view of a symbol (callers, callees, imports)
3. \`mcp__monomind__monograph_impact\` — blast radius before changing anything

**If graph is empty:** call \`mcp__monomind__monograph_build\` (runs in background; proceed with grep while it builds).

Core tools (prefix: \`mcp__monomind__\`): \`monograph_build\`, \`monograph_query\`, \`monograph_suggest\`, \`monograph_impact\` — the full tool list self-describes via MCP.

### Skip monograph for
Single-file edits, doc/config changes, quick fixes where you already know the exact file.`;
}

function setupAndBoundary(): string {
  return `## Quick Setup

\`\`\`bash
# Add MCP server — includes monograph, monoswarm, memory, hooks, all 66+ tools
claude mcp add monomind -- npx -y monomind mcp start

# Verify everything works
npx monomind doctor --fix
\`\`\`

> **Package name changed:** Use \`monomind\` (not \`@monomind/cli@latest\` which is the old name and returns 404).

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: monoswarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Support

- Documentation: https://github.com/monoes/monomind
- Issues: https://github.com/monoes/monomind/issues`;
}

// --- Template Composers ---

/**
 * Template section map — defines which sections are included per template.
 */
const TEMPLATE_SECTIONS: Record<ClaudeMdTemplate, Array<(opts: InitOptions) => string>> = {
  minimal: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    (_opts) => securityRulesLight(),
    concurrencyRules,
    (_opts) => secondBrainSection(),
    (_opts) => monographSection(),
    (_opts) => setupAndBoundary(),
  ],
  standard: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    (_opts) => securityRulesLight(),
    concurrencyRules,
    (_opts) => swarmRules(),
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => memoryCommands(),
    (_opts) => secondBrainSection(),
    (_opts) => monographSection(),
    (_opts) => setupAndBoundary(),
  ],
  full: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    (_opts) => securityRulesLight(),
    concurrencyRules,
    (_opts) => swarmOrchestration(),
    (_opts) => antiDriftConfig(),
    (_opts) => autoStartProtocol(),
    executionRules,
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => hooksSystem(),
    (_opts) => learningProtocol(),
    (_opts) => memoryCommands(),
    (_opts) => secondBrainSection(),
    (_opts) => monographSection(),
    (_opts) => intelligenceSystem(),
    (_opts) => envVars(),
    (_opts) => setupAndBoundary(),
  ],
  security: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    concurrencyRules,
    (_opts) => swarmOrchestration(),
    (_opts) => antiDriftConfig(),
    executionRules,
    (_opts) => securitySection(),
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => memoryCommands(),
    (_opts) => secondBrainSection(),
    (_opts) => monographSection(),
    (_opts) => setupAndBoundary(),
  ],
  performance: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    (_opts) => securityRulesLight(),
    concurrencyRules,
    (_opts) => swarmOrchestration(),
    (_opts) => antiDriftConfig(),
    executionRules,
    (_opts) => performanceSection(),
    (_opts) => cliCommandsTable(),
    (_opts) => agentTypes(),
    (_opts) => memoryCommands(),
    (_opts) => secondBrainSection(),
    (_opts) => monographSection(),
    (_opts) => intelligenceSystem(),
    (_opts) => setupAndBoundary(),
  ],
  solo: [
    behavioralRules,
    (_opts) => codingPrinciples(),
    fileOrganization,
    projectArchitecture,
    buildAndTest,
    (_opts) => securityRulesLight(),
    concurrencyRules,
    executionRules,
    (_opts) => cliCommandsTable(),
    (_opts) => memoryCommands(),
    (_opts) => setupAndBoundary(),
  ],
};

// --- Public API ---

/**
 * Generate CLAUDE.md content based on init options and template.
 * Template is determined by: options.runtime.claudeMdTemplate > explicit param > 'standard'
 */
export function generateClaudeMd(options: InitOptions, template?: ClaudeMdTemplate): string {
  const tmpl = template ?? options.runtime.claudeMdTemplate ?? 'standard';
  const sections = TEMPLATE_SECTIONS[tmpl] ?? TEMPLATE_SECTIONS.standard;

  const header = `# Claude Code Configuration - Monomind\n`;
  const body = sections.map((fn) => fn(options)).join('\n\n');

  return `${header}\n${body}\n`;
}

/**
 * Generate minimal CLAUDE.md content (backward-compatible alias).
 */
export function generateMinimalClaudeMd(options: InitOptions): string {
  return generateClaudeMd(options, 'minimal');
}

/** Available template names for CLI wizard */
export const CLAUDE_MD_TEMPLATES: Array<{ name: ClaudeMdTemplate; description: string }> = [
  { name: 'minimal', description: 'Quick start — behavioral rules, CLI reference (~160 lines)' },
  {
    name: 'standard',
    description: 'Recommended — monoswarm rules, agents, memory commands (~225 lines)',
  },
  {
    name: 'full',
    description: 'Everything — hooks, learning protocol, intelligence system (~400 lines)',
  },
  {
    name: 'security',
    description: 'Security-focused — adds security scanning, audit protocols, CVE checks',
  },
  {
    name: 'performance',
    description: 'Performance-focused — adds benchmarking, profiling, optimization protocols',
  },
  {
    name: 'solo',
    description: 'Solo developer — no monoswarm, simple agent usage, memory commands (~150 lines)',
  },
];

export default generateClaudeMd;

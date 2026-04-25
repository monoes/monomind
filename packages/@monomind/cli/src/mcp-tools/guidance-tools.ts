/**
 * Guidance MCP Tools
 *
 * Helps the system navigate Monobrain's capabilities by providing structured
 * discovery of tools, commands, agents, skills, and recommended workflows.
 *
 * @module @monobrain/cli/mcp-tools/guidance
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_ROOT = join(__dirname, '../../..');

/**
 * Find the project root by looking for .claude/ directory.
 * Tries CWD first (most common), then walks up from the CLI package location.
 */
function findProjectRoot(): string {
  // Strategy 1: CWD (most reliable when invoked by user)
  if (existsSync(join(getProjectCwd(), '.claude'))) {
    return getProjectCwd();
  }

  // Strategy 2: Walk up from CLI package location
  // CLI is at packages/@monobrain/cli/ — project root is 4 levels up
  const fromPackage = join(CLI_ROOT, '../../../..');
  if (existsSync(join(fromPackage, '.claude'))) {
    return fromPackage;
  }

  // Strategy 3: Walk up from CWD
  let dir = getProjectCwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.claude'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: CWD
  return getProjectCwd();
}

const PROJECT_ROOT = findProjectRoot();

// ── Capability Catalog ──────────────────────────────────────

interface CapabilityArea {
  name: string;
  description: string;
  tools: string[];
  commands: string[];
  agents: string[];
  skills: string[];
  whenToUse: string;
}

const CAPABILITY_CATALOG: Record<string, CapabilityArea> = {
  'agent-management': {
    name: 'Agent Management',
    description: 'Spawn, manage, and monitor individual AI agents with lifecycle control.',
    tools: ['agent_spawn', 'agent_list', 'agent_status', 'agent_stop', 'agent_metrics', 'agent_pool', 'agent_health', 'agent_logs'],
    commands: ['agent spawn', 'agent list', 'agent status', 'agent stop', 'agent metrics', 'agent pool', 'agent health', 'agent logs'],
    agents: ['coder', 'tester', 'reviewer', 'researcher', 'planner'],
    skills: [],
    whenToUse: 'When you need to create or manage individual agents for specific tasks.',
  },
  'swarm-orchestration': {
    name: 'Swarm Orchestration',
    description: 'Multi-agent coordination with topology-aware communication and consensus.',
    tools: ['swarm_init', 'swarm_status', 'swarm_spawn', 'swarm_terminate', 'swarm_topology', 'swarm_metrics'],
    commands: ['swarm init', 'swarm status', 'swarm spawn', 'swarm terminate'],
    agents: ['hierarchical-coordinator', 'mesh-coordinator', 'adaptive-coordinator', 'queen-coordinator', 'collective-intelligence-coordinator'],
    skills: ['swarm-orchestration', 'swarm-advanced', 'monobrain-swarm'],
    whenToUse: 'When a task requires multiple agents working together (3+ files, features, refactoring).',
  },
  'memory-knowledge': {
    name: 'Memory & Knowledge',
    description: 'Persistent memory with HNSW vector search, AgentDB storage, and embeddings.',
    tools: ['memory_store', 'memory_retrieve', 'memory_search', 'memory_list', 'memory_delete', 'memory_init', 'memory_export', 'memory_import', 'memory_stats', 'memory_compact', 'memory_namespace'],
    commands: ['memory store', 'memory retrieve', 'memory search', 'memory list', 'memory delete', 'memory init'],
    agents: ['swarm-memory-manager', 'v1-memory-specialist'],
    skills: ['v1-memory-unification', 'agentdb-advanced', 'agentdb-vector-search', 'agentdb-memory-patterns', 'agentdb-learning'],
    whenToUse: 'When you need to persist, search, or retrieve knowledge across sessions.',
  },
  'intelligence-learning': {
    name: 'Intelligence & Learning',
    description: 'Neural pattern training (SONA), RL loops, Flash Attention, EWC++ consolidation.',
    tools: ['neural_train', 'neural_predict', 'neural_status', 'neural_patterns', 'neural_optimize'],
    commands: ['neural train', 'neural predict', 'neural status', 'neural patterns', 'neural optimize'],
    agents: ['sona-learning-optimizer', 'safla-neural'],
    skills: ['reasoningbank-intelligence', 'reasoningbank-agentdb'],
    whenToUse: 'When optimizing agent routing, training patterns from outcomes, or adaptive learning.',
  },
  'hooks-automation': {
    name: 'Hooks & Automation',
    description: '17 lifecycle hooks + 12 background workers for automated learning and coordination.',
    tools: ['hooks_pre_task', 'hooks_post_task', 'hooks_pre_edit', 'hooks_post_edit', 'hooks_route', 'hooks_explain'],
    commands: [
      'hooks pre-task', 'hooks post-task', 'hooks pre-edit', 'hooks post-edit',
      'hooks session-start', 'hooks session-end', 'hooks route', 'hooks explain',
      'hooks pretrain', 'hooks build-agents', 'hooks intelligence', 'hooks worker',
      'hooks coverage-gaps', 'hooks coverage-route', 'hooks coverage-suggest',
      'hooks statusline', 'hooks progress',
    ],
    agents: [],
    skills: ['hooks-automation'],
    whenToUse: 'When you need pre/post task hooks, background workers, coverage routing, or intelligence.',
  },
  'hive-mind': {
    name: 'Hive Mind Consensus',
    description: 'Queen-led Byzantine fault-tolerant distributed consensus with multiple strategies.',
    tools: ['hive_mind_init', 'hive_mind_status', 'hive_mind_propose', 'hive_mind_vote', 'hive_mind_consensus', 'hive_mind_metrics'],
    commands: ['hive-mind init', 'hive-mind status', 'hive-mind consensus', 'hive-mind sessions', 'hive-mind spawn', 'hive-mind stop'],
    agents: ['byzantine-coordinator', 'raft-manager', 'gossip-coordinator', 'crdt-synchronizer', 'quorum-manager'],
    skills: ['hive-mind-advanced'],
    whenToUse: 'When multiple agents need to reach agreement on decisions using BFT, Raft, or CRDT.',
  },
  'security': {
    name: 'Security & Compliance',
    description: 'Security scanning, CVE remediation, input validation, claims-based authorization.',
    tools: ['security_scan', 'security_audit', 'security_cve', 'security_threats', 'security_validate', 'security_report', 'claims_check', 'claims_grant', 'claims_revoke', 'claims_list'],
    commands: ['security scan', 'security audit', 'security cve', 'security threats', 'claims check', 'claims grant'],
    agents: ['v1-security-architect'],
    skills: ['v1-security-overhaul'],
    whenToUse: 'When auditing code for vulnerabilities, managing permissions, or security reviews.',
  },
  'performance': {
    name: 'Performance & Profiling',
    description: 'Benchmarking, profiling, metrics collection, and optimization recommendations.',
    tools: ['performance_benchmark', 'performance_profile', 'performance_metrics', 'performance_optimize', 'performance_report'],
    commands: ['performance benchmark', 'performance profile', 'performance metrics', 'performance optimize', 'performance report'],
    agents: ['v1-performance-engineer'],
    skills: ['v1-performance-optimization', 'performance-analysis'],
    whenToUse: 'When measuring, profiling, or optimizing system performance.',
  },
  'github-integration': {
    name: 'GitHub Integration',
    description: 'PR management, code review, issue tracking, release automation, multi-repo coordination.',
    tools: ['github_pr_manage', 'github_code_review', 'github_issue_track', 'github_repo_analyze', 'github_sync_coord', 'github_metrics'],
    commands: [],
    agents: ['pr-manager', 'code-review-swarm', 'issue-tracker', 'release-manager', 'repo-architect', 'workflow-automation', 'multi-repo-swarm', 'project-board-sync', 'swarm-pr', 'swarm-issue', 'sync-coordinator', 'github-modes', 'release-swarm'],
    skills: ['github-release-management', 'github-workflow-automation', 'github-code-review', 'github-project-management', 'github-multi-repo'],
    whenToUse: 'When working with GitHub repos, PRs, issues, releases, or CI/CD pipelines.',
  },
  'session-workflow': {
    name: 'Session & Workflow',
    description: 'Session state management, workflow execution, task lifecycle, and daemon scheduling.',
    tools: ['session_start', 'session_end', 'session_restore', 'session_list', 'workflow_execute', 'workflow_create', 'task_create', 'task_assign', 'task_status'],
    commands: ['session start', 'session end', 'session restore', 'workflow execute', 'workflow create', 'task create', 'daemon start', 'daemon stop'],
    agents: [],
    skills: [],
    whenToUse: 'When managing long-running sessions, executing workflow templates, or scheduling tasks.',
  },
  'embeddings-vectors': {
    name: 'Embeddings & Vector Search',
    description: 'Vector embeddings with sql.js, HNSW indexing, hyperbolic embeddings, ONNX integration.',
    tools: ['embeddings_embed', 'embeddings_batch', 'embeddings_search', 'embeddings_init'],
    commands: ['embeddings embed', 'embeddings batch', 'embeddings search', 'embeddings init'],
    agents: [],
    skills: ['agentdb-vector-search', 'agentdb-optimization'],
    whenToUse: 'When you need semantic search, document embedding, or vector similarity operations.',
  },
  'wasm-agents': {
    name: 'WASM Sandboxed Agents',
    description: 'Sandboxed AI agents running in WebAssembly with virtual filesystem, no OS access.',
    tools: ['wasm_agent_create', 'wasm_agent_prompt', 'wasm_agent_tool', 'wasm_agent_list', 'wasm_agent_terminate', 'wasm_agent_files', 'wasm_agent_export', 'wasm_gallery_list', 'wasm_gallery_search', 'wasm_gallery_create'],
    commands: [],
    agents: [],
    skills: [],
    whenToUse: 'When you need sandboxed agent execution without OS access (safe, isolated environments).',
  },
  'ruvllm-inference': {
    name: 'RuVLLM Inference',
    description: 'WASM-based HNSW routing, SONA instant adaptation, MicroLoRA, chat formatting.',
    tools: ['ruvllm_status', 'ruvllm_hnsw_create', 'ruvllm_sona_create', 'ruvllm_microlora_create', 'ruvllm_chat_format', 'ruvllm_kvcache_create'],
    commands: [],
    agents: [],
    skills: [],
    whenToUse: 'When you need WASM-native HNSW routing, SONA adaptation, or MicroLoRA fine-tuning.',
  },
  'code-analysis': {
    name: 'Code Analysis & Diff',
    description: 'AST analysis, diff classification, coverage routing, dependency graph analysis.',
    tools: ['analyze_diff', 'analyze_coverage', 'analyze_graph'],
    commands: [],
    agents: ['code-analyzer'],
    skills: ['verification-quality'],
    whenToUse: 'When analyzing code quality, diffs, coverage gaps, or dependency graphs.',
  },
  'sparc-methodology': {
    name: 'SPARC Methodology',
    description: 'Specification, Pseudocode, Architecture, Refinement, Completion — structured development.',
    tools: [],
    commands: [],
    agents: ['specification', 'pseudocode', 'architecture', 'refinement'],
    skills: ['sparc-methodology'],
    whenToUse: 'When following structured SPARC development methodology for new features.',
  },
  'config-system': {
    name: 'Configuration & System',
    description: 'Configuration management, provider setup, system diagnostics, shell completions.',
    tools: ['config_get', 'config_set', 'config_list', 'config_provider'],
    commands: ['config get', 'config set', 'config list', 'config provider', 'doctor', 'status', 'providers list', 'completions'],
    agents: [],
    skills: [],
    whenToUse: 'When managing configuration, providers, or running diagnostics.',
  },
};

// ── Task-to-Capability Routing ──────────────────────────────

interface TaskRoute {
  pattern: RegExp;
  areas: string[];
  workflow: string;
}

const TASK_ROUTES: TaskRoute[] = [
  { pattern: /\b(bug|fix|debug|error|issue|crash|broken)\b/i, areas: ['agent-management', 'hooks-automation'], workflow: 'bugfix' },
  { pattern: /\b(feature|implement|create|build|add)\b/i, areas: ['swarm-orchestration', 'agent-management', 'hooks-automation'], workflow: 'feature' },
  { pattern: /\b(refactor|restructure|reorganize|clean\s*up|modernize)\b/i, areas: ['swarm-orchestration', 'code-analysis'], workflow: 'refactor' },
  { pattern: /\b(test|coverage|tdd|spec|assert)\b/i, areas: ['agent-management', 'hooks-automation', 'code-analysis'], workflow: 'testing' },
  { pattern: /\b(security|vulnerab|cve|audit|threat|auth)\b/i, areas: ['security'], workflow: 'security' },
  { pattern: /\b(perf|benchmark|profil|slow|optimi|latency|speed)\b/i, areas: ['performance'], workflow: 'performance' },
  { pattern: /\b(memory|embed|vector|search|hnsw|semantic)\b/i, areas: ['memory-knowledge', 'embeddings-vectors'], workflow: 'memory' },
  { pattern: /\b(pr|pull\s*request|review|merge|branch)\b/i, areas: ['github-integration'], workflow: 'github-pr' },
  { pattern: /\b(release|deploy|publish|version|changelog)\b/i, areas: ['github-integration', 'session-workflow'], workflow: 'release' },
  { pattern: /\b(swarm|multi.agent|coordin|hive|consensus)\b/i, areas: ['swarm-orchestration', 'hive-mind'], workflow: 'swarm' },
  { pattern: /\b(learn|train|neural|pattern|sona|lora)\b/i, areas: ['intelligence-learning'], workflow: 'learning' },
  { pattern: /\b(wasm|sandbox|isolated|gallery)\b/i, areas: ['wasm-agents', 'ruvllm-inference'], workflow: 'wasm' },
  { pattern: /\b(hook|pre.task|post.task|worker|daemon)\b/i, areas: ['hooks-automation', 'session-workflow'], workflow: 'automation' },
  { pattern: /\b(config|setup|init|provider|doctor)\b/i, areas: ['config-system'], workflow: 'setup' },
];

const WORKFLOW_TEMPLATES: Record<string, { steps: string[]; agents: string[]; topology: string }> = {
  bugfix: {
    steps: ['Research the bug (hooks route)', 'Reproduce with tests', 'Fix the code', 'Verify fix passes', 'Record outcome (hooks post-task)'],
    agents: ['researcher', 'coder', 'tester'],
    topology: 'hierarchical',
  },
  feature: {
    steps: ['Design architecture', 'Implement solution', 'Write tests', 'Review code', 'Record patterns (hooks post-task)'],
    agents: ['planner', 'coder', 'tester', 'reviewer'],
    topology: 'hierarchical',
  },
  refactor: {
    steps: ['Analyze code structure', 'Plan refactor approach', 'Implement changes', 'Verify no regressions'],
    agents: ['code-analyzer', 'coder', 'reviewer'],
    topology: 'hierarchical',
  },
  testing: {
    steps: ['Analyze coverage gaps', 'Generate test plan', 'Write tests', 'Verify coverage improvement'],
    agents: ['tester', 'coder'],
    topology: 'hierarchical',
  },
  security: {
    steps: ['Run security scan', 'Triage findings', 'Fix vulnerabilities', 'Verify remediations'],
    agents: ['v1-security-architect', 'coder', 'reviewer'],
    topology: 'hierarchical',
  },
  performance: {
    steps: ['Run benchmarks', 'Profile bottlenecks', 'Implement optimizations', 'Re-benchmark'],
    agents: ['v1-performance-engineer', 'coder'],
    topology: 'hierarchical',
  },
  memory: {
    steps: ['Initialize memory store', 'Store/retrieve patterns', 'Search with HNSW', 'Compact and optimize'],
    agents: ['v1-memory-specialist'],
    topology: 'hierarchical',
  },
  'github-pr': {
    steps: ['Analyze changes', 'Run code review swarm', 'Check CI status', 'Merge or request changes'],
    agents: ['pr-manager', 'code-review-swarm', 'reviewer'],
    topology: 'hierarchical',
  },
  release: {
    steps: ['Verify all tests pass', 'Generate changelog', 'Bump version', 'Publish packages', 'Create GitHub release'],
    agents: ['release-manager', 'tester'],
    topology: 'hierarchical',
  },
  swarm: {
    steps: ['Initialize swarm topology', 'Spawn specialized agents', 'Coordinate via memory', 'Collect and synthesize results'],
    agents: ['hierarchical-coordinator', 'coder', 'tester', 'reviewer'],
    topology: 'hierarchical',
  },
  learning: {
    steps: ['Pretrain on codebase', 'Record trajectories', 'Compute rewards', 'Distill learning', 'Consolidate (EWC++)'],
    agents: ['sona-learning-optimizer'],
    topology: 'hierarchical',
  },
  wasm: {
    steps: ['Check WASM availability', 'Create sandboxed agent', 'Execute tools in sandbox', 'Export results'],
    agents: [],
    topology: 'hierarchical',
  },
  automation: {
    steps: ['List available hooks/workers', 'Configure hook handlers', 'Dispatch workers', 'Monitor outcomes'],
    agents: [],
    topology: 'hierarchical',
  },
  setup: {
    steps: ['Run doctor diagnostics', 'Configure providers', 'Initialize memory', 'Start daemon'],
    agents: [],
    topology: 'hierarchical',
  },
};

// ── Dynamic Discovery ───────────────────────────────────────

function discoverAgents(): string[] {
  const agentsDir = join(PROJECT_ROOT, '.claude/agents');
  if (!existsSync(agentsDir)) return [];

  const agents: string[] = [];
  function walk(dir: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          walk(join(dir, entry.name));
        } else if (entry.name.endsWith('.md') && entry.name !== 'MIGRATION_SUMMARY.md') {
          const content = readFileSync(join(dir, entry.name), 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          if (nameMatch) agents.push(nameMatch[1].trim().replace(/^["']|["']$/g, ''));
        }
      }
    } catch { /* ignore */ }
  }
  walk(agentsDir);
  return [...new Set(agents)].sort();
}

function discoverSkills(): string[] {
  const skillsDir = join(PROJECT_ROOT, '.claude/skills');
  if (!existsSync(skillsDir)) return [];

  const skills: string[] = [];
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = join(skillsDir, entry.name, 'SKILL.md');
        if (existsSync(skillFile)) {
          skills.push(entry.name);
        }
      }
    }
  } catch { /* ignore */ }
  return skills.sort();
}

// ── MCP Tool Definitions ────────────────────────────────────

const guidanceCapabilities: MCPTool = {
  name: 'guidance_capabilities',
  description: 'List all capability areas with their tools, commands, agents, and skills. Use this to discover what Monobrain can do.',
  inputSchema: {
    type: 'object',
    properties: {
      area: {
        type: 'string',
        description: 'Filter to a specific area (e.g., "swarm-orchestration", "memory-knowledge"). Omit to list all areas.',
      },
      format: {
        type: 'string',
        enum: ['summary', 'detailed'],
        description: 'Output format. "summary" lists names and descriptions, "detailed" includes tools/agents/skills.',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const area = params.area as string | undefined;
    const format = (params.format as string) || 'summary';

    if (area) {
      const cap = CAPABILITY_CATALOG[area];
      if (!cap) {
        const available = Object.keys(CAPABILITY_CATALOG).join(', ');
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown area: ${area}`, available }, null, 2) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(cap, null, 2) }] };
    }

    if (format === 'detailed') {
      return { content: [{ type: 'text', text: JSON.stringify(CAPABILITY_CATALOG, null, 2) }] };
    }

    const summary = Object.entries(CAPABILITY_CATALOG).map(([key, val]) => ({
      area: key,
      name: val.name,
      description: val.description,
      toolCount: val.tools.length,
      agentCount: val.agents.length,
      skillCount: val.skills.length,
      whenToUse: val.whenToUse,
    }));

    return { content: [{ type: 'text', text: JSON.stringify({ areas: summary, totalAreas: summary.length }, null, 2) }] };
  },
};

const guidanceRecommend: MCPTool = {
  name: 'guidance_recommend',
  description: 'Given a task description, recommend which capability areas, tools, agents, and workflow to use.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Description of what you want to accomplish.',
      },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    const task = params.task as string;
    const matches: Array<{ area: string; capability: CapabilityArea; workflow: string; score: number }> = [];

    for (const route of TASK_ROUTES) {
      if (route.pattern.test(task)) {
        for (const areaKey of route.areas) {
          const cap = CAPABILITY_CATALOG[areaKey];
          if (cap) {
            matches.push({ area: areaKey, capability: cap, workflow: route.workflow, score: 1 });
          }
        }
      }
    }

    // Deduplicate by area, keeping highest score
    const seen = new Map<string, (typeof matches)[0]>();
    for (const m of matches) {
      const existing = seen.get(m.area);
      if (!existing || m.score > existing.score) {
        seen.set(m.area, m);
      }
    }

    const recommendations = [...seen.values()];

    if (recommendations.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            task,
            message: 'No specific pattern matched. Here are general-purpose capabilities:',
            suggestions: [
              { area: 'agent-management', reason: 'Spawn individual agents for targeted work' },
              { area: 'swarm-orchestration', reason: 'Use swarms for multi-file or complex tasks' },
              { area: 'hooks-automation', reason: 'Use hooks for task routing and learning' },
            ],
            tip: 'Use guidance_capabilities for a full list of all capability areas.',
          }, null, 2),
        }],
      };
    }

    const primaryWorkflow = recommendations[0]?.workflow;
    const template = primaryWorkflow ? WORKFLOW_TEMPLATES[primaryWorkflow] : undefined;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          task,
          recommendations: recommendations.map(r => ({
            area: r.area,
            name: r.capability.name,
            description: r.capability.description,
            tools: r.capability.tools,
            agents: r.capability.agents,
            skills: r.capability.skills,
          })),
          workflow: template ? {
            name: primaryWorkflow,
            steps: template.steps,
            agents: template.agents,
            topology: template.topology,
          } : undefined,
        }, null, 2),
      }],
    };
  },
};

const guidanceDiscover: MCPTool = {
  name: 'guidance_discover',
  description: 'Discover all available agents and skills from the .claude/ directory. Returns live filesystem data.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['agents', 'skills', 'all'],
        description: 'What to discover. Default: all.',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const type = (params.type as string) || 'all';

    const result: Record<string, unknown> = {};

    if (type === 'agents' || type === 'all') {
      const agents = discoverAgents();
      result.agents = { count: agents.length, names: agents };
    }

    if (type === 'skills' || type === 'all') {
      const skills = discoverSkills();
      result.skills = { count: skills.length, names: skills };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};

const guidanceWorkflow: MCPTool = {
  name: 'guidance_workflow',
  description: 'Get a recommended workflow template for a task type. Includes steps, agents, and topology.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: Object.keys(WORKFLOW_TEMPLATES),
        description: 'Workflow type. Options: ' + Object.keys(WORKFLOW_TEMPLATES).join(', '),
      },
    },
    required: ['type'],
  },
  handler: async (params: Record<string, unknown>) => {
    const type = params.type as string;
    const template = WORKFLOW_TEMPLATES[type];

    if (!template) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Unknown workflow: ${type}`,
            available: Object.keys(WORKFLOW_TEMPLATES),
          }, null, 2),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          workflow: type,
          ...template,
          swarmConfig: {
            topology: template.topology,
            maxAgents: Math.max(template.agents.length + 1, 4),
            strategy: 'specialized',
            consensus: 'raft',
          },
        }, null, 2),
      }],
    };
  },
};

const guidanceQuickRef: MCPTool = {
  name: 'guidance_quickref',
  description: 'Quick reference card for common operations. Returns the most useful commands for a given domain.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        enum: ['getting-started', 'daily-dev', 'swarm-ops', 'memory-ops', 'github-ops', 'diagnostics'],
        description: 'Domain to get quick reference for.',
      },
    },
    required: ['domain'],
  },
  handler: async (params: Record<string, unknown>) => {
    const domain = params.domain as string;

    const refs: Record<string, { title: string; commands: Array<{ cmd: string; desc: string }> }> = {
      'getting-started': {
        title: 'Getting Started',
        commands: [
          { cmd: 'npx monobrain@latest init --wizard', desc: 'Initialize project with interactive setup' },
          { cmd: 'npx monobrain@latest doctor --fix', desc: 'Run diagnostics and auto-fix issues' },
          { cmd: 'npx monobrain@latest daemon start', desc: 'Start background workers' },
          { cmd: 'npx monobrain@latest status', desc: 'Check system status' },
        ],
      },
      'daily-dev': {
        title: 'Daily Development',
        commands: [
          { cmd: 'npx monobrain@latest hooks pre-task --description "..."', desc: 'Get routing recommendation before task' },
          { cmd: 'npx monobrain@latest hooks post-task --task-id "..." --success true', desc: 'Record task outcome for learning' },
          { cmd: 'npx monobrain@latest hooks post-edit --file "..." --train-neural true', desc: 'Train patterns from edits' },
          { cmd: 'npx monobrain@latest memory search --query "..."', desc: 'Search memory for relevant patterns' },
          { cmd: 'npx monobrain@latest hooks route --task "..."', desc: 'Route task to optimal agent' },
        ],
      },
      'swarm-ops': {
        title: 'Swarm Operations',
        commands: [
          { cmd: 'npx monobrain@latest swarm init --topology hierarchical --max-agents 8', desc: 'Initialize anti-drift swarm' },
          { cmd: 'npx monobrain@latest swarm status', desc: 'Check swarm status' },
          { cmd: 'npx monobrain@latest agent spawn -t coder --name my-coder', desc: 'Spawn a specific agent' },
          { cmd: 'npx monobrain@latest hive-mind init --strategy byzantine', desc: 'Start hive-mind consensus' },
        ],
      },
      'memory-ops': {
        title: 'Memory Operations',
        commands: [
          { cmd: 'npx monobrain@latest memory init --force', desc: 'Initialize memory database' },
          { cmd: 'npx monobrain@latest memory store --key "k" --value "v" --namespace patterns', desc: 'Store a value' },
          { cmd: 'npx monobrain@latest memory search --query "auth patterns"', desc: 'Semantic vector search' },
          { cmd: 'npx monobrain@latest memory list --namespace patterns', desc: 'List entries in namespace' },
          { cmd: 'npx monobrain@latest memory retrieve --key "k" --namespace patterns', desc: 'Get a specific entry' },
        ],
      },
      'github-ops': {
        title: 'GitHub Operations',
        commands: [
          { cmd: 'Use pr-manager agent for PR lifecycle', desc: 'Spawn pr-manager for automated PR management' },
          { cmd: 'Use code-review-swarm agent for reviews', desc: 'Deploy multi-agent code review' },
          { cmd: 'Use release-manager agent for releases', desc: 'Automated release with changelog' },
          { cmd: 'Use issue-tracker agent for triage', desc: 'Intelligent issue management' },
        ],
      },
      diagnostics: {
        title: 'Diagnostics & Troubleshooting',
        commands: [
          { cmd: 'npx monobrain@latest doctor --fix', desc: 'Full system diagnostics with auto-fix' },
          { cmd: 'npx monobrain@latest status --watch', desc: 'Live system monitoring' },
          { cmd: 'npx monobrain@latest hooks worker status', desc: 'Background worker health' },
          { cmd: 'npx monobrain@latest performance benchmark --suite all', desc: 'Run all benchmarks' },
          { cmd: 'npx monobrain@latest hooks progress --detailed', desc: 'V1 implementation progress' },
        ],
      },
    };

    const ref = refs[domain];
    if (!ref) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown domain: ${domain}`, available: Object.keys(refs) }, null, 2) }], isError: true };
    }

    return { content: [{ type: 'text', text: JSON.stringify(ref, null, 2) }] };
  },
};

/**
 * All guidance tools
 */
export const guidanceTools: MCPTool[] = [
  guidanceCapabilities,
  guidanceRecommend,
  guidanceDiscover,
  guidanceWorkflow,
  guidanceQuickRef,
];

export default guidanceTools;

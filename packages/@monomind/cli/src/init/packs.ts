/**
 * What init ships, grouped into packs (GH #411).
 *
 * Claude Code lists every installed skill and command with its description in
 * a budget of about 1% of the context window (~8k chars on a 200k model), and
 * past it drops descriptions. Installing all 88 skills, 112 commands and 84
 * agents used ~39.5k chars of skill/command listing and ~13k of agent listing,
 * so most descriptions were never shown. `init` now installs the `core` pack;
 * the rest are opt-in: `init --packs a,b`, `init --all-packs`, the wizard, or
 * `monomind packs add <pack>` later.
 *
 * Core is what the everyday engineering loop uses. The 2026-09 value review
 * found 7 of 88 agents ever spawned in 702 transcripts; a scan of ~2,700
 * maintainer transcripts (2026-09-30) agrees: besides built-ins, spawns went
 * to coder, reviewer, researcher, Frontend Developer, Security Engineer,
 * tester, Technical Writer, Software Architect, Monodesign, Git Workflow
 * Master and DevOps Automator; the skills invoked were the mastermind
 * workflows (review, repeat, plan, execute, debug), monodesign,
 * agent-browser-testing and github-toolkit; the only slash commands were
 * /mastermind:review and /mastermind:do. Core also keeps every agent the
 * generated CLAUDE.md names as a fallback, every skill the platform adapters
 * always write (MASTERMIND_SKILLS) and every file core reads by path.
 *
 * Skills are skill directory names, commands and agents are paths relative to
 * `.claude/commands` / `.claude/agents` — a directory (everything in it) or a
 * single `.md` file. No name appears in two packs.
 */

export interface AssetPack {
  name: string;
  description: string;
  skills: readonly string[];
  commands: readonly string[];
  agents: readonly string[];
}

export const CORE_PACK: AssetPack = {
  name: 'core',
  description: 'Mastermind workflows, core dev agents, memory/GitHub/browser toolkits',
  skills: [
    'mastermind',
    'mastermind-idea',
    'mastermind-design',
    'mastermind-plan',
    'mastermind-execute',
    'mastermind-review',
    'mastermind-receive-review',
    'mastermind-debug',
    'mastermind-research',
    'mastermind-worktree',
    'mastermind-repeat',
    'mastermind-org',
    'mastermind-memory',
    // Shared pieces the workflows above read by path.
    'mastermind-protocol',
    'mastermind-intake',
    'mastermind-agent-select',
    'mastermind-delegation',
    'monolean',
    'monodesign',
    'monomotion',
    'stop-slop',
    'verification-quality',
    'hooks-automation',
    'memory-toolkit',
    'github-toolkit',
    'agent-browser-testing',
  ],
  commands: [
    'mastermind.md',
    'monobrowse.md',
    'tokens.md',
    'ts.md',
    'mastermind/do.md',
    'mastermind/review.md',
    'mastermind/plan.md',
    'mastermind/execute.md',
    'mastermind/debug.md',
    'mastermind/design.md',
    'mastermind/research.md',
    'mastermind/idea.md',
    'mastermind/worktree.md',
    'mastermind/receive-review.md',
    'mastermind/createtask.md',
    'mastermind/ideate.md',
    'mastermind/improve.md',
    'mastermind/repeat.md',
    'mastermind/help.md',
    'memory', // memory-search, which memory-toolkit links to
  ],
  agents: [
    'core',
    'architecture',
    'design',
    'schemas', // JSON output schemas, no agents
    'engineering/engineering-security-engineer.md',
    'engineering/engineering-frontend-developer.md',
    'engineering/engineering-software-architect.md',
    'engineering/engineering-technical-writer.md',
    'engineering/engineering-git-workflow-master.md',
    'engineering/engineering-devops-automator.md',
    'github/pr-manager.md',
    'github/issue-tracker.md',
    'github/release-manager.md',
    'github/monoswarm-code-review.md',
    'monoswarm/mesh-coordinator.md',
    'testing/testing-performance-benchmarker.md',
  ],
};

export const OPTIONAL_PACKS: readonly AssetPack[] = [
  {
    name: 'orgs',
    description: 'Agent orgs: create, run, stop, inspect; org tasks, goals, routines',
    skills: [
      'mastermind-createorg',
      'mastermind-runorg',
      'mastermind-stoporg',
      'mastermind-orgs',
      'mastermind-orgstatus',
      'mastermind-org-settings',
      'mastermind-agents',
      'mastermind-agent-detail',
      'mastermind-new-agent',
      'mastermind-budgets',
      'mastermind-approval-detail',
      'mastermind-inbox',
      'mastermind-activity',
      'mastermind-threads',
      'mastermind-bootstrap',
      'mastermind-issues',
      'mastermind-issue-detail',
      'mastermind-my-issues',
      'mastermind-tasks',
      'mastermind-plan-to-tasks',
      'mastermind-monotask',
      'mastermind-monitor',
      'mastermind-liveness',
      'mastermind-diagnose',
      'mastermind-goals',
      'mastermind-goal-detail',
      'mastermind-routines',
      'mastermind-routine-detail',
      'mastermind-skills',
      'mastermind-search',
    ],
    commands: [
      'mastermind/createorg.md',
      'mastermind/runorg.md',
      'mastermind/stoporg.md',
      'mastermind/orgs.md',
      'mastermind/orgstatus.md',
      'mastermind/budget.md',
      'mastermind/loops.md',
      'mastermind/memory.md',
      'mastermind/specialagents.md',
    ],
    agents: [],
  },
  {
    name: 'org-admin',
    description: 'Org admin bookkeeping: access, invites, plugins, adapters, secrets',
    skills: [
      'mastermind-access',
      'mastermind-invites',
      'mastermind-invite-landing',
      'mastermind-join-queue',
      'mastermind-plugins',
      'mastermind-plugin-manager',
      'mastermind-plugin-settings',
      'mastermind-adapters',
      'mastermind-adapter-manager',
      'mastermind-environments',
      'mastermind-env',
      'mastermind-secrets',
      'mastermind-backup',
      'mastermind-export',
      'mastermind-import',
      'mastermind-instance',
      'mastermind-profile',
      'mastermind-workspaces',
      'mastermind-workspace-detail',
      'mastermind-tree-control',
    ],
    commands: [],
    agents: [],
  },
  {
    name: 'swarm',
    description: 'Multi-agent: coordination, hooks and workflow commands; consensus agents',
    skills: [],
    commands: [
      'coordination',
      'automation',
      'stream-chain',
      'agents',
      'hooks',
      'analysis',
      'monitoring',
      'optimization',
      'workflows',
      'truth',
    ],
    agents: [
      'monoswarm/collective-intelligence-coordinator.md',
      'monoswarm/monoswarm-memory-manager.md',
      'monoswarm/scout-explorer.md',
      'monoswarm/worker-specialist.md',
      'consensus',
      'optimization',
      'templates',
      'goal',
    ],
  },
  {
    name: 'github',
    description: 'GitHub automation: repo architecture, multi-repo sync, boards, Actions',
    skills: [],
    commands: ['github'],
    agents: [
      'github/github-modes.md',
      'github/monoswarm-multi-repo.md',
      'github/project-board-sync.md',
      'github/repo-architect.md',
      'github/sync-coordinator.md',
      'github/workflow-automation.md',
    ],
  },
  {
    name: 'testing',
    description: 'QA agents: API, accessibility, evidence, test analysis, TDD',
    skills: [],
    commands: [],
    agents: [
      'testing/production-validator.md',
      'testing/tdd-london-monoswarm.md',
      'testing/testing-accessibility-auditor.md',
      'testing/testing-api-tester.md',
      'testing/testing-evidence-collector.md',
      'testing/testing-test-results-analyzer.md',
      'testing/testing-tool-evaluator.md',
      'testing/testing-workflow-optimizer.md',
    ],
  },
  {
    name: 'specialists',
    description: 'Specialist agents: data, SRE, mobile, embedded, Solidity, WeChat, Feishu',
    skills: [],
    commands: [],
    agents: [
      'engineering/engineering-ai-data-remediation-engineer.md',
      'engineering/engineering-ai-engineer.md',
      'engineering/engineering-autonomous-optimization-architect.md',
      'engineering/engineering-backend-architect.md',
      'engineering/engineering-database-optimizer.md',
      'engineering/engineering-data-engineer.md',
      'engineering/engineering-embedded-firmware-engineer.md',
      'engineering/engineering-feishu-integration-developer.md',
      'engineering/engineering-incident-response-commander.md',
      'engineering/engineering-mobile-app-builder.md',
      'engineering/engineering-rapid-prototyper.md',
      'engineering/engineering-senior-developer.md',
      'engineering/engineering-solidity-smart-contract-engineer.md',
      'engineering/engineering-sre.md',
      'engineering/engineering-threat-detection-engineer.md',
      'engineering/engineering-wechat-mini-program-developer.md',
      'specialized',
      'specialists',
    ],
  },
  {
    name: 'business',
    description: 'Marketing, sales, finance, content and ops workflows; marketing agents',
    skills: [],
    commands: [
      'mastermind/marketing.md',
      'mastermind/sales.md',
      'mastermind/finance.md',
      'mastermind/content.md',
      'mastermind/ops.md',
    ],
    agents: ['marketing'],
  },
  {
    name: 'extras',
    description: 'Pair programming, monograph, monolean audits, skill builders, jj',
    skills: [
      'pair-programming',
      'skill-builder',
      'specialagent',
      'monolean-audit',
      'monolean-debt',
      'monolean-help',
      'agentic-jujutsu',
      'performance-analysis',
      'mastermind-skill-builder',
      'mastermind-release',
      'mastermind-techport',
    ],
    commands: [
      'pair',
      'monograph',
      'mastermind/adr.md',
      'mastermind/brain.md',
      'mastermind/code-review.md',
      'mastermind/graph-status.md',
      'mastermind/master.md',
      'mastermind/okf-export.md',
      'mastermind/okf-import.md',
      'mastermind/release.md',
      'mastermind/skill-builder.md',
      'mastermind/techport.md',
      'mastermind/understand.md',
    ],
    agents: [],
  },
];

export const PACKS: readonly AssetPack[] = [CORE_PACK, ...OPTIONAL_PACKS];

/** Names of the opt-in packs, in display order. */
export const PACK_NAMES: readonly string[] = OPTIONAL_PACKS.map((p) => p.name);

export type AssetKind = 'skills' | 'commands' | 'agents';

/** Every entry of one kind across `packs`, de-duplicated, in order. */
export function packEntries(packs: readonly AssetPack[], kind: AssetKind): string[] {
  return [...new Set(packs.flatMap((p) => p[kind]))];
}

/** The top-level name an entry lives under (`mastermind/do.md` → `mastermind`). */
export function topLevel(entry: string): string {
  return entry.split('/')[0];
}

/**
 * Parse a `--packs a,b` value. `all` selects every pack; `core` is accepted
 * and ignored (it is always installed). Unknown names are an error.
 */
export function parsePackList(
  value: string,
): { ok: true; packs: string[] } | { ok: false; message: string } {
  const names = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.includes('all')) return { ok: true, packs: [...PACK_NAMES] };
  const unknown = names.filter((n) => n !== 'core' && !PACK_NAMES.includes(n));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Unknown pack: ${unknown.join(', ')} (available: ${PACK_NAMES.join(', ')})`,
    };
  }
  return { ok: true, packs: [...new Set(names.filter((n) => n !== 'core'))] };
}

/** The packs a run installs for one kind: every pack under `all`, else core
 *  (unless turned off) plus the opt-in packs in `options.packs`. */
export function selectedPacks(
  options: { packs?: readonly string[] } & Record<AssetKind, { core: boolean; all: boolean }>,
  kind: AssetKind,
): AssetPack[] {
  if (options[kind].all) return [...PACKS];
  return PACKS.filter((p) =>
    p === CORE_PACK ? options[kind].core : (options.packs ?? []).includes(p.name),
  );
}

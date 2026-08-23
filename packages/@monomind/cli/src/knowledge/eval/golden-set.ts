/**
 * The local golden set: query -> relevant document id pairs.
 *
 * CONSTRUCTION RULES (enforced by the harness, not just by good intentions):
 *  1. Every `relevant` id is a repo-relative path that must exist in the
 *     deterministic corpus. Unknown ids are a hard failure, never a silent skip.
 *  2. Queries are written in DIFFERENT vocabulary from the source document —
 *     the wording a person would use months later having forgotten the doc's
 *     own terms. Pairs whose query turns out to be near-verbatim in the target
 *     are removed automatically by `assessTriviality` and reported.
 *  3. Relevance is pinned to LIVE documents: the eval store is rebuilt from the
 *     corpus with exactly one ingest per document, so it contains no superseded
 *     versions at all. Deleting dead rows from the user's store (backlog item 4)
 *     therefore cannot move these numbers.
 *  4. Ambiguous targets are avoided. Where several near-identical documents
 *     could each legitimately answer, either the query is sharpened or all
 *     acceptable documents are listed in `relevant`.
 *
 * @module v1/cli/knowledge/eval/golden-set
 */

export interface GoldenPair {
  id: string;
  query: string;
  /** Repo-relative paths. A hit on ANY counts for hit-rate; recall uses all. */
  relevant: string[];
  /** Free-form grouping for slice reporting. */
  tags?: string[];
}

/**
 * v1 of the set. Authored 2026-07-28 by `benchmark-engineer` against documents
 * read at authoring time. Growing this set is ongoing work; the count is
 * reported honestly by the harness rather than padded with near-duplicates.
 */
export const GOLDEN_SET: GoldenPair[] = [
  // -- architecture / concepts --
  {
    id: 'hooks-dispatch',
    query:
      'which script receives the payload that the editor pipes in when a coding session begins',
    relevant: ['doc/concepts/hooks.md'],
    tags: ['architecture'],
  },
  {
    id: 'hooks-workers',
    query: 'background jobs that quietly refresh project metrics every few hours',
    relevant: ['doc/concepts/hooks.md'],
    tags: ['architecture'],
  },
  {
    id: 'memory-layers',
    query: 'the separate places this tool keeps what it has learned and why each exists',
    relevant: ['doc/concepts/memory.md'],
    tags: ['architecture'],
  },
  {
    id: 'memory-verbatim',
    query: 'storing exact passages so they can be quoted back word for word later',
    relevant: ['doc/concepts/memory.md'],
    tags: ['architecture'],
  },
  {
    id: 'org-roles-real',
    query: 'are the members of an autonomous company real live sessions or only pretend actors',
    relevant: ['doc/concepts/org-runtime.md'],
    tags: ['architecture'],
  },
  {
    id: 'org-human-loop',
    query: 'how a person gets asked to weigh in while the automated company keeps working',
    relevant: ['doc/concepts/org-runtime.md'],
    tags: ['architecture'],
  },
  {
    id: 'statusline-strip',
    query: 'the compact readout in the editor chrome showing branch health and context budget',
    relevant: ['doc/concepts/statusline.md'],
    tags: ['ux'],
  },
  {
    id: 'swarm-not-distributed',
    query: 'is the multi agent agreement mechanism spread over machines or all inside one process',
    relevant: ['doc/concepts/monoswarm.md'],
    tags: ['architecture'],
  },
  {
    id: 'swarm-shapes',
    query: 'choosing between a boss-and-reports arrangement versus everyone talking to everyone',
    relevant: ['doc/concepts/monoswarm.md'],
    tags: ['architecture'],
  },

  // -- decisions / ADRs --
  {
    id: 'adr-gates',
    query:
      'the four safety checks that stop an assistant from wiping a directory or leaking a credential',
    relevant: ['doc/adrs/ADR-G004-four-enforcement-gates.md'],
    tags: ['adr', 'security'],
  },
  {
    id: 'adr-teardown',
    query:
      'why the program refuses to quit cleanly once the machine learning runtime has been loaded',
    relevant: ['doc/adrs/ADR-R001-onnxruntime-process-teardown.md'],
    tags: ['adr'],
  },
  {
    id: 'adr-teardown-worker',
    query: 'when is it correct for a short lived child helper to force its own termination',
    relevant: ['doc/adrs/ADR-R001-onnxruntime-process-teardown.md'],
    tags: ['adr'],
  },
  {
    id: 'dashboard-single-truth',
    query:
      'redesign that made one append-only journal file the authority for what a company is doing',
    relevant: ['doc/adrs/org-dashboard-v2-design.md'],
    tags: ['adr'],
  },
  {
    id: 'dashboard-liveness',
    query: 'deciding whether a run is alive dead or idle from file modification times',
    relevant: ['doc/adrs/org-dashboard-v2-design.md'],
    tags: ['adr'],
  },

  // -- release / product narrative --
  {
    id: 'release-crossproject',
    query: 'the write-up announcing that saved knowledge became available across every project',
    relevant: ['doc/announcements/2026-07-18-v2.5-announcement.md'],
    tags: ['release'],
  },
  {
    id: 'cli-verb-roster',
    query: 'the exhaustive catalogue of top level verbs the binary will accept',
    relevant: ['doc/commands/cli-reference.md'],
    tags: ['reference'],
  },
  {
    id: 'mastermind-catalogue',
    query: 'complete listing of the slash shortcuts and what each one routes to',
    relevant: ['doc/commands/mastermind-reference.md'],
    tags: ['reference'],
  },
  {
    id: 'project-pitch',
    query: 'what does installing this actually add to my coding assistant',
    relevant: ['README.md'],
    tags: ['overview'],
  },

  // -- packages --
  {
    id: 'pkg-memory',
    query: 'the published module offering durable recall backends with similarity lookup',
    relevant: ['packages/@monomind/memory/README.md'],
    tags: ['package'],
  },
  {
    id: 'pkg-monofence',
    query:
      'standalone defence library that spots attempts to steer the assistant into unsafe behaviour',
    relevant: ['packages/monofence-ai/README.md'],
    tags: ['package', 'security'],
  },
  {
    id: 'pkg-mcp',
    query: 'framework for serving capabilities over websocket and http to a model client',
    relevant: ['packages/@monomind/mcp/README.md'],
    tags: ['package'],
  },
  {
    id: 'pkg-hooks-not-live',
    query:
      'the event registry package that explicitly is not the code path actually running in production',
    relevant: ['packages/@monomind/hooks/README.md'],
    tags: ['package'],
  },
  {
    id: 'pkg-cli',
    query: 'the module that contains the real command engine rather than the thin wrapper',
    relevant: ['packages/@monomind/cli/README.md'],
    tags: ['package'],
  },

  // -- process skills --
  {
    id: 'skill-worktree',
    query: 'getting a throwaway checkout so risky changes never touch the main working copy',
    relevant: ['.claude/skills/mastermind-worktree/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-debug',
    query: 'find the true cause before attempting any repair',
    relevant: ['.claude/skills/mastermind-debug/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-plan',
    query: 'writing the full step by step document with exact paths before touching any code',
    relevant: ['.claude/skills/mastermind-plan/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-execute',
    query: 'working through an already written implementation document task by task',
    relevant: ['.claude/skills/mastermind-execute/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-design',
    query: 'talking through what the user actually wants before building anything',
    relevant: ['.claude/skills/mastermind-design/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-builder',
    query: 'treating written procedure documents as something to red green refactor',
    relevant: ['.claude/skills/mastermind-skill-builder/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-receive-review',
    query: 'how to take critical feedback on your code without getting defensive',
    relevant: ['.claude/skills/mastermind-receive-review/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-plan-to-tasks',
    query: 'turning a prose roadmap into assigned tickets with the right dependency wiring',
    relevant: ['.claude/skills/mastermind-plan-to-tasks/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-diagnose',
    query:
      'forensic procedure for working out why the automated workers went quiet or looped forever',
    relevant: ['.claude/skills/mastermind-diagnose/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-liveness',
    query: 'guaranteeing no unfinished ticket is left with nothing that will ever move it forward',
    relevant: ['.claude/skills/mastermind-liveness/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-techport',
    query:
      'lifting a capability out of somebody else codebase and renaming it to our house conventions',
    relevant: ['.claude/skills/mastermind-techport/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-intake',
    query: 'asking the clarifying questions one at a time before dispatching work',
    relevant: ['.claude/skills/mastermind-intake/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-delegation',
    query: 'letting a spawned worker hand part of its job to a further specialist',
    relevant: ['.claude/skills/mastermind-delegation/SKILL.md'],
    tags: ['process'],
  },
  {
    id: 'skill-protocol',
    query: 'the shared contract every domain procedure follows when it spawns helpers',
    relevant: ['.claude/skills/mastermind-protocol/SKILL.md'],
    tags: ['process'],
  },

  // -- org / company management skills --
  {
    id: 'skill-createorg',
    query:
      'defining a new automated company with its roles and reporting lines and saving it to disk',
    relevant: ['.claude/skills/mastermind-createorg/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-bootstrap',
    query:
      'priming the chief agent once with context and a signed joining token before the first run',
    relevant: ['.claude/skills/mastermind-bootstrap/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-budgets',
    query: 'watching how fast each worker is burning its allowance and capping it',
    relevant: ['.claude/skills/mastermind-budgets/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-backup',
    query:
      'rolling every company state file into one dated compressed archive that can be restored',
    relevant: ['.claude/skills/mastermind-backup/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-invites',
    query:
      'handing out joining tokens and clearing the queue of people and bots asking to be let in',
    relevant: [
      '.claude/skills/mastermind-invites/SKILL.md',
      '.claude/skills/mastermind-join-queue/SKILL.md',
    ],
    tags: ['org'],
  },
  {
    id: 'skill-memory-para',
    query: 'filing durable company knowledge under projects areas resources and archives',
    relevant: ['.claude/skills/mastermind-memory/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-monitor',
    query:
      'a never ending watcher that claims incoming tickets from issue trackers and works them one at a time',
    relevant: ['.claude/skills/mastermind-monitor/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-inbox',
    query: 'one place showing everything waiting on a human across every company',
    relevant: ['.claude/skills/mastermind-inbox/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-export',
    query:
      'packing a whole company into a portable archive and unpacking it elsewhere with collision rules',
    relevant: [
      '.claude/skills/mastermind-export/SKILL.md',
      '.claude/skills/mastermind-import/SKILL.md',
    ],
    tags: ['org'],
  },
  {
    id: 'skill-adapters',
    query: 'plugging different model vendors into a company and turning them on or off',
    relevant: [
      '.claude/skills/mastermind-adapters/SKILL.md',
      '.claude/skills/mastermind-adapter-manager/SKILL.md',
    ],
    tags: ['org'],
  },
  {
    id: 'skill-environments',
    query: 'choosing whether the work runs on this machine over ssh or inside a sandbox',
    relevant: ['.claude/skills/mastermind-environments/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-secrets',
    query: 'where credentials for a company are kept and how they are handed to workers',
    relevant: ['.claude/skills/mastermind-secrets/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-routines',
    query: 'jobs that fire on a repeating clock without anyone starting them',
    relevant: [
      '.claude/skills/mastermind-routines/SKILL.md',
      '.claude/skills/mastermind-routine-detail/SKILL.md',
    ],
    tags: ['org'],
  },
  {
    id: 'skill-runorg',
    query: 'starting a saved company through the background daemon',
    relevant: ['.claude/skills/mastermind-runorg/SKILL.md'],
    tags: ['org'],
  },
  {
    id: 'skill-stoporg',
    query: 'bringing a running automated company to a halt',
    relevant: ['.claude/skills/mastermind-stoporg/SKILL.md'],
    tags: ['org'],
  },

  // -- domain skills --
  {
    id: 'skill-review-domain',
    query: 'several specialists inspecting the same change from different angles at once',
    relevant: ['.claude/skills/mastermind-review/SKILL.md'],
    tags: ['domain'],
  },
  {
    id: 'skill-idea',
    query: 'divergent brainstorming about products and pivots then narrowing to actionable pieces',
    relevant: ['.claude/skills/mastermind-idea/SKILL.md'],
    tags: ['domain'],
  },
  {
    id: 'skill-release',
    query: 'version numbering change logs and pushing a new build out',
    relevant: ['.claude/skills/mastermind-release/SKILL.md'],
    tags: ['domain'],
  },

  // -- tooling references --
  {
    id: 'ref-monotask',
    query: 'the kanban command line tool where a column field is called title and not name',
    relevant: ['.claude/skills/mastermind-monotask/SKILL.md'],
    tags: ['reference'],
  },
  {
    id: 'ref-monodoc',
    query:
      'grading prose against a well known search company style guide and measuring readability',
    relevant: ['.claude/skills/monodoc/SKILL.md'],
    tags: ['reference'],
  },
  {
    id: 'ref-browser-qa',
    query: 'staged interface quality passes driven through the chrome debugging protocol',
    relevant: ['.claude/skills/agent-browser-testing/SKILL.md'],
    tags: ['reference'],
  },
  {
    id: 'ref-image-gen',
    query: 'producing pictures through a browser session instead of paying for an api key',
    relevant: ['.claude/skills/monoagent-image/SKILL.md'],
    tags: ['reference'],
  },
  {
    id: 'ref-codex-map',
    query: 'translation table between our instructions and the openai terminal agent equivalents',
    relevant: ['.claude/commands/mastermind/references/codex-tools.md'],
    tags: ['reference'],
  },
  {
    id: 'ref-gemini-map',
    query: 'translation table for running the same procedures under google model tooling',
    relevant: ['.claude/commands/mastermind/references/gemini-tools.md'],
    tags: ['reference'],
  },
  {
    id: 'ref-copilot-map',
    query: 'equivalents when the harness is the github autocomplete assistant command line',
    relevant: ['.claude/commands/mastermind/references/copilot-tools.md'],
    tags: ['reference'],
  },
  {
    id: 'ref-agy-map',
    query: 'command mapping for the agy binary',
    relevant: ['.claude/commands/mastermind/references/antigravity-tools.md'],
    tags: ['reference'],
  },

  // -- animation --
  {
    id: 'anim-scroll',
    query: 'making elements move in response to how far down the page the reader has travelled',
    relevant: ['.claude/skills/monomotion/rules/scroll.md'],
    tags: ['animation'],
  },
  {
    id: 'anim-stagger',
    query: 'firing many elements one shortly after another rather than all together',
    relevant: ['.claude/skills/monomotion/rules/sequencing.md'],
    tags: ['animation'],
  },
  {
    id: 'anim-remote',
    query: 'driving a running timeline from an outside http request or socket message',
    relevant: ['.claude/skills/monomotion/rules/api-control.md'],
    tags: ['animation'],
  },
  {
    id: 'anim-vector',
    query: 'animating drawn paths and shapes rather than boxes of text',
    relevant: ['.claude/skills/monomotion/rules/svg.md'],
    tags: ['animation'],
  },
  {
    id: 'anim-presets',
    query: 'ready made motion recipes you can drop in without writing the tween yourself',
    relevant: ['.claude/skills/monomotion/rules/effects.md'],
    tags: ['animation'],
  },

  // -- persuasion / copy references --

  // -- agent definitions --
  {
    id: 'agent-pr',
    query: 'the worker that shepherds a change request through checks and gets it landed',
    relevant: [
      '.claude/agents/github/pr-manager.md',
      'packages/@monomind/cli/.claude/commands/github/pr-manager.md',
    ],
    tags: ['agents'],
  },
  {
    id: 'agent-release',
    query: 'coordinating version bumps across several packages and shipping them',
    relevant: [
      '.claude/agents/github/release-manager.md',
      'packages/@monomind/cli/.claude/commands/github/release-manager.md',
    ],
    tags: ['agents'],
  },
  {
    id: 'agent-issues',
    query: 'keeping tickets moving and reporting progress back to the team',
    relevant: [
      '.claude/agents/github/issue-tracker.md',
      'packages/@monomind/cli/.claude/commands/github/issue-tracker.md',
    ],
    tags: ['agents'],
  },
  {
    id: 'agent-repo-shape',
    query: 'restructuring how a repository is laid out and managing several of them together',
    relevant: ['.claude/agents/github/repo-architect.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-quorum',
    query: 'counting confidence weighted ballots and managing membership thresholds',
    relevant: ['.claude/agents/consensus/quorum-manager.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-mesh',
    query: 'peers that share state through common storage instead of reporting to a leader',
    relevant: ['.claude/agents/monoswarm/mesh-coordinator.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-collective',
    query: 'merging what many workers discovered into lasting shared knowledge',
    relevant: ['.claude/agents/monoswarm/collective-intelligence-coordinator.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-london',
    query: 'mock first testing specialist working inside a coordinated group',
    relevant: ['.claude/agents/testing/tdd-london-monoswarm.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-mobile',
    query: 'building phone applications that run on both apple and android from one codebase',
    relevant: ['.claude/agents/specialized/mobile/spec-mobile-react-native.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-mcp-builder',
    query: 'somebody who designs and tests servers that expose new capabilities to a model',
    relevant: ['.claude/agents/specialized/specialized-mcp-builder.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-security',
    query: 'threat modelling and secure code inspection for web and cloud native systems',
    relevant: ['.claude/agents/engineering/engineering-security-engineer.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-devops',
    query: 'automating build pipelines and cloud operations',
    relevant: ['.claude/agents/engineering/engineering-devops-automator.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-writer',
    query: 'turning dense engineering concepts into documentation developers will actually read',
    relevant: ['.claude/agents/engineering/engineering-technical-writer.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-backend',
    query: 'designing databases apis and server side systems that scale',
    relevant: ['.claude/agents/engineering/engineering-backend-architect.md'],
    tags: ['agents'],
  },
  {
    id: 'agent-goap',
    query: 'using game planning techniques to assemble actions into a route to a goal',
    relevant: ['.claude/agents/goal/goal-planner.md'],
    tags: ['agents'],
  },

  // -- house rules --
  {
    id: 'rules-batching',
    query: 'the instruction to put every independent operation into a single message',
    relevant: ['CLAUDE.md'],
    tags: ['rules'],
  },
  {
    id: 'rules-publish-order',
    query: 'why the wrapper must go out after the engine and which publisher command to use',
    relevant: ['CLAUDE.md'],
    tags: ['rules'],
  },
];

// ── Dev / test split ────────────────────────────────────────────────
// Sealed at construction time, deterministically, before any number existed.
//
// Why this exists: the same org authors the queries, writes the relevance
// labels, tunes the retrieval parameters and wants to reach a stop condition.
// Every ingredient of "tuned to the eval set" is present. The published
// worked example is MemPalace, whose LoCoMo figure moved 60.3 -> 88.9 by
// changing a scoring rule against the eval set, with a public repo and a
// committed methodology doc — more transparency than discipline alone buys.
//
// Rules, enforced in the harness rather than by good intentions:
//   - TEST never reports per-query results. If you can see which queries
//     failed you will fix those queries, and that requires no bad faith.
//   - The stop condition is evaluated on TEST only.
//   - Every TEST run is appended to a ledger. A TEST set run forty times with
//     tuning in between has become a dev set, and the count is the only way
//     anyone will notice.

import { createHash } from 'node:crypto';

export type Split = 'dev' | 'test';

/** Stable per-pair hash in [0,1). Depends only on the pair id, so adding or
 *  removing pairs never reshuffles the existing assignments. */
function pairHash(id: string): number {
  const h = createHash('sha256').update(`second-brain-split-v1::${id}`).digest();
  return h.readUInt32BE(0) / 0x100000000;
}

/** Share of pairs assigned to the sealed test split. */
export const TEST_SHARE = 0.3;

/** Identifies the assignment scheme. Bump this whenever assignment changes:
 *  numbers measured under different schemes are not comparable, and the
 *  regression suite uses this to say so instead of inventing a regression. */
export const SPLIT_SCHEME = 'hash-threshold-v2';

/**
 * Stratified 70/30 dev/test split, STABLE UNDER GROWTH.
 *
 * The assignment is a pure function of the pair's own id — `pairHash(id) <
 * TEST_SHARE` — so adding pairs never moves an existing pair between splits.
 *
 * The first version ranked pairs within their tag group and took the lowest
 * 30%, which gave an exact 70/30 per tag but was NOT stable: appending one
 * pair to a group re-ranked it and silently reassigned existing pairs. Growing
 * the set would have quietly moved queries out of the sealed half and into the
 * tunable one, which is the seal failing open — and it would have done so with
 * no visible symptom at all.
 *
 * Stratification survives because the hash is uniform and independent of the
 * tag, so each tag group lands near 30% on average rather than exactly. That
 * is the right trade: an approximate stratification that cannot leak beats an
 * exact one that can.
 */
export function assignSplits(pairs: GoldenPair[] = GOLDEN_SET): Map<string, Split> {
  const out = new Map<string, Split>();
  for (const p of pairs) out.set(p.id, pairHash(p.id) < TEST_SHARE ? 'test' : 'dev');
  return out;
}

export function pairsForSplit(
  split: Split | 'all',
  pairs: GoldenPair[] = GOLDEN_SET,
): GoldenPair[] {
  if (split === 'all') return pairs;
  const m = assignSplits(pairs);
  return pairs.filter((p) => m.get(p.id) === split);
}

// ── v2 expansion (2026-07-28) ──────────────────────────────────────
//
// 390 pairs authored across seven independent authors over the 422 documents the
// v1 set never touched. Every candidate was screened at AUTHORING time through
// the IDF-overlap metric rather than measured afterwards, because the v1 set
// became high-overlap dominated precisely by authoring first and measuring later.
//
// Target sets are expanded to include byte-identical and near-duplicate siblings
// (5-gram shingle containment >= 0.75): retrieving a true near-duplicate of the
// gold document IS retrieving the right content, and the expansion is computed
// from document content alone, so it cannot fit the set to any retriever.
//
// Authors were instructed to SKIP a document rather than write a weak query for
// it; between them they declined 32 documents as too ambiguous against a sibling.
// A missing query costs precision. A wrong relevance label silently corrupts
// every number the benchmark will ever produce.
GOLDEN_SET.push(
  {
    id: 'b0-impl-specialist',
    query:
      'which teammate persona is meant for turning a spec into working production code and tidying up existing modules',
    relevant: ['.claude/agents/core/coder.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-ml-into-product',
    query: 'who should i hand work that puts a trained model behind a live product feature',
    relevant: ['.claude/agents/engineering/engineering-ai-engineer.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-startup-shared-state',
    query:
      'setting up a group of helpers so every one of them is forced to post its progress into a common store before work is handed out',
    relevant: ['.claude/agents/templates/coordinator-monoswarm-init.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-loop-never-stops',
    query:
      'unattended repeat keeps going forever when studying another codebase because nothing is ever actually executed',
    relevant: ['.claude/commands/mastermind/techport.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-restore-brain-bundle',
    query:
      'pulling a previously saved knowledge package back into the local store without accidentally indexing its manifest file',
    relevant: ['.claude/commands/mastermind/okf-import.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-pi-harness',
    query: 'what do i do about task lists and spawned helpers when working inside pi',
    relevant: ['.claude/commands/mastermind/references/pi-tools.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-shrink-bottom-bar',
    query:
      'switch the info strip at the bottom of the terminal between the tall version and one row',
    relevant: ['.claude/commands/ts.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-hire-worker',
    query:
      'add another member to an existing company choosing its backend model who it answers to and its spending cap',
    relevant: ['.claude/skills/mastermind-new-agent/SKILL.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-checkout-inventory',
    query:
      'list every separate working copy in a company with what is running in it and tidy the idle ones',
    relevant: ['.claude/skills/mastermind-workspaces/SKILL.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-premerge-list',
    query:
      'gate to run through before landing changes that touch request handling or live event streams',
    relevant: ['.github/SECURITY_CHECKLIST.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-mental-effort',
    query:
      'how do i tell whether a screen is demanding too much thinking from the person using it and what to trim',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/cognitive-load.md',
      'packages/@monoes/monodesign/skill/reference/critique.md',
    ],
    tags: ['b0'],
  },
  {
    id: 'b0-real-world-data',
    query:
      'interface falls apart once names get long the text is translated or the connection drops',
    relevant: ['packages/@monoes/monodesign/skill/reference/harden.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-two-isolated-passes',
    query:
      'should whoever judges spacing and composition be allowed to see the detector output first',
    relevant: ['packages/@monoes/monodesign/skill/reference/layout.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-saved-critique-sample',
    query:
      'stored example of a page review output with a numeric total and blocking items listed by severity',
    relevant: [
      'packages/@monoes/monodesign/tests/fixtures/critique-snapshots/2026-05-01T10-00-00Z__home.md',
    ],
    tags: ['b0'],
  },
  {
    id: 'b0-warehouse-trust',
    query:
      'who keeps the nightly loading jobs reliable and catches silent corruption before analysts see it',
    relevant: ['packages/@monomind/cli/.claude/agents/engineering/engineering-data-engineer.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-throwaway-demo',
    query:
      'need someone to slap together a rough but working version in a couple of days just to see if the idea holds up',
    relevant: ['packages/@monomind/cli/.claude/agents/engineering/engineering-rapid-prototyper.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-recon-role',
    query:
      'the member whose only job is to wander unfamiliar ground and post everything it notices into shared storage as it goes',
    relevant: ['packages/@monomind/cli/.claude/agents/monoswarm/scout-explorer.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-what-to-charge',
    query:
      'help deciding plan levels whether to give something away for free and what unit to bill on',
    relevant: ['packages/@monomind/cli/.claude/agents/marketing/marketing-pricing-strategist.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-final-say-borrow',
    query:
      'who has the last word on whether something copied from another project gets taken as is reshaped or thrown out',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/critic-architect.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-pass-or-halt',
    query:
      'the checkpoint that gives finished work either a clean yes or a hard stop with evidence before commit',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/tester.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-many-language-servers',
    query:
      'specialist wiring several editor backends into one symbol map for instant jump to definition',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/lsp-index-engineer.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-auto-pick-helpers',
    query:
      'something that reads the request itself and decides how many helpers to create and with what skills',
    relevant: ['packages/@monomind/cli/.claude/agents/templates/automation-smart-agent.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-vendor-comparison',
    query: 'who compares competing products and works out real cost of ownership before we commit',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/testing-tool-evaluator.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-whats-slowing-down',
    query:
      'figure out which part of the system is dragging everything else down and how deep to look',
    relevant: ['packages/@monomind/cli/.claude/commands/analysis/bottleneck-detect.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-carry-context-over',
    query: 'keeping what was learned in one conversation available the next time i open the tool',
    relevant: ['packages/@monomind/cli/.claude/commands/automation/session-memory.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-spread-the-work',
    query:
      'hand one job to several workers either all at once one after another or feeding each others output',
    relevant: ['packages/@monomind/cli/.claude/commands/coordination/task-orchestrate.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-voting-scheme-setup',
    query:
      'flags for choosing the arrangement and the agreement rule when standing up a large collective',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/init.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-event-handler-list',
    query:
      'what gets triggered around each file change or shell run and what is written down from it',
    relevant: ['packages/@monomind/cli/.claude/commands/hooks/overview.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-saving-notes-index',
    query:
      'index of every subcommand for saving looking up exporting and clearing out stored notes',
    relevant: ['packages/@monomind/cli/.claude/commands/memory/README.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-sibling-tools-setup',
    query:
      'getting the kanban board the automation helper and the clipboard utility onto this machine',
    relevant: ['packages/@monomind/cli/.claude/commands/monoes/install.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-index-counts',
    query: 'quick numbers on what ended up in the code index and which topics scored highest',
    relevant: ['packages/@monomind/cli/.claude/commands/monograph/monograph-stats.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-who-holds-keyboard',
    query:
      'ways to split the typing between me and the assistant while working through something together',
    relevant: ['packages/@monomind/cli/.claude/commands/pair/modes.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-ready-recipes',
    query:
      'copy and paste starting points for a research team versus a build team including which roles to create',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/examples.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-saved-pipeline',
    query: 'kick off a saved multi stage run from a template then check on it and stop it',
    relevant: ['packages/@monomind/cli/.claude/commands/workflows/README.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-ticket-pileup',
    query:
      'work through a backlog of open tickets spotting near identical ones and the ones nobody has touched in a month',
    relevant: ['packages/@monomind/cli/.claude/skills/github-issue-triage/SKILL.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-capture-session-file',
    query:
      'keep a moving picture of what the automated browser did so a failure can be replayed later',
    relevant: [
      'packages/@monomind/cli/.claude/skills/monomind/browse-references/video-recording.md',
    ],
    tags: ['b0'],
  },
  {
    id: 'b0-narrow-the-roster',
    query:
      'narrowing a huge list of possible experts down to one by first choosing a field then a name',
    relevant: ['packages/@monomind/cli/.claude/skills/specialagent/SKILL.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-auto-revert-bad',
    query:
      'scoring how trustworthy an output is and automatically undoing anything that falls below the bar',
    relevant: ['packages/@monomind/cli/.claude/skills/verification-quality/SKILL.md'],
    tags: ['b0'],
  },
  {
    id: 'b0-windows-storage',
    query: 'why does the local database pick a different engine depending on the operating system',
    relevant: ['packages/@monomind/memory/docs/CROSS_PLATFORM.md'],
    tags: ['b0'],
  },
  {
    id: 'b1-lead-router',
    query:
      'who splits a big goal into smaller assignments picks the right worker for each and settles conflicting progress reports',
    relevant: ['.claude/agents/core/coordinator.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-mentor-review',
    query: 'we want feedback on changes that teaches something instead of nitpicking whitespace',
    relevant: ['.claude/agents/engineering/engineering-code-reviewer.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-front-door',
    query:
      'i typed a vague request and want the system to work out which of its many abilities fits then either run it or hand me exact steps',
    relevant: ['.claude/commands/mastermind.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-tiered-recall',
    query:
      'check how much accumulated knowledge each business area holds and squash the old stuff into shorter summaries',
    relevant: ['.claude/commands/mastermind/brain.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-spec-first-talk',
    query:
      'a guided back and forth to pin down what a feature should do and agree on it before anyone writes code',
    relevant: ['.claude/commands/mastermind/design.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-rough-suggestion',
    query:
      'turn a rough product suggestion into researched options judged with a product manager lens then split the winner into subtasks written to files',
    relevant: ['.claude/commands/mastermind/ideate.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-cut-version',
    query: 'entry point for cutting a new version bumping the changelog and pushing a deploy',
    relevant: ['.claude/commands/mastermind/ops.md', '.claude/commands/mastermind/release.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-author-capability',
    query:
      'write a new capability document for the assistant and confirm it actually fires before shipping it',
    relevant: ['.claude/commands/mastermind/skill-builder.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-shape-picker',
    query:
      'i cant decide whether my helpers should all talk to each other or report up to one boss',
    relevant: ['.claude/commands/mastermind/topology.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-who-can-do-what',
    query: 'control which people are allowed to create workers or wave newcomers into a company',
    relevant: ['.claude/skills/mastermind-access/SKILL.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-my-name-and-numbers',
    query: 'change my shown name and see how many items i finished and how much i spent',
    relevant: ['.claude/skills/mastermind-profile/SKILL.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-moving-page',
    query:
      'get elements gliding across the screen in a way i can scrub back and forth from code, no video file involved',
    relevant: ['.claude/skills/monomotion/SKILL.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-whats-new-history',
    query: 'the running list of what was added or altered in each numbered release',
    relevant: ['CHANGELOG.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-measurable-web-report',
    query:
      'check a live page against objective criteria and give back numbers plus a list of whats wrong, changing nothing',
    relevant: ['packages/@monoes/monodesign/skill/commands/audit.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-phone-app-grading',
    query:
      'grade a phone app for reachability and contrast straight from its source since there is no page to inspect',
    relevant: ['packages/@monoes/monodesign/skill/reference/audit.native.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-too-busy',
    query: 'the screen feels overloaded and i need to decide what to take away',
    relevant: ['packages/@monoes/monodesign/skill/commands/distill.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-first-visit',
    query:
      'get brand new users to something useful fast and stop blank screens from feeling broken',
    relevant: ['packages/@monoes/monodesign/skill/commands/onboard.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-flat-text',
    query: 'our words all sit at the same dull default and the sizes are too close to tell apart',
    relevant: ['packages/@monoes/monodesign/skill/commands/typeset.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-even-lightness',
    query:
      'choosing brand hues that stay perceptually even as they lighten and avoiding lifeless flat grey next to them',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/color-and-contrast.md',
      'packages/@monoes/monodesign/skill/reference/colorize.md',
    ],
    tags: ['b1'],
  },
  {
    id: 'b1-two-isolated-opinions',
    query:
      'why must two separate assessors run apart before their opinions get merged and what must be announced if only one ran',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/cognitive-load.md',
      'packages/@monoes/monodesign/skill/reference/critique.md',
      'packages/@monoes/monodesign/skill/reference/heuristics-scoring.md',
      'packages/@monoes/monodesign/skill/reference/personas.md',
    ],
    tags: ['b1'],
  },
  {
    id: 'b1-ten-principles',
    query:
      'a zero to four rubric for whether users always know what the system is doing and can undo mistakes',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/critique.md',
      'packages/@monoes/monodesign/skill/reference/heuristics-scoring.md',
    ],
    tags: ['b1'],
  },
  {
    id: 'b1-hot-swap-variants',
    query:
      'try several alternate looks for one piece of a running app and watch each appear instantly without restarting anything',
    relevant: ['packages/@monoes/monodesign/skill/reference/live.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-last-pass-ticks',
    query: 'what should i confirm one last time before calling a piece of front end work done',
    relevant: ['packages/@monoes/monodesign/skill/reference/pre-delivery-checklist.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-variable-layers',
    query:
      'how to stack the named values so swapping a theme means editing one middle layer instead of every component',
    relevant: ['packages/@monoes/monodesign/skill/reference/token-architecture.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-saved-review-example',
    query:
      'an example of the archived record a past interface review leaves behind, used as a test fixture',
    relevant: [
      'packages/@monoes/monodesign/tests/fixtures/critique-snapshots/2026-05-10T10-00-00Z__home.md',
    ],
    tags: ['b1'],
  },
  {
    id: 'b1-slow-lookup',
    query: 'who to ask when a lookup takes forever and i suspect the table is being scanned',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-database-optimizer.md',
    ],
    tags: ['b1'],
  },
  {
    id: 'b1-php-and-3d',
    query:
      'a builder specialising in php stack work with fancy stylesheets and three dimensional bits in the browser',
    relevant: ['packages/@monomind/cli/.claude/agents/engineering/engineering-senior-developer.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-across-projects',
    query:
      'drive helpers working across many separate code repositories in one organisation at the same time',
    relevant: ['packages/@monomind/cli/.claude/agents/github/monoswarm-multi-repo.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-shared-state-keeper',
    query:
      'the role responsible for keeping everyones shared knowledge in sync with layered caching and prefetching',
    relevant: ['packages/@monomind/cli/.claude/agents/monoswarm/monoswarm-memory-manager.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-speed-numbers',
    query:
      'measure throughput and response times repeatedly so a slowdown between versions gets caught automatically',
    relevant: ['packages/@monomind/cli/.claude/agents/optimization/benchmark-suite.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-version-control-owner',
    query:
      'the porting crew member who owns committing and branching and never writes straight to the trunk',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/git-manager.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-prove-who',
    query:
      'how can an autonomous program prove who it is, what it was permitted to do, and leave records nobody can quietly alter',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/agentic-identity-trust.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-quiet-exclusion',
    query:
      'catch the places our product quietly shuts people out, like a rigid two box name field for someone abroad',
    relevant: [
      'packages/@monomind/cli/.claude/agents/specialized/specialized-cultural-intelligence-strategist.md',
    ],
    tags: ['b1'],
  },
  {
    id: 'b1-no-placeholders-left',
    query:
      'confirm nothing fake or half written remains and everything really talks to live services before going live',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/production-validator.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-lean-six',
    query:
      'a specialist who maps how work flows today, finds where it jams, and redesigns it with lean thinking',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/testing-workflow-optimizer.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-why-was-it-slow',
    query:
      'after a job finishes what tells me it dragged because of processor load, too few helpers, or repeated file touching',
    relevant: ['packages/@monomind/cli/.claude/commands/analysis/performance-bottlenecks.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-auto-appear',
    query:
      'have the right helpers show up on their own based on what kind of file im touching instead of me picking each time',
    relevant: ['packages/@monomind/cli/.claude/commands/automation/smart-agents.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-index-of-helpers',
    query:
      'an index of the available helpers for tickets, merge requests and shipping, plus which underlying programs they really call',
    relevant: ['packages/@monomind/cli/.claude/commands/github/README.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-shared-kv-flags',
    query:
      'command line flags for putting a value under a name in the collective store and reading it back later',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/memory.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-log-change-outcome',
    query:
      'log whether a file change worked so the tool learns from it, fired automatically whenever something is written',
    relevant: ['packages/@monomind/cli/.claude/commands/hooks/post-edit.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-find-old-notes',
    query:
      'look up saved notes either by meaning or exact words with a cutoff on how close a match must be',
    relevant: ['packages/@monomind/cli/.claude/commands/memory/memory-search.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-renamed-binary',
    query:
      'which executable name is current for the go tool that drives social sites through a browser and why its own readme is misleading',
    relevant: ['packages/@monomind/cli/.claude/commands/monoes/monoagent.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-stay-fresh',
    query:
      'keep the code index current by itself while im still editing instead of me rerunning it',
    relevant: ['packages/@monomind/cli/.claude/commands/monograph/monograph-watch.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-two-of-us-coding',
    query:
      'how to run a working-side-by-side stretch from setup through wrap up and picking it back up tomorrow',
    relevant: ['packages/@monomind/cli/.claude/commands/pair/session.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-monthly-upkeep',
    query:
      'a step by step group routine for safely bumping libraries and doing the monthly vulnerability sweep',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/maintenance.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-prebuilt-stages',
    query:
      'a ready made staged pipeline that goes from planning to writing to checking to joining it all up',
    relevant: ['packages/@monomind/cli/.claude/commands/workflows/development.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-team-snapshot',
    query:
      'produce a shareable roundup of whats open and whats shipped lately to paste into the team chat',
    relevant: ['packages/@monomind/cli/.claude/skills/github-repo-recap/SKILL.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-shortest-thing',
    query: 'quit gold plating and hand me the smallest thing that does the job',
    relevant: ['packages/@monomind/cli/.claude/skills/monolean/SKILL.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-unread-chats',
    query:
      'catch up on what i missed in team conversations and dig up who mentioned something, using the already logged in browser instead of tokens',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse-slack.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-robotic-prose',
    query: 'strip the telltale machine phrasing and tired clichés out of a draft',
    relevant: ['packages/@monomind/cli/.claude/skills/stop-slop/SKILL.md'],
    tags: ['b1'],
  },
  {
    id: 'b1-wasm-fallback',
    query: 'what happens on a machine where the native compiled database module refuses to build',
    relevant: ['packages/@monomind/memory/docs/WINDOWS_SUPPORT.md'],
    tags: ['b1'],
  },
  {
    id: 'b2-planner-agent',
    query:
      'who breaks a big request into ordered pieces figures out what blocks what and estimates how long each takes',
    relevant: ['.claude/agents/core/planner.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-frontend-dev',
    query:
      'who should own the part users actually see in the browser and make it work on small screens too',
    relevant: ['.claude/agents/engineering/engineering-frontend-developer.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-shared-loop-snippet',
    query:
      'the common fragment other entry points pull in so repeated runs behave identically everywhere',
    relevant: ['.claude/commands/mastermind/_repeat.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-rerun-wrapper',
    query:
      'how do i make an arbitrary prompt run again on its own every fifteen minutes for ten rounds',
    relevant: ['.claude/commands/mastermind/repeat.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-work-through-list',
    query: 'burn down the queue of outstanding items with a handful of workers going in parallel',
    relevant: ['.claude/commands/mastermind/do.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-study-and-suggest',
    query:
      'take one area apart see how others handle it and leave behind a dated writeup of proposed changes',
    relevant: ['.claude/commands/mastermind/improve.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-list-saved-companies',
    query:
      'print each stored outfit with its cadence and the timestamps of the previous and upcoming firing',
    relevant: ['.claude/commands/mastermind/orgs.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-pick-persona',
    query:
      'browse the narrow role characters by grouping and switch one on or have it guess from context',
    relevant: ['.claude/commands/mastermind/specialagents.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-enrich-code-map',
    query:
      'have this chat write short descriptions and grouping labels into the prebuilt project index without paying for tokens elsewhere',
    relevant: ['.claude/commands/mastermind/understand.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-recent-events-feed',
    query:
      'give me a chronological trail of what changed recently across tickets initiatives and workers with who did it',
    relevant: ['.claude/skills/mastermind-activity/SKILL.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-machine-wide-limits',
    query:
      'where do i set caps that apply to the whole machine and the wake timer shared by every company',
    relevant: ['.claude/skills/mastermind-instance/SKILL.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-edit-company-config',
    query:
      'change one companys mission text spending allowance and cadence in its stored definition and dump it to a portable file',
    relevant: ['.claude/skills/mastermind-org-settings/SKILL.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-find-across-companies',
    query: 'hunt for a word anywhere in my records without knowing which company it belongs to',
    relevant: ['.claude/skills/mastermind-search/SKILL.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-card-columns',
    query: 'put a work item into a column hand it to a role and hang it under a bigger parent item',
    relevant: ['.claude/skills/mastermind-tasks/SKILL.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-embed-timeline',
    query:
      'put a scripted sequence on a bare page and let the surrounding document start and scrub it through a nested frame',
    relevant: ['.claude/skills/monomotion/rules/integration.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-local-dev-notes',
    query:
      'my personal setup notes for this checkout the shell variables i export and what the health command inspects',
    relevant: ['CLAUDE.local.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-codify-visual-conventions',
    query:
      'pull the visual conventions already present in the source into a written reference so later work stays consistent',
    relevant: ['packages/@monoes/monodesign/skill/commands/document.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-slow-page',
    query:
      'the page takes forever to paint and stutters while things move how do i fix that without making it uglier',
    relevant: ['packages/@monoes/monodesign/skill/commands/optimize.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-rework-for-phone',
    query:
      'we designed for a desk and now people use it standing up on a small handheld what has to be rethought',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/adapt.md',
      'packages/@monoes/monodesign/skill/reference/responsive-design.md',
    ],
    tags: ['b2'],
  },
  {
    id: 'b2-too-safe-looking',
    query:
      'nothing about this screen sticks in your head and every choice hedges what should i push harder on',
    relevant: ['packages/@monoes/monodesign/skill/reference/bolder.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-add-hues',
    query: 'we only use black white and one faint tint what is a principled way to bring in more',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/color-and-contrast.md',
      'packages/@monoes/monodesign/skill/reference/colorize.md',
    ],
    tags: ['b2'],
  },
  {
    id: 'b2-memorable-touches',
    query:
      'which moments deserve a little unexpected charm so users tell friends without the whole thing turning noisy',
    relevant: ['packages/@monoes/monodesign/skill/reference/delight.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-silence-auto-critique',
    query:
      'stop the automatic critique that fires in my editor every time i save a component and where is that setting stored',
    relevant: ['packages/@monoes/monodesign/skill/reference/hooks.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-how-long-transition',
    query:
      'our panels feel sluggish what timing numbers should i use and which shape of speed ramp fits something going away',
    relevant: ['packages/@monoes/monodesign/skill/reference/motion-design.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-tool-ui-rules',
    query:
      'what changes when the surface is a working instrument people sit in all day rather than a marketing page',
    relevant: ['packages/@monoes/monodesign/skill/reference/product.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-flat-text',
    query: 'the words on the page all feel the same size and shape with no voice of their own',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/typeset.md',
      'packages/@monoes/monodesign/skill/reference/typography.md',
    ],
    tags: ['b2'],
  },
  {
    id: 'b2-structure-decisions',
    query:
      'the role that makes the big shape calls weighs alternatives and leaves a record of why with boxes and arrows',
    relevant: [
      'packages/@monomind/cli/.claude/agents/architecture/system-design/arch-system-design.md',
    ],
    tags: ['b2'],
  },
  {
    id: 'b2-tiny-chip-code',
    query:
      'expert for code running on a tiny chip with kilobytes of ram where a lockup means a dead product in the field',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-embedded-firmware-engineer.md',
    ],
    tags: ['b2'],
  },
  {
    id: 'b2-onchain-money',
    query:
      'who do i ask about programs deployed to a public ledger where a bug means stolen money and every operation is billed',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-solidity-smart-contract-engineer.md',
    ],
    tags: ['b2'],
  },
  {
    id: 'b2-kanban-mirror',
    query:
      'keep the cards on the hosted planning board in step with what the workers are really doing',
    relevant: ['packages/@monomind/cli/.claude/agents/github/project-board-sync.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-drone-executor',
    query:
      'the lowest tier helper that only carries out what it is handed and constantly posts where it is up to',
    relevant: ['packages/@monomind/cli/.claude/agents/monoswarm/worker-specialist.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-idle-vs-swamped',
    query:
      'when some helpers sit idle while others are buried let the idle ones grab jobs off the busy queues',
    relevant: ['packages/@monomind/cli/.claude/agents/optimization/load-balancer.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-clean-slate-thinking',
    query:
      'the counterpart who asks what we would make if we began again instead of faithfully copying the original',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/idea-generator.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-spec-to-ship-pipeline',
    query:
      'one lead that walks a request from paper through building and checking until it is ready to release',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/agents-orchestrator.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-community-champion',
    query:
      'the role that makes it easier for outsiders to get started and feeds their frustrations back to product',
    relevant: [
      'packages/@monomind/cli/.claude/agents/specialized/specialized-developer-advocate.md',
    ],
    tags: ['b2'],
  },
  {
    id: 'b2-blind-user-check',
    query:
      'make sure someone who cannot see the screen can still finish the flow instead of just clearing an automated checker',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/testing-accessibility-auditor.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-who-is-good-at-what',
    query:
      'a small table of which worker type is strongest at what plus the terminal call to print them',
    relevant: ['packages/@monomind/cli/.claude/commands/agents/agent-capabilities.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-numbers-summary',
    query:
      'print a speed and resource summary for the past week and emit it in a shape a scraping monitor can ingest',
    relevant: ['packages/@monomind/cli/.claude/commands/analysis/performance-report.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-auto-pick-helpers',
    query:
      'let the system decide by itself which helpers to launch purely from the sentence describing my job',
    relevant: ['packages/@monomind/cli/.claude/commands/automation/smart-spawn.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-repo-preset-modes',
    query:
      'what are the preset ways of plugging into a code hosting site for merge requests tickets and shipping versions',
    relevant: [
      '.claude/agents/github/github-modes.md',
      'packages/@monomind/cli/.claude/commands/github/github-modes.md',
    ],
    tags: ['b2'],
  },
  {
    id: 'b2-add-drones-flags',
    query:
      'command line switches to add five more drones to the colony or start the leader session with a stated objective',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/spawn.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-log-finish',
    query: 'record that a job wrapped up and how well it went so the pattern learner picks it up',
    relevant: ['packages/@monomind/cli/.claude/commands/hooks/post-task.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-watch-health',
    query:
      'which terminal calls give me a refreshing view of what is alive right now and how often it succeeds',
    relevant: ['packages/@monomind/cli/.claude/commands/monitoring/README.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-copy-history-cli',
    query: 'script my paste history for that little tray app on the mac from a shell',
    relevant: ['packages/@monomind/cli/.claude/commands/monoes/monoclip.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-index-written-material',
    query: 'make prose and bound files findable in the graph rather than functions and imports',
    relevant: ['packages/@monomind/cli/.claude/commands/monograph/monograph-wiki.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-stepwise-context-chain',
    query:
      'canned multi step flows where each stage receives the previous stages output as its input for review or cleanup work',
    relevant: ['packages/@monomind/cli/.claude/commands/stream-chain/pipeline.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-speed-hunting-group',
    query:
      'stand up a peer group of helpers whose whole purpose is profiling for slow spots and fixing them together',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/optimization.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-gather-compare-conclude',
    query:
      'a canned team flow for gathering sources weighing them against each other and writing up conclusions',
    relevant: ['packages/@monomind/cli/.claude/commands/workflows/research.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-leader-led-group-decisions',
    query:
      'explain the boss led arrangement how a group verdict gets reached and where the common recollection is kept',
    relevant: ['packages/@monomind/cli/.claude/skills/monoswarm/SKILL.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-remote-browser-amazon',
    query:
      'point the page driver at a rented cloud machine using the login i already configured for that big cloud provider',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse-agentcore.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-throwaway-vm-chrome',
    query:
      'spin up a short lived machine to click around a site from inside a serverless deployment',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse-vercel.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-rewrite-samples',
    query:
      'paired samples showing prose before and after cutting the wind up phrases and theatrical one word sentences',
    relevant: ['packages/@monomind/cli/.claude/skills/stop-slop/references/examples.md'],
    tags: ['b2'],
  },
  {
    id: 'b2-testsuite-layout',
    query:
      'what does the automated check suite for the terminal tool cover and how are its files divided up',
    relevant: ['packages/@monomind/cli/__tests__/README.md'],
    tags: ['b2'],
  },
  {
    id: 'b3-investigator-role',
    query:
      'which worker profile ends its job with a written writeup of evidence and recommendations instead of any code change',
    relevant: ['.claude/agents/core/researcher.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-tradeoff-owner',
    query:
      'who picks between one big service and many small ones and writes down why the call was made',
    relevant: ['.claude/agents/engineering/engineering-software-architect.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-workitem-layout',
    query:
      'one shared description of the layout every generated planning document must follow so each command does not invent its own',
    relevant: ['.claude/commands/mastermind/_taskfile.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-repeated-critique-loop',
    query:
      'run several critics in parallel over my recent changes for a few rounds fixing what is safe and parking the judgement calls in a dated file',
    relevant: ['.claude/commands/mastermind/code-review.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-campaign-entrypoint',
    query:
      'entry point for copywriting seo and social campaign work that checks with me before acting unless told otherwise',
    relevant: [
      '.claude/commands/mastermind/content.md',
      '.claude/commands/mastermind/finance.md',
      '.claude/commands/mastermind/marketing.md',
      '.claude/commands/mastermind/sales.md',
    ],
    tags: ['b3'],
  },
  {
    id: 'b3-single-company-health',
    query:
      'inspect one saved company in detail including when it last woke up and how long until the next cycle',
    relevant: ['.claude/commands/mastermind/orgstatus.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-kill-recurring-loop',
    query:
      'make a recurring background company quit cleanly so the next scheduled wakeup does nothing and never reschedules',
    relevant: ['.claude/commands/mastermind/stoporg.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-single-hire-inspect',
    query:
      'pull up one hired worker inside a company to see its settings recent runs and last check in and wipe it back to defaults',
    relevant: ['.claude/skills/mastermind-agent-detail/SKILL.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-redeem-join-link',
    query:
      'someone sent me a share link to join their company how do i redeem it either as a person or by attaching a bot',
    relevant: ['.claude/skills/mastermind-invite-landing/SKILL.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-list-all-companies',
    query: 'show every company i have set up in one table with whether each is halted or ticking',
    relevant: ['.claude/skills/mastermind-orgs/SKILL.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-who-can-use-what',
    query:
      'find out which capability documents exist on disk and which roles are permitted to reach each one',
    relevant: ['.claude/skills/mastermind-skills/SKILL.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-ticket-discussion',
    query: 'read and post back and forth messages attached to a ticket inside a company',
    relevant: ['.claude/skills/mastermind-threads/SKILL.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-letters-fly-in',
    query:
      'make a headline reveal one letter at a time and have a number roll up to its final value',
    relevant: ['.claude/skills/monomotion/rules/text.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-visual-front-door',
    query:
      'the top level router document that lists every visual sub workflow and the phrases that trigger it',
    relevant: ['packages/@monoes/monodesign/skill/SKILL.src.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-confusing-labels',
    query:
      'people cannot tell what our menu items do and our failure messages do not say what to try next fix the wording and grouping without redoing the visuals',
    relevant: ['packages/@monoes/monodesign/skill/commands/clarify.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-mine-existing-rules',
    query:
      'we never wrote our visual rules down pull out the ones already implied by the stylesheets we have and write them up formally',
    relevant: ['packages/@monoes/monodesign/skill/commands/extract.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-show-off-effects',
    query:
      'i want the front end to feel technically ostentatious with physics driven motion and cinematic screen changes that make people go whoa',
    relevant: ['packages/@monoes/monodesign/skill/commands/overdrive.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-tablet-stretch',
    query:
      'our phone app just gets scaled up on a bigger screen and looks wrong what should be restructured for the larger form factor',
    relevant: ['packages/@monoes/monodesign/skill/reference/adapt.native.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-identity-to-variables',
    query:
      'how does the written identity document flow down into variables so that changing the identity does not mean touching every component',
    relevant: ['packages/@monoes/monodesign/skill/reference/brand-workflow.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-control-anatomy',
    query:
      'canonical sizing table and full state list for the everyday interface controls so nothing is left unspecified',
    relevant: ['packages/@monoes/monodesign/skill/reference/component-specs.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-house-laws',
    query:
      'the fixed aesthetic laws that outrank whatever a client asks for including allowing a single vibrant hue',
    relevant: ['packages/@monoes/monodesign/skill/reference/design-principles.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-not-stock-photo',
    query:
      'how should i word a request to a picture generator so the output does not look machine made or like a catalog shot',
    relevant: ['packages/@monoes/monodesign/skill/reference/image-prompts.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-first-value-fast',
    query:
      'what should a first run experience prioritise so somebody reaches the convincing moment fast',
    relevant: ['packages/@monoes/monodesign/skill/reference/onboard.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-tone-it-down',
    query: 'make a visually noisy screen feel restrained and expensive rather than shouty',
    relevant: ['packages/@monoes/monodesign/skill/reference/quieter.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-how-many-sizes',
    query:
      'guidance on choosing few enough type steps with a big enough jump between them and how wide a column should get',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/typeset.md',
      'packages/@monoes/monodesign/skill/reference/typography.md',
    ],
    tags: ['b3'],
  },
  {
    id: 'b3-merge-without-conflict',
    query:
      'specialist for reconciling the same data edited on several replicas at once so every copy converges without a referee',
    relevant: ['packages/@monomind/cli/.claude/agents/monoswarm/monoswarm-memory-manager.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-lark-platform',
    query:
      'our client runs everything internally on a chinese workplace platform and we need our product wired into it',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-feishu-integration-developer.md',
    ],
    tags: ['b3'],
  },
  {
    id: 'b3-uptime-owner',
    query:
      'who sets availability targets tracks how much failure we can afford and cuts repetitive manual ops work',
    relevant: ['packages/@monomind/cli/.claude/agents/engineering/engineering-sre.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-ticket-to-workers',
    query:
      'turn a filed bug report on the hosting platform into split up assignments for several workers and post progress back as comments',
    relevant: ['packages/@monomind/cli/.claude/agents/github/monoswarm-issue.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-versus-pages',
    query:
      'who writes the us against them pages and the best replacements for X pages that catch buyers while they are still deciding',
    relevant: ['packages/@monomind/cli/.claude/agents/marketing/marketing-competitive-content.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-live-numbers-watcher',
    query:
      'which specialist continuously samples runtime numbers and raises a flag when something drifts outside expected behaviour',
    relevant: ['packages/@monomind/cli/.claude/agents/optimization/performance-monitor.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-one-card-at-a-time',
    query:
      'the builder role that works through porting instructions one card at a time and refuses to widen what was asked',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/implementer.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-should-we-automate',
    query:
      'who decides whether a business process is even worth making hands free and what must stay under a persons control',
    relevant: [
      'packages/@monomind/cli/.claude/agents/specialized/automation-governance-architect.md',
    ],
    tags: ['b3'],
  },
  {
    id: 'b3-decks-and-sheets',
    query: 'producing polished business files like slide sets and workbooks straight from code',
    relevant: [
      'packages/@monomind/cli/.claude/agents/specialized/specialized-document-generator.md',
    ],
    tags: ['b3'],
  },
  {
    id: 'b3-hammer-endpoints',
    query:
      'specialist who hammers our service endpoints for contract breakage load limits and security holes before customers find them',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/testing-api-tester.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-what-did-i-spend',
    query:
      'command line way to see what my model calls cost today and over the past month plus a live updating view',
    relevant: ['packages/@monomind/cli/.claude/commands/analysis/token-usage.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-canned-recipe-run',
    query:
      'execute one of the prebuilt multi step recipes by name and optionally see what it would do first without doing it',
    relevant: ['packages/@monomind/cli/.claude/commands/automation/workflow-select.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-tidy-many-repos',
    query:
      'reorganize a codebase layout and keep several separate checkouts consistent with each other using coordinated helpers',
    relevant: ['packages/@monomind/cli/.claude/commands/github/repo-architect.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-queen-and-drones',
    query:
      'see the leader and its subordinate pool with vote round counts refreshing on screen as things change',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/status.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-warn-before-touching',
    query:
      'what runs just ahead of a file being changed to surface likely fallout and suggest who should handle it',
    relevant: ['packages/@monomind/cli/.claude/commands/hooks/pre-edit.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-agent-scorecard',
    query:
      'per worker scorecard of how many jobs finished and what fraction succeeded over the last week',
    relevant: ['packages/@monomind/cli/.claude/commands/monitoring/agent-metrics.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-rust-cards-tool',
    query:
      'driving the rust command line card wall where everything is stored offline in a local database and a container must exist before any board',
    relevant: ['packages/@monomind/cli/.claude/commands/monoes/monotask.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-let-it-choose-shape',
    query:
      'i do not want to hand pick how many helpers or how they are arranged let the difficulty of the request decide it for me',
    relevant: ['packages/@monomind/cli/.claude/commands/optimization/auto-topology.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-feed-output-forward',
    query:
      'i want my own ordered sequence where later stages automatically inherit everything the earlier stages produced',
    relevant: ['packages/@monomind/cli/.claude/commands/stream-chain/run.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-parallel-peer-digging',
    query:
      'fan out a group of peers with no leader to gather sources on a topic in parallel and merge what they find into one synthesis',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/research.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-save-for-reuse',
    query:
      'i just ran a good multi stage sequence how do i store it under a name so i can replay it on future jobs',
    relevant: ['packages/@monomind/cli/.claude/commands/workflows/workflow-create.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-fire-around-operations',
    query:
      'machinery that fires automatically around every operation to tidy files keep state across restarts and learn from what worked',
    relevant: ['packages/@monomind/cli/.claude/skills/hooks-automation/SKILL.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-drive-desktop-app',
    query:
      'automate a native looking program on my machine that is really a packaged web app by attaching over its debug port',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse-electron.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-cheap-page-clicking',
    query:
      'click through a live web page while spending as few tokens as possible using handles for elements and grouping steps into one call',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-cut-the-filler',
    query:
      'catalogue of throat clearing openers and corporate cliches to strike out of any prose we produce',
    relevant: ['packages/@monomind/cli/.claude/skills/stop-slop/references/phrases.md'],
    tags: ['b3'],
  },
  {
    id: 'b3-where-settings-found',
    query:
      'which places are searched for the settings file at startup and what happens when it is absent or malformed',
    relevant: ['packages/@monomind/cli/docs/CONFIG_LOADING.md'],
    tags: ['b3'],
  },
  {
    id: 'b4-single-reviewer-agent',
    query:
      'i want one helper whose only job is going over finished work and listing every problem it finds ranked by how bad it is with a suggested fix',
    relevant: ['.claude/agents/core/reviewer.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-multi-angle-pr-review',
    query:
      'split a pull request across several specialists each looking at a different concern and have them post their verdicts back onto the ticket automatically',
    relevant: ['.claude/agents/github/monoswarm-code-review.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-capture-past-choices',
    query:
      'turn the choices we settled on over the past week of conversation into a formal written record with context and consequences',
    relevant: ['.claude/commands/mastermind/adr.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-blog-newsletter-entry',
    query:
      'entry point for getting articles threads and newsletters written by a manager who runs them through drafting and editing',
    relevant: [
      '.claude/commands/mastermind/content.md',
      '.claude/commands/mastermind/finance.md',
      '.claude/commands/mastermind/marketing.md',
      '.claude/commands/mastermind/sales.md',
    ],
    tags: ['b4'],
  },
  {
    id: 'b4-money-tasks-entry',
    query:
      'which command hands invoicing spend tracking and forecasting to a dedicated money specialist',
    relevant: [
      '.claude/commands/mastermind/content.md',
      '.claude/commands/mastermind/finance.md',
      '.claude/commands/mastermind/marketing.md',
      '.claude/commands/mastermind/sales.md',
    ],
    tags: ['b4'],
  },
  {
    id: 'b4-single-front-door',
    query:
      'where does an incoming request land first so it gets handed to the correct helper, and what stops the assistant from quietly deciding to bypass that step',
    relevant: ['.claude/commands/mastermind/master.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-write-build-strategy',
    query:
      'produce a detailed written build strategy from requirements and save it under the docs folder before touching any code',
    relevant: ['.claude/commands/mastermind/plan.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-fix-without-asking',
    query:
      'after it finds issues i want it to just repair the obvious ones itself instead of asking me each time',
    relevant: ['.claude/commands/mastermind/research.md', '.claude/commands/mastermind/review.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-shape-choice-table',
    query:
      'when would i want the workers arranged in a circle passing work along versus all reporting to one leader',
    relevant: ['.claude/commands/mastermind/monoswarm.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-isolated-checkout',
    query:
      'set up a separate copy of the repo so new feature work does not disturb what im currently editing',
    relevant: ['.claude/commands/mastermind/worktree.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-rank-from-catalog',
    query:
      'reusable shell snippet that reads the local catalog of hundreds of specialist types and scores them against the wording of the request instead of hardcoding names',
    relevant: ['.claude/skills/mastermind-agent-select/SKILL.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-runtime-config-audit',
    query:
      'check whether the model provider storage token signing and log settings are actually filled in for a company or still missing',
    relevant: ['.claude/skills/mastermind-env/SKILL.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-one-ticket-deep',
    query:
      'open a single work item and see its whole conversation past attempts attached files and children then reassign or close it',
    relevant: ['.claude/skills/mastermind-issue-detail/SKILL.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-next-iteration-eta',
    query:
      'how long until the next automatic wake up for one particular company and is its cycle still healthy',
    relevant: ['.claude/skills/mastermind-orgstatus/SKILL.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-pause-runaway-branch',
    query:
      'put a runaway chain of work on ice without killing it permanently and make sure there is always a way to let it go again',
    relevant: ['.claude/skills/mastermind-tree-control/SKILL.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-repro-form',
    query:
      'the form that asks a person what they expected to happen versus what actually happened plus which handset and browser version',
    relevant: ['.github/ISSUE_TEMPLATE/bug_report.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-cut-plates-from-mock',
    query:
      'carve reusable picture files out of an approved mockup without reinventing the look and strip out anything the stylesheet should draw instead',
    relevant: ['packages/@monoes/monodesign/skill/agents/monodesign-asset-producer.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-tinted-neutrals',
    query:
      'never use pure black or white and lean every grey slightly toward the house hue then verify readability',
    relevant: ['packages/@monoes/monodesign/skill/commands/colorize.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-keyboard-reachable',
    query:
      'make sure a person using only the tab key can reach everything with a visible ring and nothing depends on color alone',
    relevant: ['packages/@monoes/monodesign/skill/commands/harden.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-last-detail-pass',
    query:
      'final sweep for the tiny things: drifting gaps one off widgets that ignore the shared library and inconsistent wording',
    relevant: ['packages/@monoes/monodesign/skill/commands/polish.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-not-an-iphone-clone',
    query:
      'how do i keep a build for the green robot handsets from feeling like a port of the fruit company version, including honoring its own return behaviour and bar cutouts',
    relevant: ['packages/@monoes/monodesign/skill/reference/android.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-visuals-are-the-product',
    query:
      'a site whose only job is to leave someone with a feeling rather than let them complete a task, where playing it safe counts as failing',
    relevant: ['packages/@monoes/monodesign/skill/reference/brand.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-which-look-wins',
    query:
      'if a control is both pointed at and switched off at the same time which appearance should win',
    relevant: ['packages/@monoes/monodesign/skill/reference/component-states.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-too-much-on-screen',
    query:
      'the screen feels cluttered and busy help me cut it back to the one thing people actually came to do',
    relevant: ['packages/@monoes/monodesign/skill/reference/distill.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-first-run-crawl',
    query:
      'which step do i run before all the others so they each have a written statement of who this is for and how it ought to appear',
    relevant: ['packages/@monoes/monodesign/skill/reference/init.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-find-real-bottleneck',
    query:
      'figure out which part of a screen is genuinely costing the user time, with numbers taken before and after, instead of guessing at improvements',
    relevant: ['packages/@monoes/monodesign/skill/reference/optimize.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-touch-vs-mouse',
    query:
      'how to tell whether someone is using a finger or a trackpad rather than guessing from window width and how to keep content clear of the cutout',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/adapt.md',
      'packages/@monoes/monodesign/skill/reference/responsive-design.md',
    ],
    tags: ['b4'],
  },
  {
    id: 'b4-talk-to-users',
    query:
      'how many people to sit with for a think aloud session and how to write an audience profile that cites real conversations instead of being invented',
    relevant: ['packages/@monoes/monodesign/skill/reference/ux-research.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-lying-voters',
    query:
      'protecting an agreement protocol from participants that lie flood or impersonate, using signing power split across many parties',
    relevant: ['packages/@monomind/cli/.claude/agents/consensus/security-manager.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-tidy-history',
    query:
      'keep the change log of the repo readable with small self contained commits sensible branch naming and untangling conflicts',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-git-workflow-master.md',
    ],
    tags: ['b4'],
  },
  {
    id: 'b4-noisy-alerts',
    query:
      'write and tune the rules that spot intruders after they slip past prevention so the operations desk stops ignoring the alarms',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-threat-detection-engineer.md',
    ],
    tags: ['b4'],
  },
  {
    id: 'b4-team-from-pr-body',
    query:
      'spin up the worker group directly from what someone wrote in the merge request and drive it further by leaving comments there',
    relevant: ['packages/@monomind/cli/.claude/agents/github/monoswarm-pr.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-visitors-dont-sign-up',
    query:
      'plenty of people reach the page but almost nobody signs up, find where they hesitate and rank what to change first',
    relevant: ['packages/@monomind/cli/.claude/agents/marketing/marketing-cro-specialist.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-forecast-capacity',
    query:
      'work out ahead of time how much processing and storage the load will need and hand it out before things get tight',
    relevant: ['packages/@monomind/cli/.claude/agents/optimization/resource-allocator.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-precise-task-cards',
    query:
      'convert approved keep or rework judgements into exact per file instruction cards so the person building makes no design calls of their own',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/integration-planner.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-onchain-money-holes',
    query:
      'assume the on chain money code is broken and hunt for the way somebody drains it with a borrowed pile of funds',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/blockchain-security-auditor.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-recheck-someone-model',
    query:
      'independently rebuild and rerun a prediction system somebody else built to see if its probabilities still line up and the inputs have not shifted',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/specialized-model-qa.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-pictures-or-it-didnt',
    query:
      'a checker that refuses to believe a clean report and demands pictures for every claim because first attempts always have several problems',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/testing-evidence-collector.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-coordination-doesnt-run',
    query:
      'reminder that the coordination calls do not actually run anything and that all the workers must be launched together in one go',
    relevant: ['packages/@monomind/cli/.claude/commands/agents/agent-spawning.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-selfheal-index',
    query:
      'index page pointing to notes on picking helpers by file type recovering from errors on its own and keeping context between sittings',
    relevant: ['packages/@monomind/cli/.claude/commands/automation/README.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-versions-across-repos',
    query:
      'make sure every bundle in a group stays lined up at the same number when shipping, docs included, so nothing lands mismatched',
    relevant: ['packages/@monomind/cli/.claude/commands/github/sync-coordinator.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-wind-down-keep-state',
    query:
      'wind the whole collective down cleanly and keep what it knew so a later sitting can refer back to it',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/stop.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-announce-before-start',
    query:
      'tell the system what im about to work on and get back who should handle it how hard it looks and what might go wrong',
    relevant: ['packages/@monomind/cli/.claude/commands/hooks/pre-task.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-whos-busy-table',
    query:
      'table listing each running worker what its handling right now how long its been alive and its pass rate',
    relevant: ['packages/@monomind/cli/.claude/commands/monitoring/agents.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-index-docs-and-pdfs',
    query:
      'index listing the ways to pull code prose and pdfs into one searchable web of relationships and keep it fresh as files change',
    relevant: ['packages/@monomind/cli/.claude/commands/monograph/README.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-tune-and-preview',
    query:
      'command line switches to tune footprint processing or response delay with the option to see what it would change first',
    relevant: ['packages/@monomind/cli/.claude/commands/optimization/performance-optimize.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-canned-pipeline',
    query:
      'run a prepackaged multi stage recipe by name or from your own yaml file with a validate only switch',
    relevant: ['packages/@monomind/cli/.claude/commands/workflows/workflow-execute.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-what-can-i-delete',
    query:
      'go through the entire tree and rank what could just be thrown away or swapped for something the language already ships, ignoring correctness bugs',
    relevant: ['packages/@monomind/cli/.claude/skills/monolean-audit/SKILL.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-poke-around-live-site',
    query:
      'wander through a running site clicking things to find problems and capture step by step pictures proving each one',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse-qa.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-take-turns-typing',
    query:
      'work alongside me taking turns at who types and who watches with continuous checking and the option to undo when quality drops',
    relevant: ['packages/@monomind/cli/.claude/skills/pair-programming/SKILL.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-stop-fake-drama',
    query:
      'stop writing sentences that set up a false contrast then flip it, and stop the one word fragments meant to sound profound',
    relevant: ['packages/@monomind/cli/.claude/skills/stop-slop/references/structures.md'],
    tags: ['b4'],
  },
  {
    id: 'b4-thin-command-layer',
    query:
      'how a terminal subcommand should stay display only and route through a wrapper to where the real logic actually lives',
    relevant: ['packages/@monomind/cli/docs/MCP_CLIENT_GUIDE.md'],
    tags: ['b4'],
  },
  {
    id: 'b5-qa-role-card',
    query:
      'which roster entry is responsible for proving odd inputs behave and that nothing already working broke',
    relevant: ['.claude/agents/core/tester.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-repo-workflow-personas',
    query:
      'what preset operating personas exist for driving merge requests and repository chores with batched calls',
    relevant: [
      '.claude/agents/github/github-modes.md',
      'packages/@monomind/cli/.claude/commands/github/github-modes.md',
    ],
    tags: ['b5'],
  },
  {
    id: 'b5-standing-team-setup',
    query:
      'how do i write down a lasting crew of assistants with duties and a chain of command so the background service can launch it later',
    relevant: ['.claude/commands/mastermind/createorg.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-cross-session-notes-cli',
    query:
      'what are all the ways to save recall and prune notes that survive between conversations with similarity lookup',
    relevant: ['.claude/commands/mastermind/memory.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-payroll-listing',
    query:
      'see everyone currently working inside a live team with how much they are burning and put one of them on hold',
    relevant: ['.claude/skills/mastermind-agents/SKILL.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-single-objective-drill',
    query:
      'zoom in on a single target to see what sits under it and what work is attached then edit or retire it',
    relevant: ['.claude/skills/mastermind-goal-detail/SKILL.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-ticket-board-ops',
    query:
      'file a new ticket on the team board and search the whole board by who owns it or what state it is in',
    relevant: ['.claude/skills/mastermind-issues/SKILL.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-extension-install-lifecycle',
    query:
      'pull an add on down from the package registry and later tear it out with a double confirmation step',
    relevant: ['.claude/skills/mastermind-plugin-manager/SKILL.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-keep-going-postamble',
    query:
      'make work continue across sessions until it is genuinely done with guardrails against talking yourself into quitting early',
    relevant: ['.claude/skills/mastermind-repeat/SKILL.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-proposal-form',
    query:
      'the fill in the blanks form for suggesting a new capability including what alternatives you weighed',
    relevant: ['.github/ISSUE_TEMPLATE/feature_request.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-inline-copy-writeback',
    query:
      'the helper that takes text tweaks a person accepted in the live preview and writes them back into real source',
    relevant: ['packages/@monoes/monodesign/skill/agents/monodesign-manual-edit-applier.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-motion-restraint',
    query:
      'our transitions feel gratuitous which ones are worth keeping and roughly how long should they last',
    relevant: ['packages/@monoes/monodesign/skill/reference/animate.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-confusing-wording',
    query: 'the words on our screens are woolly and people abandon partway how do we rewrite them',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/clarify.md',
      'packages/@monoes/monodesign/skill/reference/ux-writing.md',
    ],
    tags: ['b5'],
  },
  {
    id: 'b5-reusable-widget-library',
    query:
      'build a reusable set of ui pieces where nothing is hard coded and every value points at a named variable',
    relevant: ['packages/@monoes/monodesign/skill/reference/component-system.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-visual-spec-file',
    query:
      'write down a projects existing look in a fixed six part layout that later helpers must not reorder',
    relevant: ['packages/@monoes/monodesign/skill/reference/document.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-button-conditions',
    query:
      'every appearance a clickable thing needs handled including the one only keyboard people ever see',
    relevant: ['packages/@monoes/monodesign/skill/reference/interaction-design.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-push-past-normal',
    query:
      'make one part of the app feel jaw dropping without it looking ridiculous for what the page is for',
    relevant: ['packages/@monoes/monodesign/skill/reference/overdrive.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-think-before-code',
    query:
      'stop the habit of jumping straight to a card grid and instead figure out user intent up front',
    relevant: ['packages/@monoes/monodesign/skill/reference/shape.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-interface-fault-checklist',
    query:
      'a long ranked checklist of concrete screen faults to run through when reviewing an existing build',
    relevant: ['packages/@monoes/monodesign/skill/reference/ux-rules.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-fix-bad-records-inflight',
    query:
      'who patches malformed records mid stream using a model that runs on our own machines without halting the flow',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-ai-data-remediation-engineer.md',
    ],
    tags: ['b5'],
  },
  {
    id: 'b5-outage-lead',
    query:
      'who takes charge when live systems break at 3am and later runs the no blame retrospective',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-incident-response-commander.md',
    ],
    tags: ['b5'],
  },
  {
    id: 'b5-china-messaging-apps',
    query:
      'building small embedded apps inside chinas dominant chat platform with its own markup and payment hooks',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-wechat-mini-program-developer.md',
    ],
    tags: ['b5'],
  },
  {
    id: 'b5-keep-repos-aligned',
    query:
      'keep release numbers and shared libraries in step across several code repositories at once',
    relevant: ['packages/@monomind/cli/.claude/agents/github/sync-coordinator.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-drip-sequences',
    query:
      'who drafts the automated message ladders that greet new signups win back quiet ones and pitch strangers',
    relevant: ['packages/@monomind/cli/.claude/agents/marketing/marketing-email-specialist.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-rewire-agent-layout',
    query:
      'the group of workers is talking inefficiently who rearranges how they connect to each other on the fly',
    relevant: ['packages/@monomind/cli/.claude/agents/optimization/topology-optimizer.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-catalog-foreign-project',
    query:
      'read through somebody elses open codebase and catalog each module its public surface and whether anything is truly original',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/source-analyst.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-certification-prep',
    query: 'an outside firm is coming to certify us next quarter who preps the paperwork trail',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/compliance-auditor.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-map-every-branch',
    query:
      'chart the whole decision tree of a product upfront so builders and testers both have something concrete',
    relevant: [
      'packages/@monomind/cli/.claude/agents/specialized/specialized-workflow-architect.md',
    ],
    tags: ['b5'],
  },
  {
    id: 'b5-prove-speedup',
    query:
      'who checks whether the app holds up when lots of people hit it and reports the delta after changes',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/testing-performance-benchmarker.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-worker-kind-roster',
    query: 'where is the full list of every kind of helper i am allowed to ask for',
    relevant: ['packages/@monomind/cli/.claude/commands/agents/agent-types.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-wrap-up-and-save',
    query:
      'close out what im doing now and keep a summary plus enough state that i can pick it back up tomorrow',
    relevant: ['packages/@monomind/cli/.claude/commands/hooks/session-end.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-one-glance-health',
    query:
      'one command that shows me overall health of everything at once and can keep refreshing on screen',
    relevant: ['packages/@monomind/cli/.claude/commands/monitoring/status.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-reindex-code-map',
    query:
      'refresh the searchable map of the repo from zero also covering written material not just source',
    relevant: ['packages/@monomind/cli/.claude/commands/monograph/monograph-build.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-take-turns-coding',
    query:
      'working side by side with the assistant taking turns at the wheel while the other watches and critiques',
    relevant: ['packages/@monomind/cli/.claude/commands/pair/README.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-fan-out-inspection',
    query:
      'spread an inspection of the source across several peer helpers at once looking for slowness and holes',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/analysis.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-parallel-checks',
    query:
      'split verification work across several helpers so unit level and full journey checks run at the same time',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/testing.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-prebuilt-pipelines',
    query:
      'what canned multi stage pipelines ship out of the box and how do i confirm my own yaml file is well formed',
    relevant: ['packages/@monomind/cli/.claude/commands/workflows/workflow-export.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-shortcut-ledger',
    query:
      'gather every place we deliberately cut a corner and noted it in a comment so later does not become never',
    relevant: ['packages/@monomind/cli/.claude/skills/monolean-debt/SKILL.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-reuse-signed-in-session',
    query:
      'my scripted browsing keeps hitting the sign in wall how do i borrow credentials from a window im already logged into',
    relevant: [
      'packages/@monomind/cli/.claude/skills/monomind/browse-references/authentication.md',
    ],
    tags: ['b5'],
  },
  {
    id: 'b5-find-coordination-slowdown',
    query:
      'figure out where a group of cooperating helpers is losing time and get concrete suggestions to fix it',
    relevant: ['packages/@monomind/cli/.claude/skills/performance-analysis/SKILL.md'],
    tags: ['b5'],
  },
  {
    id: 'b5-arrangement-tradeoffs',
    query:
      'when should a group of helpers be arranged peer to peer versus led from the top with example wiring code',
    relevant: ['packages/@monomind/cli/.claude/skills/monoswarm/SKILL.md'],
    tags: ['b5'],
  },
  {
    id: 'b6-one-design-agent',
    query: 'we used to have eight different helpers for look and feel who handles all of that now',
    relevant: ['.claude/agents/design/design-monodesign.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-cross-package-glue',
    query:
      'who keeps the separate modules in this repo from drifting apart when one of them changes its interface',
    relevant: ['.claude/agents/specialists/integration-architect.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-spec-to-workitems',
    query:
      'chop a long requirements write up into separate numbered chunks of work i can hand off one by one',
    relevant: ['.claude/commands/mastermind/createtask.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-cheatsheet',
    query:
      'i forgot what slash entry points exist show me a one page overview of everything available',
    relevant: ['.claude/commands/mastermind/help.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-portable-knowledge',
    query:
      'package up everything stored in my notes system so it can be carried to another machine',
    relevant: ['.claude/commands/mastermind/okf-export.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-instructions-file-location',
    query:
      'where does the assistant look for its persistent project instructions and what does dispatch a helper actually map to',
    relevant: ['.claude/commands/mastermind/references/claude-code-tools.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-spend-dashboard',
    query: 'see how much i burned this week and how many calls it took',
    relevant: ['.claude/commands/tokens.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-single-permission-request',
    query:
      'a helper is waiting on my sign off for one specific thing let me look at it and bounce it back for rework',
    relevant: ['.claude/skills/mastermind-approval-detail/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-nested-objectives',
    query: 'track nested objectives with success measures in a tree for a bot company',
    relevant: ['.claude/skills/mastermind-goals/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-my-queue',
    query: 'show only the tickets on my plate and let me grab an unclaimed one',
    relevant: ['.claude/skills/mastermind-my-issues/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-extension-folder-access',
    query:
      'let an installed add on touch one directory on disk and see whether it is still responding',
    relevant: ['.claude/skills/mastermind-plugin-settings/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-market-intel',
    query: 'spin up helpers to size a market and study what rivals are charging',
    relevant: ['.claude/skills/mastermind-research/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-runtime-sandbox',
    query:
      'inspect the isolated place a helper actually executes code in, its background services, and its startup and shutdown scripts',
    relevant: ['.claude/skills/mastermind-workspace-detail/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-pr-boxes',
    query: 'what boxes do i have to tick before opening a change request in this repo',
    relevant: ['.github/PULL_REQUEST_TEMPLATE.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-same-product-new-audience',
    query:
      'the same screen now has to serve a different country language direction and a far more expert crowd',
    relevant: ['packages/@monoes/monodesign/skill/commands/adapt.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-blunt-director-review',
    query:
      'blunt senior level teardown of a screen saved so repeat passes on the same target show whether it improved',
    relevant: ['packages/@monoes/monodesign/skill/commands/critique.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-two-isolated-structure-passes',
    query:
      'the page feels flat and evenly weighted i want both an automated scan and a separate blind opinion on its bones',
    relevant: ['packages/@monoes/monodesign/skill/commands/layout.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-interview-before-code',
    query:
      'ask me questions in rounds first and hand back a written plan document rather than building anything',
    relevant: ['packages/@monoes/monodesign/skill/commands/shape.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-machine-made-tells',
    query:
      'the complete list of giveaways that nobody made real choices, each with what to look for and the remedy',
    relevant: ['packages/@monoes/monodesign/skill/reference/antipatterns-catalog.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-picture-capable-harness',
    query:
      'when the tool can render real artwork what order do the approval pauses go in before code starts',
    relevant: ['packages/@monoes/monodesign/skill/reference/codex.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-persuasion-acronyms',
    query: 'classic marketing acronyms for structuring persuasive on screen text',
    relevant: ['packages/@monoes/monodesign/skill/reference/copy-formulas.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-repeated-button',
    query:
      'the same widget is copy pasted across several screens along with raw colour values how do we consolidate',
    relevant: ['packages/@monoes/monodesign/skill/reference/extract.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-apple-native-rules',
    query:
      'our handheld screens were ported straight from the website which platform conventions are we breaking on iphones',
    relevant: ['packages/@monoes/monodesign/skill/reference/ios.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-archetype-walkthrough',
    query:
      'pretend to be five very different kinds of visitor and note what breaks for each of them',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/critique.md',
      'packages/@monoes/monodesign/skill/reference/personas.md',
    ],
    tags: ['b6'],
  },
  {
    id: 'b6-four-or-eight-step',
    query:
      'should my whitespace steps be multiples of four or eight and how do i check importance ordering by blurring',
    relevant: ['packages/@monoes/monodesign/skill/reference/spatial-design.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-button-wording',
    query:
      'our confirm controls all say ok and yes what should they say and how do we phrase failures without blaming people',
    relevant: [
      'packages/@monoes/monodesign/skill/reference/clarify.md',
      'packages/@monoes/monodesign/skill/reference/ux-writing.md',
    ],
    tags: ['b6'],
  },
  {
    id: 'b6-shadow-trial-cost-guard',
    query:
      'quietly try a challenger engine in the background against live requests with a hard stop so it cannot run up the bill',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-autonomous-optimization-architect.md',
    ],
    tags: ['b6'],
  },
  {
    id: 'b6-phone-app-builder',
    query: 'who owns building the handheld version of the product for both stores',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-mobile-app-builder.md',
    ],
    tags: ['b6'],
  },
  {
    id: 'b6-ci-pipeline-agents',
    query:
      'have coordinated helpers plug into the automated checks that run whenever someone pushes',
    relevant: ['packages/@monomind/cli/.claude/agents/github/workflow-automation.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-announcement-sequence',
    query: 'how to stage the run up buzz and the day of push when we make something public',
    relevant: ['packages/@monomind/cli/.claude/agents/marketing/marketing-launch-strategist.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-porting-loop-driver',
    query:
      'who hands out batches to the specialists each pass and decides when the whole effort is finished',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/boss.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-where-would-it-attach',
    query: 'figure out what our own side already covers and where a borrowed feature would hook in',
    relevant: ['packages/@monomind/cli/.claude/agents/reengineer-squad/target-analyst.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-same-customer',
    query: 'several helpers must agree that two rows describe the same company or person',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/identity-graph-operator.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-slipbox',
    query:
      'keep a growing web of small self contained cards joined by links rather than a folder tree',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/zk-steward.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-suite-output-trends',
    query: 'make sense of piles of raw check output and tell me where problems keep clustering',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/testing-test-results-analyzer.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-slow-and-spendy-index',
    query:
      'index page pointing to both the slowdown hunting entry points and the consumption reduction guidance',
    relevant: ['packages/@monomind/cli/.claude/commands/analysis/README.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-auto-recover',
    query: 'when a command blows up because a package is missing just install it and try again',
    relevant: ['packages/@monomind/cli/.claude/commands/automation/self-healing.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-group-start-flags',
    query:
      'command line switches for starting a worker group including the legacy fifteen worker mode',
    relevant: ['packages/@monomind/cli/.claude/commands/coordination/monoswarm-init.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-put-to-vote',
    query: 'let the group decide on a change by ballot and check where the count stands',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/consensus.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-callback-catalog',
    query: 'one page listing all the before and after triggers i can run from the terminal',
    relevant: ['packages/@monomind/cli/.claude/commands/hooks/README.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-register-callbacks',
    query: 'wire these triggers into the config file so the editor fires them by itself',
    relevant: ['packages/@monomind/cli/.claude/commands/hooks/setup.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-sibling-tools',
    query: 'the neighbouring projects that are not part of this repo and how you install each one',
    relevant: ['packages/@monomind/cli/.claude/commands/monoes/README.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-index-lookup-modes',
    query:
      'search the prebuilt code index by concept instead of literal terms and narrow it to one kind of symbol',
    relevant: ['packages/@monomind/cli/.claude/commands/monograph/monograph-search.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-session-transcripts',
    query:
      'sample worked sessions showing exactly what to say while hunting a leak or reviewing together',
    relevant: ['packages/@monomind/cli/.claude/commands/pair/examples.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-feature-roles',
    query:
      'staffing plan for shipping one capability end to end from whoever plans it to whoever validates it',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/development.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-honest-health-picture',
    query:
      'give me a straight answer on whether everything is behaving right now across the moving parts',
    relevant: ['packages/@monomind/cli/.claude/commands/truth/start.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-lockfree-vcs',
    query:
      'history tracking built for many simultaneous writers instead of one person at a keyboard',
    relevant: ['packages/@monomind/cli/.claude/skills/agentic-jujutsu/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-simplicity-levels',
    query: 'remind me of the intensity levels for keep it simple mode and how to switch it off',
    relevant: ['packages/@monomind/cli/.claude/skills/monolean-help/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-page-said-obey',
    query:
      'a website told the assistant to run a command and mail out the cookie file should it comply',
    relevant: [
      'packages/@monomind/cli/.claude/skills/monomind/browse-references/trust-boundaries.md',
    ],
    tags: ['b6'],
  },
  {
    id: 'b6-authoring-capability-file',
    query:
      'spec for authoring a new reusable instruction package so it gets discovered automatically',
    relevant: ['packages/@monomind/cli/.claude/skills/skill-builder/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-programmatic-peers',
    query:
      'code level calls to start several equal workers and spread tasks over them automatically',
    relevant: ['packages/@monomind/cli/.claude/skills/monoswarm/SKILL.md'],
    tags: ['b6'],
  },
  {
    id: 'b6-what-replaced-neural',
    query:
      'after the learned engine was stripped out what picks a specialist now and where did the training code end up',
    relevant: ['packages/@monomind/cli/src/monovector/README.md'],
    tags: ['b6'],
  },

  // ── v3 expansion (2026-07-28, batch b7) ─────────────────────────────
  //
  // 158 pairs authored blind to passage content (title + path only).
  // Targets low-overlap stratum to fill the 80-query TEST minimum.
  // All IDs use b7- prefix; duplicate coverage paths removed.

  // -- packages/@monomind/cli/.claude/commands/mastermind/* (batch 1) --
  {
    id: 'b7-record-tech-choice',
    query: 'how to document a significant technical choice with its rationale and consequences',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/adr.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-stored-wisdom',
    query: 'tap into stored knowledge and accumulated institutional wisdom',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/brain.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-inspect-changeset',
    query: 'have someone else inspect my changeset for correctness and style',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/code-review.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-written-material',
    query: 'produce written material like blog posts or announcements for the product',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/content.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-new-group',
    query: 'set up a brand new collaborative group from scratch',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/createorg.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-add-backlog',
    query: 'add a new work item to the backlog so someone can pick it up',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/createtask.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-root-cause',
    query: 'find the true cause of a malfunction before attempting any repair',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/debug.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-craft-visual',
    query: 'craft the visual appearance and user interaction patterns for a product',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/design.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-just-do-it',
    query: 'just carry out whatever is needed right now without further deliberation',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/do.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-run-procedure',
    query: 'run the concrete steps of a previously outlined procedure',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/execute.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-fiscal-health',
    query: 'track monetary inflows outflows and overall fiscal health of operations',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/finance.md'],
    tags: ['b7'],
  },
  // b7-dep-map-health removed: target file is 156 bytes, under the 400-byte corpus minimum
  {
    id: 'b7-available-commands',
    query: 'show me the available instructions and what each capability does',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/help.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-raw-spark',
    query: 'capture a raw spark of inspiration before it gets lost',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/idea.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-many-directions',
    query: 'brainstorm multiple creative directions for a given challenge',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/ideate.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-incremental-better',
    query: 'make the existing thing better without starting from zero',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/improve.md'],
    tags: ['b7'],
  },
  // b7-recurring-cycle removed: target is under the 400-byte corpus minimum
  {
    id: 'b7-attract-customers',
    query: 'promote and position the product to attract potential customers',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/marketing.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-portable-out',
    query: 'send internal structured data out as a portable interchange file',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/okf-export.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-portable-in',
    query: 'ingest a portable interchange file into the local system',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/okf-import.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-uptime-deploys',
    query: 'handle day to day operational concerns like uptime and deployments',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/ops.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-group-performance',
    query: 'check how a running collaborative group is performing right now',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/orgstatus.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-all-groups',
    query: 'list all the collaborative groups that have been established',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/orgs.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-sequential-phases',
    query: 'outline the sequential phases and milestones to reach a goal',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/plan.md'],
    tags: ['b7'],
  },
  // b7-roadmap-to-items removed: target file is not tracked in git, so it is not in the corpus
  {
    id: 'b7-incorporate-feedback',
    query: 'incorporate feedback that was given on my submitted work',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/receive-review.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-redo-once-more',
    query: 'redo the previous action or cycle through it once more',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/repeat.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-investigate-topic',
    query: 'investigate a topic thoroughly by gathering and synthesizing information',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/research.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-critique-quality',
    query: 'examine and critique someone else s contribution for quality',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/review.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-close-deals',
    query: 'pursue leads and close deals with prospective buyers',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/sales.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-reusable-package',
    query: 'create a reusable capability package that others can invoke later',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/skill-builder.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-narrow-experts',
    query: 'deploy purpose built workers with narrow domain expertise',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/specialagents.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-shutdown-group',
    query: 'shut down a running collaborative group gracefully',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/stoporg.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-fleet-shared',
    query: 'coordinate a fleet of parallel workers on a shared objective',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/monoswarm.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-transfer-infra',
    query: 'transfer a codebase to a different hosting platform or infrastructure',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/techport.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-best-arrangement',
    query: 'pick the best arrangement of nodes and communication pattern for the fleet',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/topology.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-comprehend-area',
    query: 'deeply comprehend an unfamiliar area of the codebase before changing it',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/understand.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-isolated-copy',
    query: 'use an isolated copy of the repository so parallel efforts do not collide',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/worktree.md'],
    tags: ['b7'],
  },
  // b7-spending-cap removed: target is under the 400-byte corpus minimum
  {
    id: 'b7-pi-equivalent',
    query: 'what are the equivalent capabilities when using the Inflection personal assistant',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/references/pi-tools.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-agy-equivalent',
    query: 'how do the features translate to the alternative non gravitational command line',
    relevant: [
      'packages/@monomind/cli/.claude/commands/mastermind/references/antigravity-tools.md',
    ],
    tags: ['b7'],
  },
  {
    id: 'b7-anthropic-primitives',
    query: 'which native Anthropic primitives correspond to each orchestration capability',
    relevant: [
      'packages/@monomind/cli/.claude/commands/mastermind/references/claude-code-tools.md',
    ],
    tags: ['b7'],
  },
  {
    id: 'b7-openai-terminal',
    query: 'how do the features map onto the OpenAI terminal assistant equivalent',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/references/codex-tools.md'],
    tags: ['b7'],
  },

  // -- batch 2: .claude/commands root, agents, misc --
  // b7-spending-limits removed: target is under the 400-byte corpus minimum
  {
    id: 'b7-troubleshoot-flow',
    query: 'how to troubleshoot and diagnose errors in my workflow',
    relevant: ['.claude/commands/mastermind/debug.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-carry-out-step',
    query: 'how to run a prepared action or carry out a scheduled step',
    relevant: ['.claude/commands/mastermind/execute.md'],
    tags: ['b7'],
  },
  // b7-index-state removed: target is under the 400-byte corpus minimum
  // b7-repeating-cycles removed: target is under the 400-byte corpus minimum
  // b7-strategy-to-items removed: target file is not tracked in git, so it is not in the corpus
  {
    id: 'b7-web-programmatic',
    query: 'how to open and control a web page programmatically for testing',
    relevant: ['.claude/commands/monobrowse.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-ml-integration',
    query: 'which persona handles machine learning model integration work',
    relevant: ['packages/@monomind/cli/.claude/agents/engineering/engineering-ai-engineer.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-server-data-layer',
    query: 'who designs the server side system structure and data layer',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-backend-architect.md',
    ],
    tags: ['b7'],
  },
  {
    id: 'b7-pr-quality',
    query: 'which specialist examines pull requests for quality and correctness',
    relevant: ['packages/@monomind/cli/.claude/agents/engineering/engineering-code-reviewer.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-ci-cd-infra',
    query: 'who handles ci cd pipelines and deployment infrastructure setup',
    relevant: ['packages/@monomind/cli/.claude/agents/engineering/engineering-devops-automator.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-browser-interface',
    query: 'which role builds the user facing browser interface components',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-frontend-developer.md',
    ],
    tags: ['b7'],
  },
  {
    id: 'b7-vuln-hardening',
    query: 'who audits for vulnerabilities and hardens the application',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-security-engineer.md',
    ],
    tags: ['b7'],
  },
  {
    id: 'b7-component-boundaries',
    query: 'which persona plans high level system design and component boundaries',
    relevant: [
      'packages/@monomind/cli/.claude/agents/engineering/engineering-software-architect.md',
    ],
    tags: ['b7'],
  },
  {
    id: 'b7-api-docs-help',
    query: 'who generates api docs and user facing help content',
    relevant: ['packages/@monomind/cli/.claude/agents/engineering/engineering-technical-writer.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-writes-source',
    query: 'which worker actually writes and modifies source files',
    relevant: ['packages/@monomind/cli/.claude/agents/core/coder.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-central-dispatcher',
    query: 'who is the central dispatcher that assigns jobs to other workers',
    relevant: ['packages/@monomind/cli/.claude/agents/core/coordinator.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-creates-roadmap',
    query: 'which role creates the roadmap and figures out what to do next',
    relevant: ['packages/@monomind/cli/.claude/agents/core/planner.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-gathers-background',
    query: 'who investigates unknowns and gathers background information first',
    relevant: ['packages/@monomind/cli/.claude/agents/core/researcher.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-inspects-bugs',
    query: 'which persona inspects finished work for bugs and style issues',
    relevant: ['packages/@monomind/cli/.claude/agents/core/reviewer.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-verification-suite',
    query: 'who writes and runs the verification suite for new functionality',
    relevant: ['packages/@monomind/cli/.claude/agents/core/tester.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-simultaneous-diff',
    query: 'how to have multiple workers inspect a diff simultaneously',
    relevant: ['packages/@monomind/cli/.claude/agents/github/monoswarm-code-review.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-repo-hosting-modes',
    query: 'what are the different ways to interact with repository hosting',
    relevant: ['packages/@monomind/cli/.claude/agents/github/github-modes.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-triage-bugs',
    query: 'how to automatically triage and label incoming bug reports',
    relevant: ['packages/@monomind/cli/.claude/agents/github/issue-tracker.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-merge-approvals',
    query: 'who manages open merge requests and handles approvals',
    relevant: ['packages/@monomind/cli/.claude/agents/github/pr-manager.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-version-tagging',
    query: 'who handles version tagging and publishing new distributions',
    relevant: ['packages/@monomind/cli/.claude/agents/github/release-manager.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-folder-restructure',
    query: 'who analyzes and restructures the overall folder and module layout',
    relevant: ['packages/@monomind/cli/.claude/agents/github/repo-architect.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-node-voting',
    query: 'how does voting and agreement work when multiple nodes must decide together',
    relevant: ['packages/@monomind/cli/.claude/agents/consensus/quorum-manager.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-visual-polish',
    query: 'which persona handles visual appearance and ui polish decisions',
    relevant: ['packages/@monomind/cli/.claude/agents/design/design-monodesign.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-define-objectives',
    query: 'how to define long term objectives and track progress toward them',
    relevant: ['packages/@monomind/cli/.claude/agents/goal/goal-planner.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-aggregate-knowledge',
    query: 'how does the shared group brain aggregate knowledge from all participants',
    relevant: [
      'packages/@monomind/cli/.claude/agents/monoswarm/collective-intelligence-coordinator.md',
    ],
    tags: ['b7'],
  },
  {
    id: 'b7-cross-system-glue',
    query: 'who wires together different services and handles cross system glue',
    relevant: ['packages/@monomind/cli/.claude/agents/specialists/integration-architect.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-ios-android-js',
    query: 'which worker builds ios and android apps using javascript frameworks',
    relevant: [
      'packages/@monomind/cli/.claude/agents/specialized/mobile/spec-mobile-react-native.md',
    ],
    tags: ['b7'],
  },
  {
    id: 'b7-tool-server-plugins',
    query: 'who creates new tool server plugins with the proper protocol',
    relevant: ['packages/@monomind/cli/.claude/agents/specialized/specialized-mcp-builder.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-p2p-topology',
    query: 'how does the peer to peer network topology manager distribute work',
    relevant: ['packages/@monomind/cli/.claude/agents/monoswarm/mesh-coordinator.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-bootstrap-template',
    query: 'what is the bootstrap template for launching a new multi worker group',
    relevant: ['packages/@monomind/cli/.claude/agents/templates/coordinator-monoswarm-init.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-mock-first-parallel',
    query: 'how to do mock first outside in testing with parallel workers',
    relevant: ['packages/@monomind/cli/.claude/agents/testing/tdd-london-monoswarm.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-google-ai-mapping',
    query: 'what are the equivalent capabilities when using the google ai terminal app',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/references/gemini-tools.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-ms-ai-mapping',
    query: 'how do microsoft ai assistant commands map to our features',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/references/copilot-tools.md'],
    tags: ['b7'],
  },
  // b7-worker-mgmt-docs removed: target is under the 400-byte corpus minimum
  {
    id: 'b7-parallel-sync',
    query: 'how to synchronize and direct multiple parallel workers on a shared task',
    relevant: ['packages/@monomind/cli/.claude/commands/agents/agent-coordination.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-multi-participant',
    query: 'what slash commands handle multi participant task distribution',
    relevant: ['packages/@monomind/cli/.claude/commands/coordination/README.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-launch-worker',
    query: 'how to launch a new background worker for a specific role',
    relevant: ['packages/@monomind/cli/.claude/commands/coordination/agent-spawn.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-auto-pick-worker',
    query: 'how to let the system autonomously pick and run the right worker',
    relevant: ['packages/@monomind/cli/.claude/commands/automation/auto-agent.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-collective-cmds',
    query: 'what commands exist for the collective intelligence network mode',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/README.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-shared-brain-config',
    query: 'how to configure and operate the shared brain collaboration system',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/monoswarm.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-group-skills-list',
    query: 'what are the available group coordination skill definitions',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/README.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-fleet-large-problem',
    query: 'how to manage a fleet of parallel workers tackling one large problem',
    relevant: ['packages/@monomind/cli/.claude/commands/monoswarm/monoswarm.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-intent-router',
    query: 'how does the universal intent router parse and dispatch incoming prompts',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-prompt-size',
    query: 'how to count and measure prompt size before sending to the model',
    relevant: ['packages/@monomind/cli/.claude/commands/tokens.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-compile-check',
    query: 'how to quickly compile and check types in my codebase from the command line',
    relevant: ['packages/@monomind/cli/.claude/commands/ts.md'],
    tags: ['b7'],
  },

  // -- batch 3: monodesign, monomotion, skills --
  {
    id: 'b7-ui-motion',
    query: 'how to add motion and transitions to my ui components',
    relevant: ['packages/@monoes/monodesign/skill/commands/animate.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-assertive-visual',
    query: 'make my interface feel more confident and assertive visually',
    relevant: ['packages/@monoes/monodesign/skill/commands/bolder.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-mockup-to-pixel',
    query: 'build a pixel perfect component from a mockup or wireframe',
    relevant: ['packages/@monoes/monodesign/skill/commands/craft.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-playful-touches',
    query: 'sprinkle fun micro interactions and playful touches into my app',
    relevant: ['packages/@monoes/monodesign/skill/commands/delight.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-frontend-intel-setup',
    query: 'set up the frontend intelligence tooling for the first time',
    relevant: ['packages/@monoes/monodesign/skill/commands/init.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-visual-drama-max',
    query: 'push the visual intensity and drama of my page layout to the max',
    relevant: ['packages/@monoes/monodesign/skill/commands/overdrive.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-spatial-proportions',
    query: 'restructure the spatial layout and proportions of a section',
    relevant: ['packages/@monoes/monodesign/skill/commands/shape.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-learn-brand',
    query: 'train the tool to understand our brand guidelines and preferences',
    relevant: ['packages/@monoes/monodesign/skill/commands/teach.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-css-a11y-check',
    query: 'run a health check on my css and flag accessibility problems',
    relevant: ['packages/@monoes/monodesign/skill/reference/audit.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-spec-to-component',
    query: 'step by step pipeline for turning a spec into a finished component',
    relevant: ['packages/@monoes/monodesign/skill/reference/craft.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-detect-tokens',
    query: 'automatically detect existing tokens and variables in a codebase',
    relevant: ['packages/@monoes/monodesign/skill/reference/polish.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-onboard-styler',
    query: 'onboard the styling assistant with project specific context',
    relevant: ['packages/@monoes/monodesign/skill/reference/teach.md'],
    tags: ['b7'],
  },
  // b7-legal-attribution removed: target is under the 400-byte corpus minimum
  {
    id: 'b7-tween-control',
    query: 'programmatically start stop and seek within running tweens',
    relevant: ['packages/@monomind/cli/.claude/skills/monomotion/rules/api-control.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-transition-presets',
    query: 'built in transition presets like fade bounce and elastic easing',
    relevant: ['packages/@monomind/cli/.claude/skills/monomotion/rules/effects.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-motion-lib-wiring',
    query: 'wiring up the motion library with react vue or vanilla js',
    relevant: ['packages/@monomind/cli/.claude/skills/monomotion/rules/integration.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-scroll-trigger',
    query: 'trigger element changes as the user scrolls down the page',
    relevant: ['packages/@monomind/cli/.claude/skills/monomotion/rules/scroll.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-chain-delays',
    query: 'chain multiple items to appear one after another with delays',
    relevant: ['packages/@monomind/cli/.claude/skills/monomotion/rules/sequencing.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-morph-paths',
    query: 'morph paths and draw lines in vector graphics with code',
    relevant: ['packages/@monomind/cli/.claude/skills/monomotion/rules/svg.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-letter-reveal',
    query: 'letter by letter reveal and word fly in headline effects',
    relevant: ['packages/@monomind/cli/.claude/skills/monomotion/rules/text.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-nav-screenshot',
    query: 'end to end website navigation and screenshot verification suite',
    relevant: ['packages/@monomind/cli/.claude/skills/agent-browser-testing/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-perm-levels',
    query: 'who can view or modify resources and permission levels',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-access/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-event-timeline',
    query: 'see a timeline of recent actions and events in the system',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-activity/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-external-connectors',
    query: 'configure connectors between the platform and external services',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-adapter-manager/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-integration-list',
    query: 'list of available third party integrations and their status',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-adapters/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-single-worker-drill',
    query: 'inspect a single worker including its current load and history',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-agent-detail/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-roster-pick',
    query: 'pick the right specialist from the roster for a given job',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-agent-select/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-workers-dashboard',
    query: 'overview dashboard of all running autonomous workers',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-agents/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-signoff-requests',
    query: 'review pending sign off requests and their justification',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-approval-detail/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-snapshot-restore',
    query: 'snapshot and restore project state in case something goes wrong',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-backup/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-scaffold-fresh',
    query: 'scaffold a fresh workspace with all dependencies ready to go',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-bootstrap/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-resource-allocation',
    query: 'track spending limits and resource allocation across teams',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-budgets/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-team-workspace',
    query: 'spin up a brand new team workspace from scratch',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-createorg/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-root-cause-method',
    query: 'methodical root cause analysis when something is broken',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-debug/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-subtask-handoff',
    query: 'hand off a subtask to another autonomous worker mid flight',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-delegation/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-ux-route',
    query: 'route visual and ux improvement requests to the right handler',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-design/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-cryptic-error',
    query: 'figure out why a failing command gives a cryptic error message',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-diagnose/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-runtime-vars',
    query: 'view and change runtime variables like paths and feature flags',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-env/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-deploy-targets',
    query: 'switch between staging production and local deployment targets',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-environments/SKILL.md'],
    tags: ['b7'],
  },

  // -- remaining uncovered skills --
  {
    id: 'b7-plugins-browse',
    query: 'discover and browse available extension plugins for the platform',
    relevant: ['.claude/skills/mastermind-plugins/SKILL.md'],
    tags: ['b7'],
  },
  {
    id: 'b7-cli-pkg-readme',
    query: 'the main documentation file for the cli engine package',
    relevant: ['packages/@monomind/cli/CLAUDE.md'],
    tags: ['b7'],
  },

  // ── c3 expansion (2026-07-28, cycle 3) ──────────────────────────────
  //
  // 77 pairs authored blind to document text and TEST results. Queries use
  // user vocabulary only. 3 candidates dropped (target README files missing
  // from corpus: monobrowse, monograph, routing). All targets verified
  // present in corpus at ≥400 bytes.

  // -- uncovered documents --
  {
    id: 'c3-runorg-daemon-launch',
    query: 'how do I boot up a previously configured team of agents through the background service',
    relevant: ['.claude/commands/mastermind/runorg.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-live-variant-picker',
    query:
      'click on parts of my running site and get alternative visual options generated instantly',
    relevant: ['packages/@monoes/monodesign/skill/commands/live.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-quieter-visual-tone',
    query:
      'the page feels too loud and busy how to dial back the visual energy without losing character',
    relevant: ['packages/@monoes/monodesign/skill/commands/quieter.md'],
    tags: ['c3'],
  },

  // -- re-queries: architecture / concepts --
  {
    id: 'c3-hooks-lifecycle-triggers',
    query: 'what runs automatically when I open or close a coding session',
    relevant: ['doc/concepts/hooks.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-hooks-cjs-dispatch',
    query: 'how does the settings json file wire up to code that intercepts tool calls',
    relevant: ['doc/concepts/hooks.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-hooks-worker-on-demand',
    query: 'which background jobs can I trigger manually and how do I run one',
    relevant: ['doc/concepts/hooks.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-memory-palace-drawers',
    query: 'where does the system save exact conversation snippets for later word-for-word lookup',
    relevant: ['doc/concepts/memory.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-memory-pattern-store',
    query: 'how does the learning pipeline turn past outcomes into reusable knowledge',
    relevant: ['doc/concepts/memory.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-memory-layers-overview',
    query: 'what are the different places information gets saved and how do they differ',
    relevant: ['doc/concepts/memory.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-org-runtime-daemon-arch',
    query: 'how do autonomous agent teams stay alive and talk to each other in the background',
    relevant: ['doc/concepts/org-runtime.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-org-runtime-human-loop',
    query: 'what happens when a running agent team needs to ask me something before continuing',
    relevant: ['doc/concepts/org-runtime.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-swarm-topologies',
    query: 'what arrangements can I use when splitting work across multiple helpers',
    relevant: ['doc/concepts/monoswarm.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-swarm-consensus-voting',
    query: 'how do workers agree on a result when they produce conflicting answers',
    relevant: ['doc/concepts/monoswarm.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-statusline-bar-meaning',
    query: 'what do the colored indicators at the bottom of my editor window mean',
    relevant: ['doc/concepts/statusline.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-statusline-data-sources',
    query: 'which files feed information into the live bar shown during a session',
    relevant: ['doc/concepts/statusline.md'],
    tags: ['c3'],
  },

  // -- re-queries: ADRs --
  {
    id: 'c3-gates-destructive-ops',
    query: 'what stops the AI from accidentally deleting important files or force-pushing',
    relevant: ['doc/adrs/ADR-G004-four-enforcement-gates.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-gates-secrets-scanning',
    query: 'how are credentials and API keys blocked from being committed or written',
    relevant: ['doc/adrs/ADR-G004-four-enforcement-gates.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-onnx-exit-crash',
    query: 'why does the program sometimes abort with code 134 when shutting down',
    relevant: ['doc/adrs/ADR-R001-onnxruntime-process-teardown.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-onnx-worker-hang',
    query: 'child processes hang on exit instead of terminating cleanly after embedding work',
    relevant: ['doc/adrs/ADR-R001-onnxruntime-process-teardown.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-dashboard-state-fragmentation',
    query:
      'why does the monitoring panel sometimes show stale or conflicting information about running teams',
    relevant: ['doc/adrs/org-dashboard-v2-design.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-dashboard-redesign-phases',
    query: 'what is the migration plan for fixing the real-time display of agent activity',
    relevant: ['doc/adrs/org-dashboard-v2-design.md'],
    tags: ['c3'],
  },

  // -- re-queries: release / product --
  {
    id: 'c3-v25-announcement-brain',
    query: 'when did saved knowledge start working across different projects and what changed',
    relevant: ['doc/announcements/2026-07-18-v2.5-announcement.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-v25-announcement-hardening',
    query: 'what cleanup happened after the big adversarial security review of the codebase',
    relevant: ['doc/announcements/2026-07-18-v2.5-announcement.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-cli-reference-all-commands',
    query: 'complete list of everything I can type on the command line and what each one does',
    relevant: ['doc/commands/cli-reference.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-cli-reference-doctor',
    query: 'how to run a health check that finds and fixes common setup problems',
    relevant: ['doc/commands/cli-reference.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-mastermind-reference-flags',
    query: 'what options can I pass to keep a slash command repeating or running without asking',
    relevant: ['doc/commands/mastermind-reference.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-mastermind-reference-brain',
    query:
      'how to load or save accumulated project intelligence between sessions using slash commands',
    relevant: ['doc/commands/mastermind-reference.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-readme-overview',
    query: 'what is this project and what problems does it solve at a high level',
    relevant: ['README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-readme-quickstart',
    query: 'how to install and get started with the tool for the first time',
    relevant: ['README.md'],
    tags: ['c3'],
  },

  // -- re-queries: packages --
  {
    id: 'c3-memory-pkg-sqlite',
    query:
      'how does the storage layer persist and search saved information locally using an embedded database',
    relevant: ['packages/@monomind/memory/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-memory-pkg-fallbacks',
    query: 'what happens on platforms where the native database driver cannot be compiled',
    relevant: ['packages/@monomind/memory/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-monofence-injection',
    query: 'how does the system detect when someone tries to trick the AI with hidden instructions',
    relevant: ['packages/monofence-ai/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-monofence-evasion',
    query: 'catching sneaky character substitutions and encoded payloads in user inputs',
    relevant: ['packages/monofence-ai/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-mcp-framework-transports',
    query: 'which network protocols does the server framework support for tool communication',
    relevant: ['packages/@monomind/mcp/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-mcp-framework-vs-cli',
    query: 'why are there two separate server implementations and which one runs by default',
    relevant: ['packages/@monomind/mcp/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-hooks-pkg-registry',
    query:
      'how does the library store and look up registered actions that respond to lifecycle moments',
    relevant: ['packages/@monomind/hooks/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-hooks-pkg-workers',
    query: 'the optional enrichment jobs that can be triggered at session boundaries',
    relevant: ['packages/@monomind/hooks/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-cli-pkg-readme',
    query: 'architecture overview of the main engine package that powers all terminal commands',
    relevant: ['packages/@monomind/cli/README.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-cli-pkg-agents',
    query: 'how many specialist personas ship with the package and where are they defined',
    relevant: ['packages/@monomind/cli/README.md'],
    tags: ['c3'],
  },

  // -- re-queries: process skills --
  {
    id: 'c3-worktree-isolation',
    query: 'working on a feature without touching my main checkout or dirtying my branch',
    relevant: ['.claude/skills/mastermind-worktree/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-worktree-cleanup',
    query: 'how to safely remove a temporary parallel copy of the repo after finishing',
    relevant: ['.claude/skills/mastermind-worktree/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-debug-root-cause',
    query: 'my fix keeps not working how to systematically find the real underlying problem',
    relevant: ['.claude/skills/mastermind-debug/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-debug-escalation',
    query: 'when repeated attempts at a patch keep failing and the problem might be deeper',
    relevant: ['.claude/skills/mastermind-debug/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-plan-no-placeholders',
    query: 'creating a step by step blueprint where every step has real code not just comments',
    relevant: ['.claude/skills/mastermind-plan/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-plan-handoff',
    query: 'after writing out the implementation roadmap how does it get turned into actual work',
    relevant: ['.claude/skills/mastermind-plan/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-execute-plan-follow',
    query: 'picking up a written plan document and carrying out each step exactly as specified',
    relevant: ['.claude/skills/mastermind-execute/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-execute-blocked',
    query: 'what should happen when an instruction in the plan does not make sense or is ambiguous',
    relevant: ['.claude/skills/mastermind-execute/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-design-before-code',
    query: 'exploring what to build through a conversation before writing any implementation',
    relevant: ['.claude/skills/mastermind-design/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-design-approval-gate',
    query: 'preventing anyone from jumping into coding before the proposed approach is accepted',
    relevant: ['.claude/skills/mastermind-design/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-skill-builder-tdd',
    query:
      'how to create a new reusable instruction set and test that it actually changes behavior',
    relevant: ['.claude/skills/mastermind-skill-builder/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-skill-builder-loopholes',
    query: 'closing gaps where the AI might rationalize its way around the skill instructions',
    relevant: ['.claude/skills/mastermind-skill-builder/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-receive-review-pushback',
    query: 'someone suggested a change but I think it is wrong how to respond with evidence',
    relevant: ['.claude/skills/mastermind-receive-review/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-receive-review-yagni',
    query: 'a reviewer wants me to add something extra that nobody needs yet',
    relevant: ['.claude/skills/mastermind-receive-review/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-plan-to-tasks-deps',
    query:
      'breaking a written roadmap into tickets with the right ordering and who should own each',
    relevant: ['.claude/skills/mastermind-plan-to-tasks/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-plan-to-tasks-parallel',
    query: 'which pieces of the plan can be worked on at the same time by different people',
    relevant: ['.claude/skills/mastermind-plan-to-tasks/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-diagnose-stalled',
    query: 'one of my background workers stopped making progress and I cannot tell why',
    relevant: ['.claude/skills/mastermind-diagnose/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-diagnose-infinite-loop',
    query: 'an agent keeps repeating the same action over and over without finishing',
    relevant: ['.claude/skills/mastermind-diagnose/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-review-multi-angle',
    query: 'getting several specialists to examine a change from different perspectives at once',
    relevant: ['.claude/skills/mastermind-review/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-review-auto-fix',
    query: 'automatically applying straightforward corrections found during code inspection',
    relevant: ['.claude/skills/mastermind-review/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-research-market-scan',
    query:
      'gathering competitive intelligence and user signals across multiple information sources',
    relevant: ['.claude/skills/mastermind-research/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-research-parallel-streams',
    query: 'fanning out a big investigation into separate tracks that run simultaneously',
    relevant: ['.claude/skills/mastermind-research/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-idea-divergent',
    query: 'brainstorming from many different angles then scoring ideas by impact versus effort',
    relevant: ['.claude/skills/mastermind-idea/SKILL.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-idea-decompose',
    query:
      'turning an approved concept into concrete subtasks split between engineering and operations',
    relevant: ['.claude/skills/mastermind-idea/SKILL.md'],
    tags: ['c3'],
  },

  // -- re-queries: project config --
  {
    id: 'c3-claudemd-package-table',
    query: 'which folders in the monorepo correspond to which published packages',
    relevant: ['CLAUDE.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-claudemd-publishing',
    query: 'the exact steps and ordering for releasing a new version to the registry',
    relevant: ['CLAUDE.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-cli-claudemd-workers',
    query: 'which background enrichment jobs ship with the CLI and how are they configured',
    relevant: ['packages/@monomind/cli/CLAUDE.md'],
    tags: ['c3'],
  },
  {
    id: 'c3-cli-claudemd-env-vars',
    query: 'what environment variables control behavior of the main command line tool',
    relevant: ['packages/@monomind/cli/CLAUDE.md'],
    tags: ['c3'],
  },

  // ── c3-lo expansion: batch 1 (2026-07-28) ────────────────────────────
  //
  // 59 pairs that passed corpus-membership screening. Queries use plain
  // language, metaphors, and user-need framing.

  {
    id: 'c3lo-background-refresh-workers',
    query: 'jobs that quietly run in the background to keep project health data up to date',
    relevant: ['doc/concepts/hooks.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-where-stuff-gets-remembered',
    query: 'all the different places this tool keeps things it learned between conversations',
    relevant: ['doc/concepts/memory.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-live-bar-at-bottom',
    query: 'that little indicator showing git branch and model name while I work',
    relevant: ['doc/concepts/statusline.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-multiple-helpers-at-once',
    query: 'running several AI assistants side by side on one problem',
    relevant: ['doc/concepts/monoswarm.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-dangerous-command-blocker',
    query: 'what stops an AI from accidentally wiping files or force-pushing',
    relevant: ['doc/adrs/ADR-G004-four-enforcement-gates.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-native-thread-crash',
    query:
      'why does the program crash with a mutex error when it exits after loading the embedding model',
    relevant: ['doc/adrs/ADR-R001-onnxruntime-process-teardown.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-team-of-agents-daemon',
    query: 'the long-running process that manages a group of AI workers acting as a company',
    relevant: ['doc/concepts/org-runtime.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-vote-counting-decisions',
    query: 'how do multiple AI workers reach agreement on whether a proposal should go through',
    relevant: ['.claude/agents/consensus/quorum-manager.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-writing-clean-code-agent',
    query:
      'the specialist whose only job is producing well-structured production-ready source files',
    relevant: ['.claude/agents/core/coder.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-test-from-outside-in',
    query: 'starting with behavior then working inward using fakes and stubs during development',
    relevant: ['.claude/agents/testing/tdd-london-monoswarm.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-gaming-ai-planner',
    query: 'finding the best sequence of steps to reach a goal like a strategy game character',
    relevant: ['.claude/agents/goal/goal-planner.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-combine-separate-findings',
    query:
      'taking what several independent workers discovered and merging it into one consistent picture',
    relevant: ['.claude/agents/monoswarm/collective-intelligence-coordinator.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-no-boss-collaboration',
    query:
      'workers operating as equals without anyone in charge then reconciling what they each produced',
    relevant: ['.claude/agents/monoswarm/mesh-coordinator.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-find-weaknesses-in-app',
    query: 'checking an application for injection flaws and authentication bypasses',
    relevant: ['.claude/agents/engineering/engineering-security-engineer.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-build-responsive-pages',
    query: 'creating web interfaces that look right on phones and pass contrast requirements',
    relevant: ['.claude/agents/engineering/engineering-frontend-developer.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-pipeline-infrastructure',
    query: 'automating deployment so the team can ship changes without manual server work',
    relevant: ['.claude/agents/engineering/engineering-devops-automator.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-cross-package-wiring',
    query:
      'making sure changes in one library do not break contracts with the other libraries in this project',
    relevant: ['.claude/agents/specialists/integration-architect.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-pull-request-lifecycle',
    query:
      'managing the full journey of a code contribution from creation through review to merging',
    relevant: ['.claude/agents/github/pr-manager.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-choose-arrangement',
    query:
      'picking whether my AI workers should be in a flat group or have someone directing traffic',
    relevant: ['.claude/commands/mastermind/topology.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-find-root-cause',
    query: 'investigating why something broke before attempting any repair',
    relevant: ['.claude/commands/mastermind/debug.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-write-implementation-roadmap',
    query: 'creating a step-by-step blueprint from requirements before anyone writes code',
    relevant: ['.claude/commands/mastermind/plan.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-start-ai-company',
    query:
      'launching a saved group of workers through the newer background process instead of the old way',
    relevant: ['.claude/commands/mastermind/runorg.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-invoicing-budgets',
    query: 'tracking money coming in and going out plus making financial forecasts',
    relevant: ['.claude/commands/mastermind/finance.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-outreach-pipeline',
    query: 'writing cold emails and managing who responded in a deal funnel',
    relevant: ['.claude/commands/mastermind/sales.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-blog-newsletter-creation',
    query: 'writing articles and email updates for an audience',
    relevant: ['.claude/commands/mastermind/content.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-one-time-org-setup',
    query: 'priming the boss with context and a signed invitation before the first run',
    relevant: ['.claude/skills/mastermind-bootstrap/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-archive-org-data',
    query:
      'bundling all the configuration and state files for a group into a timestamped compressed archive',
    relevant: ['.claude/skills/mastermind-backup/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-recursive-sub-spawning',
    query:
      'the capability block that lets any worker further delegate specialized subtasks of its own',
    relevant: ['.claude/skills/mastermind-delegation/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-pending-approvals-view',
    query: 'the single place to see everything waiting for a human decision across all groups',
    relevant: ['.claude/skills/mastermind-inbox/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-stalled-work-forensics',
    query: 'investigating why an AI worker stopped making progress and proposing a fix',
    relevant: ['.claude/skills/mastermind-diagnose/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-ensure-forward-motion',
    query: 'verifying every active piece of work has a clear next step or explicit blocker',
    relevant: ['.claude/skills/mastermind-liveness/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-local-task-board',
    query: 'the P2P SQLite-based project board used for tracking cards with columns and subtasks',
    relevant: ['.claude/skills/mastermind-monotask/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-forever-polling-executor',
    query:
      'a long-running watcher that picks up new items from issue trackers and assigns them to workers',
    relevant: ['.claude/skills/mastermind-monitor/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-api-key-vault',
    query: 'storing and rotating credentials that workers need without exposing them in logs',
    relevant: ['.claude/skills/mastermind-secrets/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-pause-runaway-work',
    query:
      'stopping a chain of tasks that is spinning out of control without killing everything else',
    relevant: ['.claude/skills/mastermind-tree-control/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-browser-animation-gsap',
    query:
      'creating moving visuals in the browser controlled by a timeline you can play and pause via an API',
    relevant: ['.claude/skills/monomotion/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-gemini-browser-images',
    query:
      'generating pictures using a real browser logged into an AI image service with no billing',
    relevant: ['.claude/skills/monoagent-image/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-technical-writing-workbench',
    query: 'scaffolding READMEs and checking tone and readability against a style guide',
    relevant: ['.claude/skills/monodoc/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-hire-pause-workers',
    query:
      'listing who is active in a group and temporarily sidelining or removing individual members',
    relevant: ['.claude/skills/mastermind-agents/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-cron-recurring-tasks',
    query: 'scheduling work to happen automatically on a repeating timetable',
    relevant: ['.claude/skills/mastermind-routines/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-execution-targets',
    query: 'choosing whether work runs on this machine, a remote server via SSH, or a sandbox',
    relevant: ['.claude/skills/mastermind-environments/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-install-extensions',
    query: 'adding third-party add-ons from npm and toggling them on or off',
    relevant: ['.claude/skills/mastermind-plugin-manager/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-invitation-approval-flow',
    query: 'sending someone a link to join a group and approving or rejecting their request',
    relevant: ['.claude/skills/mastermind-invites/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-pending-membership',
    query: 'reviewing who has asked to join and accepting or turning them away',
    relevant: ['.claude/skills/mastermind-join-queue/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-user-display-name',
    query: 'changing my visible name and checking how many tokens I have used',
    relevant: ['.claude/skills/mastermind-profile/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-fuzzy-cross-org-lookup',
    query: 'finding items matching a keyword across every group at once',
    relevant: ['.claude/skills/mastermind-search/SKILL.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-design-smell-catalog',
    query: 'the full list of fifty-plus visual mistakes the detector engine flags with fixes',
    relevant: ['packages/@monoes/monodesign/skill/reference/antipatterns-catalog.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-brand-font-selection',
    query:
      'picking a typeface that reflects personality instead of reaching for the first thing that looks clean',
    relevant: ['packages/@monoes/monodesign/skill/reference/brand.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-mental-effort-assessment',
    query:
      'measuring how much thinking a screen demands and removing the parts that waste attention',
    relevant: ['packages/@monoes/monodesign/skill/reference/cognitive-load.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-token-based-components',
    query:
      'building reusable interface pieces on top of a shared set of named color and spacing values',
    relevant: ['packages/@monoes/monodesign/skill/reference/component-system.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-user-archetype-testing',
    query:
      'walking through the interface pretending to be an impatient expert or a confused newcomer',
    relevant: ['packages/@monoes/monodesign/skill/reference/personas.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-design-director-review',
    query:
      'getting honest prioritized feedback on what is working and what needs to change in the UI',
    relevant: ['packages/@monoes/monodesign/skill/commands/critique.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-palette-construction',
    query: 'choosing and applying a set of hues that work in both light and dark mode',
    relevant: ['packages/@monoes/monodesign/skill/commands/colorize.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-font-hierarchy-scale',
    query:
      'replacing default text sizes with an intentional progression from headings down to captions',
    relevant: ['packages/@monoes/monodesign/skill/commands/typeset.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-accessibility-compliance',
    query: 'fixing keyboard navigation gaps and making sure contrast ratios meet the standard',
    relevant: ['packages/@monoes/monodesign/skill/commands/harden.md'],
    tags: ['c3-lo'],
  },
  {
    id: 'c3lo-simplify-cluttered-ui',
    query: 'stripping away elements that do not earn their place on the page',
    relevant: ['packages/@monoes/monodesign/skill/commands/distill.md'],
    tags: ['c3-lo'],
  },

  // ── c3-lo2 expansion (2026-07-28) ────────────────────────────────────
  //
  // 150 pairs targeting ONLY .md files, all with very low lexical overlap
  // against their target documents. Queries use circumlocutions, metaphors,
  // and user-need framing instead of document vocabulary.

  // -- untouched: commands --
  {
    id: 'c3lo2-spark-of-inspiration',
    query: 'how do I brainstorm a brand new concept and have it evaluated automatically',
    relevant: ['.claude/commands/mastermind/idea.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-handling-criticism',
    query: 'what is the right way to respond when someone points out flaws in my pull request',
    relevant: ['.claude/commands/mastermind/receive-review.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-groundhog-day',
    query:
      'how does the system keep doing the same thing over and over across separate conversations',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/_repeat.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-work-item-anatomy',
    query:
      'what does the structured file look like that describes a unit of work with its lifecycle and prerequisites',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/_taskfile.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-grand-dispatcher',
    query: 'where does a freeform prompt first land before it gets sent to the right specialist',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/master.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-elephant-never-forgets',
    query:
      'all the different ways I can save and retrieve things the system learned in earlier conversations',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/memory.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-ship-it',
    query: 'how do I cut a new version and push it out to users with changelog and everything',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/release.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-waking-the-crew',
    query: 'how do I boot up a saved team of AI workers so they start processing their backlog',
    relevant: ['packages/@monomind/cli/.claude/commands/mastermind/runorg.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-robot-clicks-buttons',
    query: 'how do I make the AI open a webpage and interact with it like a real person would',
    relevant: ['packages/@monomind/cli/.claude/commands/monobrowse.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (execution/export/finance/finish) --
  {
    id: 'c3lo2-follow-the-blueprint',
    query:
      'once a detailed blueprint exists how does the system carry it out step by step stopping on any blocker',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-execute/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-pack-your-bags',
    query:
      'how can I bundle up everything about a team configuration so I can move it to another machine',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-export/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (goals) --
  {
    id: 'c3lo2-zoom-into-ambition',
    query: 'how do I drill into a single objective to see its children and linked work items',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-goal-detail/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-north-star-tracker',
    query:
      'where do I define what the team is trying to achieve and see how far along each objective is',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-goals/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (heartbeat/idea/import/inbox) --
  {
    id: 'c3lo2-lightbulb-factory',
    query:
      'how does the system generate a bunch of creative concepts then score and break them into actionable pieces',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-idea/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-unpack-suitcase',
    query: 'how do I restore a previously exported team configuration from an archive file',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-import/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-morning-briefing',
    query: 'where do I see everything that needs my attention right now across all my teams',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-inbox/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (instance/intake/invites) --
  {
    id: 'c3lo2-mothership-dashboard',
    query: 'how do I see a bird-eye view of every running team and their combined resource limits',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-instance/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-twenty-questions',
    query:
      'when I give a vague instruction how does the system figure out what I actually want before starting',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-intake/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-welcome-mat',
    query:
      'what happens when someone clicks an invitation link to join a team as either a person or a bot',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-invite-landing/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-golden-ticket',
    query: 'how do I create and revoke access tokens that let new members join my group',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-invites/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (issues/join-queue/liveness) --
  {
    id: 'c3lo2-magnifying-glass-ticket',
    query:
      'how do I see the full history and conversation around one specific work item including who touched it',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-issue-detail/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-bug-board',
    query:
      'how do I list all open work items filtered by who is responsible and how urgent they are',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-issues/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-velvet-rope',
    query: 'where do I approve or deny people and bots waiting to be let into the group',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-join-queue/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-stuck-detector',
    query:
      'how does the system notice when a worker has gone silent on something it owns and force a recovery',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-liveness/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (marketing/memory/monitor/monotask) --
  {
    id: 'c3lo2-institutional-wisdom',
    query:
      'how does a team keep its accumulated know-how organized using a notebook-style system with daily entries',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-memory/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-tireless-watchman',
    query:
      'is there something that continuously polls external boards and automatically picks up new items to work on',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-monitor/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-kanban-swiss-army',
    query:
      'what is the local-first board system with columns and cards that supports subtasks and prerequisite chains',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-monotask/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (my-issues/new-agent/ops/org-chart) --
  {
    id: 'c3lo2-my-plate',
    query: 'how do I see only the work items that are currently assigned to me personally',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-my-issues/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-hiring-a-new-bot',
    query:
      'how do I add a brand new AI worker to my team with a specific role and model preference',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-new-agent/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (org-settings/orgs/orgstatus) --
  {
    id: 'c3lo2-rename-the-band',
    query: 'how do I change the name or configuration fields of an existing team setup',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-org-settings/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-roster-overview',
    query: 'how do I see all my saved AI teams and whether each one is currently active or idle',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-orgs/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-health-checkup',
    query:
      'how do I get a detailed breakdown of one specific team showing its budget and pending approvals',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-orgstatus/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (plan-to-tasks/plan/plugins) --
  {
    id: 'c3lo2-blueprint-to-tickets',
    query:
      'how do I turn a written document into a set of assigned work items with dependency ordering',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-plan-to-tasks/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-battle-plan',
    query:
      'how do I write a thorough step-by-step implementation document with exact file paths and no placeholders',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-plan/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-app-store',
    query:
      'how do I add or remove third-party extensions and check if newer versions are available',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-plugin-manager/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-extension-knobs',
    query: 'how do I configure an installed add-on and control which folders it can read or write',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-plugin-settings/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-toolbox-extras',
    query:
      'how do I browse what third-party additions are installed and toggle them on or off per team',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-plugins/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (profile/project-detail/project-workspace/projects) --
  {
    id: 'c3lo2-who-am-i',
    query:
      'where do I change my display name and see how much work I have completed across all teams',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-profile/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (protocol/receive-review/release/repeat) --
  {
    id: 'c3lo2-shared-grammar',
    query:
      'what are the common rules every domain specialist follows for loading context and formatting output',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-protocol/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-taking-notes-from-critics',
    query:
      'what is the correct posture when someone hands back a reviewed piece of work with requested changes',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-receive-review/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-launch-day',
    query: 'who coordinates the pipeline from version bump through testing to final deployment',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-release/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-alarm-clock',
    query:
      'how does the system schedule itself to wake up and continue where it left off in a loop',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-repeat/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (research/review/routine-detail/routines) --
  {
    id: 'c3lo2-intelligence-gathering',
    query:
      'how do I get a comprehensive report on competitors and market trends using multiple parallel investigators',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-research/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-peer-examination',
    query: 'how do I get code and content checked from multiple angles with optional auto-fixing',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-review/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-clockwork-innards',
    query: 'how do I inspect the trigger schedule and run history of one specific recurring job',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-routine-detail/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-cron-butler',
    query:
      'how do I set up a job that runs at a fixed interval with rules for what happens when it overlaps',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-routines/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (runorg/runorgv1/sales) --
  {
    id: 'c3lo2-flip-the-switch',
    query: 'what is the procedure to activate a saved AI crew using the new daemon-based backend',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-runorg/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (search/secrets/skill-builder/skills) --
  {
    id: 'c3lo2-needle-in-haystack',
    query: 'how do I find a specific item across all teams when I only remember part of its name',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-search/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-vault-keeper',
    query:
      'how do I safely store and rotate API credentials that my AI workers need without exposing them',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-secrets/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-teaching-new-tricks',
    query:
      'how do I create a brand new capability using a test-first approach that catches reasoning shortcuts',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-skill-builder/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-talent-inventory',
    query: 'how do I see which capabilities are available and toggle them per role in my team',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-skills/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (stoporg/tasks/tdd/techport) --
  {
    id: 'c3lo2-pull-the-plug',
    query: 'how do I gracefully shut down a running AI team so it stops consuming resources',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-stoporg/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-card-shuffler',
    query:
      'how do I move work items between columns and chain them with parent-child relationships',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-tasks/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-transplant-surgery',
    query:
      'how do I analyze a foreign codebase and safely bring its best parts into this project with proper renaming',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-techport/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (threads/tree-control/verify/wiki) --
  {
    id: 'c3lo2-conversation-trail',
    query:
      'where are the ongoing discussions stored and how do I reply to one within a specific team',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-threads/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-emergency-brake',
    query: 'how do I pause a runaway chain of subtasks and optionally cancel the whole branch',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-tree-control/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- untouched: skills (workspace-detail/workspaces/worktree/monomotion) --
  {
    id: 'c3lo2-sandbox-inspector',
    query:
      'how do I see the services and logs running inside one specific isolated coding environment',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-workspace-detail/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-parallel-sandboxes',
    query: 'how do I manage multiple isolated git branches where different workers do their coding',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-workspaces/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-clean-room',
    query:
      'how do I set up a fresh isolated copy of the repo for a feature so it does not interfere with main',
    relevant: ['packages/@monomind/cli/.claude/skills/mastermind-worktree/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-moving-pictures',
    query: 'how do I create timeline-driven web animations with playback control and scene labels',
    relevant: ['packages/@monomind/cli/.claude/skills/monomotion/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: agents (diverse selection) --
  {
    id: 'c3lo2-traffic-cop',
    query: 'who decides which helper tackles which piece of the puzzle and keeps everyone aligned',
    relevant: ['.claude/agents/core/coordinator.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-pixel-perfectionist',
    query:
      'who handles everything visual from color palettes to component layouts and accessibility audits',
    relevant: ['.claude/agents/design/design-monodesign.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-fortress-builder',
    query: 'who performs threat modeling and vulnerability assessment to keep the app safe',
    relevant: ['.claude/agents/engineering/engineering-security-engineer.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-pathfinder',
    query:
      'who uses gaming AI techniques to find the best sequence of actions toward a complex objective',
    relevant: ['.claude/agents/goal/goal-planner.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-knowledge-gardener',
    query:
      'who distills findings from many helpers into shared long-term wisdom that others can read',
    relevant: ['.claude/agents/monoswarm/collective-intelligence-coordinator.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-tool-factory',
    query: 'who creates custom protocol extensions that give AI helpers new capabilities',
    relevant: ['.claude/agents/specialized/specialized-mcp-builder.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-bridge-builder',
    query: 'who ensures all the separate packages in the monorepo stay wired together correctly',
    relevant: ['.claude/agents/specialists/integration-architect.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-jury-panel',
    query:
      'how does a group of reviewers simultaneously evaluate a proposed change from different angles',
    relevant: ['.claude/agents/github/monoswarm-code-review.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-starter-template',
    query: 'where is the boilerplate definition for setting up a new group of coordinated workers',
    relevant: ['.claude/agents/templates/coordinator-monoswarm-init.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: doc --
  {
    id: 'c3lo2-guardrails',
    query:
      'what are the four checkpoints that prevent harmful actions before they reach the filesystem',
    relevant: ['doc/adrs/ADR-G004-four-enforcement-gates.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-big-news',
    query: 'what changed in the mid-2026 major update and why should users care',
    relevant: ['doc/announcements/2026-07-18-v2.5-announcement.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-tripwires',
    query:
      'how does the system run custom logic before or after specific events like editing or saving',
    relevant: ['doc/concepts/hooks.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-brain-anatomy',
    query: 'all the different places this tool keeps things it learned between conversations',
    relevant: ['doc/concepts/memory.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-team-engine',
    query:
      'how does the daemon-based system actually orchestrate multiple AI workers in the background',
    relevant: ['doc/concepts/org-runtime.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-ant-colony',
    query:
      'how do many autonomous workers coordinate on a shared goal using different network shapes',
    relevant: ['doc/concepts/monoswarm.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-constitution',
    query:
      'where are the top-level behavioral rules and package architecture documented for the whole project',
    relevant: ['CLAUDE.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-front-door',
    query:
      'where is the first thing a newcomer reads to understand what this project does and how to get started',
    relevant: ['README.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: monodesign references (select) --
  {
    id: 'c3lo2-hall-of-shame',
    query: 'what is the catalog of common UI mistakes and how they get scored for severity',
    relevant: ['packages/@monoes/monodesign/skill/reference/antipatterns-catalog.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-brain-overload',
    query:
      'how do you measure and reduce the mental effort a user has to spend understanding an interface',
    relevant: ['packages/@monoes/monodesign/skill/reference/cognitive-load.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-lego-bricks',
    query:
      'how do you organize reusable UI building blocks into a coherent library with variants and slots',
    relevant: ['packages/@monoes/monodesign/skill/reference/component-system.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-font-rules',
    query: 'how do you pick and pair typefaces and set the vertical rhythm for readable text',
    relevant: ['packages/@monoes/monodesign/skill/reference/typography.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-words-that-guide',
    query:
      'what are the rules for writing interface labels and error messages that feel human and helpful',
    relevant: ['packages/@monoes/monodesign/skill/reference/ux-writing.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-named-values',
    query:
      'how do you organize the named constants for colors spacing and sizing into a layered system',
    relevant: ['packages/@monoes/monodesign/skill/reference/token-architecture.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-imaginary-users',
    query: 'where are the fictional representative people defined that guide product decisions',
    relevant: ['packages/@monoes/monodesign/skill/reference/personas.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-picture-recipes',
    query:
      'how do you write text descriptions that produce consistent visuals for hero graphics and illustrations',
    relevant: ['packages/@monoes/monodesign/skill/reference/image-prompts.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-tear-it-apart',
    query: 'how do I get a structured evaluation of what is wrong with my current page layout',
    relevant: ['packages/@monoes/monodesign/skill/commands/critique.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-visual-brain-source',
    query:
      'where is the master definition that powers all the aesthetic and usability intelligence',
    relevant: ['packages/@monoes/monodesign/skill/SKILL.src.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: monomotion rules --
  {
    id: 'c3lo2-parallax-magic',
    query: 'what rules govern animations that trigger as the user scrolls down the page',
    relevant: ['.claude/skills/monomotion/rules/scroll.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-dancing-letters',
    query: 'how do I make words and characters appear with staggered entrance effects',
    relevant: ['.claude/skills/monomotion/rules/text.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-drawing-itself',
    query: 'how do I animate vector graphics so lines appear to draw themselves on screen',
    relevant: ['.claude/skills/monomotion/rules/svg.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: standalone skills --
  {
    id: 'c3lo2-headless-visitor',
    query:
      'how do I have the AI visit a live webpage and verify elements are present without manual clicking',
    relevant: ['.claude/skills/agent-browser-testing/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-auto-docs',
    query: 'how do I automatically generate written explanations for my codebase',
    relevant: ['.claude/skills/monodoc/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: commands --
  {
    id: 'c3lo2-network-shape-picker',
    query: 'how do I choose the best arrangement of workers for my particular kind of project',
    relevant: ['.claude/commands/mastermind/topology.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-detective-work',
    query: 'how do I systematically track down why something broke using structured investigation',
    relevant: ['.claude/commands/mastermind/debug.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: root skills --
  {
    id: 'c3lo2-task-handoff',
    query: 'how does work get distributed to the right specialist based on what the job requires',
    relevant: ['.claude/skills/mastermind-delegation/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-system-doctor',
    query: 'how do I figure out what is wrong when the whole setup feels sluggish or broken',
    relevant: ['.claude/skills/mastermind-diagnose/SKILL.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: CLI package skills --
  {
    id: 'c3lo2-fat-trimmer',
    query: 'how do I identify and remove unnecessary complexity and bloat from the codebase',
    relevant: ['packages/@monomind/cli/.claude/skills/monolean/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-prose-diet',
    query:
      'how do I catch and fix AI-generated text that sounds hollow and uses too many filler phrases',
    relevant: ['packages/@monomind/cli/.claude/skills/stop-slop/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-banned-words',
    query:
      'where is the list of overused expressions that should be replaced with plainer language',
    relevant: ['packages/@monomind/cli/.claude/skills/stop-slop/references/phrases.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-coding-buddy',
    query:
      'how do I work side by side with the AI in a collaborative back-and-forth coding session',
    relevant: ['packages/@monomind/cli/.claude/skills/pair-programming/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-conductor-baton',
    query: 'how do I coordinate a group of parallel AI workers with shared state and checkpoints',
    relevant: ['packages/@monomind/cli/.claude/skills/monoswarm/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-sorting-hat',
    query: 'how does the system automatically categorize and prioritize incoming bug reports',
    relevant: ['packages/@monomind/cli/.claude/skills/github-issue-triage/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-collective-brain',
    query: 'how do multiple autonomous helpers pool their findings into a shared understanding',
    relevant: ['packages/@monomind/cli/.claude/skills/monoswarm/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-auto-wiring',
    query: 'how do I set up automatic actions that fire in response to specific lifecycle events',
    relevant: ['packages/@monomind/cli/.claude/skills/hooks-automation/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-web-surfer',
    query:
      'how does the AI navigate real websites using the Chrome DevTools protocol under the hood',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: github templates --
  {
    id: 'c3lo2-something-broke',
    query:
      'what information should I include when reporting that something is not working correctly',
    relevant: ['.github/ISSUE_TEMPLATE/bug_report.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-what-changed-when',
    query: 'where is the chronological record of every notable modification across all versions',
    relevant: ['CHANGELOG.md'],
    tags: ['c3-lo2'],
  },

  // -- touched: misc skills and references --
  {
    id: 'c3lo2-hollow-scaffolding',
    query:
      'what are the common document shapes and paragraph patterns that signal empty filler content',
    relevant: ['packages/@monomind/cli/.claude/skills/stop-slop/references/structures.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-chat-navigator',
    query: 'how do I have the AI read and interact with a team messaging workspace in the cloud',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse-slack.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-deployment-dashboard',
    query:
      'how do I have the AI check on my hosted web application through the hosting provider portal',
    relevant: ['packages/@monomind/cli/.claude/skills/monomind/browse-vercel.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-grading-rubric',
    query:
      'how does the system assign numerical scores to usability and aesthetic quality of a page',
    relevant: ['packages/@monoes/monodesign/skill/reference/heuristics-scoring.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-custom-expert',
    query: 'how do I define a one-off specialist with a narrow focus area for a very specific job',
    relevant: ['packages/@monomind/cli/.claude/skills/specialagent/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-golden-rules',
    query: 'what are the non-negotiable usability principles that every screen must satisfy',
    relevant: ['packages/@monoes/monodesign/skill/reference/ux-rules.md'],
    tags: ['c3-lo2'],
  },

  // -- additional touched pairs for count target --
  {
    id: 'c3lo2-the-typist',
    query: 'which specialist actually writes the source files when implementation work needs doing',
    relevant: ['.claude/agents/core/coder.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-red-pen',
    query: 'who gives the final critical read before changes are accepted into the main branch',
    relevant: ['.claude/agents/core/reviewer.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-quality-gate',
    query:
      'which specialist writes and runs the automated checks that prove the code actually works',
    relevant: ['.claude/agents/core/tester.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-pipeline-plumber',
    query: 'who sets up the continuous integration and cloud infrastructure automation',
    relevant: ['.claude/agents/engineering/engineering-devops-automator.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-word-smith',
    query:
      'who transforms complex engineering concepts into clear docs that developers can actually follow',
    relevant: ['.claude/agents/engineering/engineering-technical-writer.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-gatekeeper',
    query: 'who handles the lifecycle of proposed changes from opening through review to merging',
    relevant: ['.claude/agents/github/pr-manager.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-flat-hierarchy',
    query:
      'who coordinates peer-level helpers that share state without a single boss directing them',
    relevant: ['.claude/agents/monoswarm/mesh-coordinator.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-zombie-process',
    query:
      'why does the neural network runtime need to run in a separate child process that gets killed on exit',
    relevant: ['doc/adrs/ADR-R001-onnxruntime-process-teardown.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-bottom-bar',
    query:
      'what is the persistent information strip at the bottom of the terminal showing current state',
    relevant: ['doc/concepts/statusline.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-readability-ratios',
    query:
      'what are the rules for making sure text and backgrounds have enough difference to be legible',
    relevant: ['packages/@monoes/monodesign/skill/reference/color-and-contrast.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-choreography',
    query:
      'what guidelines govern how interface elements move and transition to feel natural and purposeful',
    relevant: ['packages/@monoes/monodesign/skill/reference/motion-design.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-stretchy-layouts',
    query:
      'how does the interface adapt gracefully from a tiny phone screen to a wide desktop monitor',
    relevant: ['packages/@monoes/monodesign/skill/reference/responsive-design.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-visual-sparkle',
    query: 'what are the available visual flourishes like particle bursts and glowing halos',
    relevant: ['.claude/skills/monomotion/rules/effects.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-choreograph-order',
    query: 'how do I control which animations play first and which ones overlap in time',
    relevant: ['.claude/skills/monomotion/rules/sequencing.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-picture-generator',
    query:
      'how do I create actual images from text descriptions rather than just writing the specs',
    relevant: ['.claude/skills/monoagent-image/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-waste-scanner',
    query: 'how do I get a report on dead code and unused dependencies that are adding weight',
    relevant: ['packages/@monomind/cli/.claude/skills/monolean-audit/SKILL.md'],
    tags: ['c3-lo2'],
  },
  {
    id: 'c3lo2-proof-standards',
    query: 'what constitutes sufficient evidence that a change works before it can be called done',
    relevant: ['packages/@monomind/cli/.claude/skills/verification-quality/SKILL.md'],
    tags: ['c3-lo2'],
  },
);

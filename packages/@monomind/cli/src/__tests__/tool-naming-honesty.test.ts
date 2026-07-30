/**
 * Tool-naming honesty guard.
 *
 * Monomind repeatedly shipped MCP tools whose names borrow terms of art from
 * distributed systems and machine learning for what is, on inspection, local
 * JSON bookkeeping or a keyword heuristic: "raft"/"byzantine" consensus that is
 * a single-process vote counter, `neural_train` that performs no training,
 * `swarm_init` that starts no process, `hive-mind_broadcast` with no listeners.
 * The pattern recurred across five independently-audited subsystems, so it is
 * drift rather than isolated mistakes — and code comments were usually honest
 * while the public tool description was not.
 *
 * A convention document would not have prevented any of it. This does:
 *
 *   If a tool's NAME contains a term of art from distributed systems or ML,
 *   its DESCRIPTION must contain grounding language saying what it actually
 *   does.
 *
 * That rule is deliberately narrow. A blanket ban on the vocabulary would be
 * wrong — `swarm_status` is a perfectly honest tool and monomind's product
 * vocabulary legitimately includes "swarm" and "hive-mind". What matters is
 * that a reader of the tool list is told the mechanism, not just the metaphor.
 *
 * Failure mode is intentionally cheap to resolve: add a clause describing the
 * real mechanism, which is the behaviour we want anyway.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { allHiveMindTools } from '../mcp-tools/hive-mind-tools.js';
import { allEmbeddingsTools } from '../mcp-tools/embeddings-tools.js';
import { swarmTools } from '../mcp-tools/swarm-tools.js';
import { agentTools } from '../mcp-tools/agent-tools.js';
import type { MCPTool } from '../mcp-tools/types.js';

/**
 * Terms of art that imply a capability class the codebase does not have.
 * Matched against the tool NAME only — a description may of course use them
 * while explaining what is really going on.
 */
const LOADED_NAME_TERMS = [
  'neural',
  'consensus',
  'byzantine',
  'raft',
  'quantum',
  'autonomous',
  'distributed',
  'spawn',
  'broadcast',
  'init',
  'scale',
  // Added when the guard was widened to the whole registry (L12). The ML
  // vocabulary below was previously unwatched because the five audited
  // families happened not to use it outside `neural_*` — but `hooks_pretrain`
  // (a directory walk) and `autopilot_predict` (return the first incomplete
  // task) were shipping exactly the overclaim this guard exists to catch.
  'train',
  'predict',
  'learn',
  'attention',
  'cognitive',
  'adaptive',
  'emergent',
  'hierarchical',
];

/**
 * Phrases that constitute grounding — they name a concrete mechanism or state
 * an explicit limit. At least one must appear in the description of any tool
 * whose name hits LOADED_NAME_TERMS.
 */
const GROUNDING = [
  'json', 'state file', 'persistent state', 'bookkeeping', 'record',
  'no process', 'not a running', 'starts no', 'nothing is started',
  'single-process', 'not distributed', 'vote', 'threshold',
  'no ml', 'not ml', 'no model', 'pattern store', 'similarity',
  'does not', 'no implementing code', 'not message delivery', 'noticeboard',
  'counter', 'metadata', 'local file',
  // Added with the L12 widening — each names a concrete mechanism.
  'onnx',            // a real named runtime, unlike the removed 'embed'
  'label',           // "tier-labeled namespaces", "tiers are labels"
  'heuristic',
  'no training',
  'file extension',
  'keyword',
  'time-decay',
  'not a declared dependency',  // states why a capability is absent, concretely
];

/**
 * `embed` was removed from GROUNDING in L12. It was vacuous: every
 * `embeddings_*` tool's description contains the word by definition, so the
 * term grounded nothing. `embeddings_init` passed the guard solely on that
 * substring while its description ("Initialize the ONNX embedding subsystem
 * with hyperbolic support") named no mechanism at all — it now passes on
 * `onnx`, which is a real one. Kept as a named constant so the removal is
 * deliberate rather than something a future edit quietly re-adds.
 */
const REJECTED_AS_VACUOUS = ['embed'];

function isGrounded(description: string): boolean {
  const d = description.toLowerCase();
  return GROUNDING.some((g) => d.includes(g));
}

function loadedTermsInName(name: string): string[] {
  const n = name.toLowerCase();
  return LOADED_NAME_TERMS.filter((t) => n.includes(t));
}

/**
 * The five families that historically carried overclaiming names. Kept as an
 * explicit floor: even if registry discovery below were to break or silently
 * return nothing, these are always audited.
 */
const HISTORIC_FAMILIES: MCPTool[] = [
  ...allHiveMindTools,
  ...allEmbeddingsTools,
  ...swarmTools,
  ...agentTools,
];

/**
 * Every registered tool, gated families included.
 *
 * L5 audited only HISTORIC_FAMILIES (~40 tools) because a manual sweep found
 * no offenders among the rest. That sweep was right about the tools it looked
 * at and wrong as a strategy: it only checked the vocabulary those families
 * used. Widening the scope *and* the term list surfaced four real overclaims
 * outside the original five families (`hooks_pretrain`, `autopilot_predict`,
 * `autopilot_learn`, `hooks_intelligence_learn`).
 *
 * The gated env vars are set so the guard sees the tools that are hidden by
 * default — being hidden is not the same as not shipping.
 */
let ALL_TOOLS: MCPTool[] = [];

beforeAll(async () => {
  process.env.MONOGRAPH_MCP_ADVANCED = '1';
  process.env.MONOMIND_MCP_SPECULATIVE = '1';
  const registry = await import('../mcp-tools/index.js');
  const byName = new Map<string, MCPTool>();
  for (const exported of Object.values(registry)) {
    if (!Array.isArray(exported)) continue;
    for (const tool of exported as MCPTool[]) {
      if (tool && typeof tool.name === 'string' && tool.inputSchema) byName.set(tool.name, tool);
    }
  }
  for (const tool of HISTORIC_FAMILIES) byName.set(tool.name, tool);
  ALL_TOOLS = [...byName.values()];
});

describe('tool-naming honesty', () => {
  it('discovers the whole registry, not just the historic families', () => {
    // Guards against the audit silently shrinking back to a handful of tools.
    expect(ALL_TOOLS.length).toBeGreaterThan(200);
    expect(ALL_TOOLS.length).toBeGreaterThan(HISTORIC_FAMILIES.length);
  });

  it('never re-admits a grounding term that grounds nothing', () => {
    for (const vacuous of REJECTED_AS_VACUOUS) {
      expect(GROUNDING).not.toContain(vacuous);
    }
  });

  it('every tool using a loaded term in its name explains the real mechanism', () => {
    const offenders: string[] = [];

    for (const tool of ALL_TOOLS) {
      const terms = loadedTermsInName(tool.name);
      if (terms.length === 0) continue;
      const description = tool.description ?? '';
      if (!isGrounded(description)) {
        offenders.push(`${tool.name} (matched: ${terms.join(', ')}) — "${description.slice(0, 70)}…"`);
      }
    }

    expect(
      offenders,
      `These tool names borrow distributed-systems/ML terms of art but their ` +
        `descriptions never say what actually happens. Add a clause naming the ` +
        `real mechanism (e.g. "writes JSON state", "no process is started", ` +
        `"vote-count threshold, not distributed consensus", "no ML training ` +
        `occurs").\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  // --- self-tests: the guard must actually fire ---------------------------

  const fake = (name: string, description: string): MCPTool =>
    ({ name, description, inputSchema: { type: 'object' }, handler: async () => ({}) }) as unknown as MCPTool;

  it('flags an ungrounded loaded-term tool', () => {
    const t = fake('hive-mind_broadcast', 'Broadcast message to all workers');
    expect(loadedTermsInName(t.name).length).toBeGreaterThan(0);
    expect(isGrounded(t.description ?? '')).toBe(false);
  });

  it('accepts the same tool once it names the mechanism', () => {
    const t = fake(
      'hive-mind_broadcast',
      'Append a message to a shared array on the hive state file — a noticeboard, not message delivery.',
    );
    expect(isGrounded(t.description ?? '')).toBe(true);
  });

  it('ignores tools whose names carry no loaded term', () => {
    expect(loadedTermsInName('memory_search')).toEqual([]);
    expect(loadedTermsInName('task_create')).toEqual([]);
  });

  it('does not require grounding language from an unrelated honest tool', () => {
    const t = fake('config_get', 'Get a configuration value');
    expect(loadedTermsInName(t.name)).toEqual([]);
  });

  it('recognises the grounding phrasings actually used in this codebase', () => {
    const real = [
      'Record a swarm topology/strategy in persistent state. This writes a JSON state file',
      'Embed text as vectors and store as named patterns for later similarity search (no ML training occurs)',
      '"bft"/"raft"/"quorum" are vote-count thresholds',
      'Register a new agent record (type, model preference, status) in the persistent agent store',
    ];
    for (const d of real) expect(isGrounded(d)).toBe(true);
  });
});

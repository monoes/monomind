// packages/@monomind/cli/src/orgrt/org-memory.ts
// Extracted from daemon.ts — org cross-run memory, recall, learn, knowledge search.
import { join } from 'node:path';
import type { KgScope } from '../memory/memory-kg.js';
import type { OrgDaemon } from './daemon.js';
import type { RunSummary } from './reporting.js';
import type { OrgDef } from './types.js';

/** THE resolver for an org's flat-memory namespace. Runtime writes and the
 *  `org memory <name> search` CLI both go through it — when the CLI hardcoded
 *  `org:<name>` instead, an org with a configured `memory_namespace` was
 *  searched in a namespace nothing had ever written to. */
export function orgMemoryNamespace(name: string, def: OrgDef): string {
  return def.run_config.memory_namespace ?? `org:${name}`;
}

/** Ownership scope for everything this org puts in the knowledge graph.
 *
 *  All orgs under one root share the org-memory store, so the KG needs the org
 *  named explicitly: without it, org A's entities, rules, glossary and
 *  rollbacks all reach org B's. Unlike flat memory this is keyed on the ORG
 *  NAME, not on `memory_namespace` — a shared or renamed flat namespace must
 *  not silently merge two orgs' graph claims. */
export function orgKgScope(name: string): KgScope {
  return { org: name };
}

/** Store dir for org cross-run memory — inside the org root so the bridge's
 *  path guard accepts it when the daemon runs from the project (the normal
 *  case) and test roots stay isolated. */
export function orgMemoryDbPath(root: string): string {
  return join(root, '.monomind', 'org-memory');
}

/** The memory bridge's traversal guard silently redirects out-of-tree paths
 *  to the per-project default store. For an org rooted outside cwd (tests,
 *  unusual daemon setups) that redirect would write into the WRONG project's
 *  memory — verify the guard kept our path, and skip org memory otherwise. */
export async function orgMemoryUsable(root: string): Promise<boolean> {
  try {
    const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
    const want = orgMemoryDbPath(root);
    const got = bridgeGetDbPath(want);
    const { realpathSync } = await import('node:fs');
    const real = (p: string): string => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    };
    return real(got) === real(want);
  } catch {
    return false;
  }
}

/** Namespace for a role's PRIVATE memories, inside the org memory DB. */
export function agentMemoryNamespace(name: string, def: OrgDef, role: string): string {
  return `agent:${orgMemoryNamespace(name, def)}:${role}`;
}

/** org_remember implementation: a deliberate write to org-shared or
 *  role-private memory (both in the org memory DB, split by namespace). */
export async function rememberOrgMemory(
  root: string,
  name: string,
  def: OrgDef,
  role: string,
  content: string,
  scope: 'org' | 'agent',
  run: string,
): Promise<string> {
  try {
    if (!(await orgMemoryUsable(root))) return 'org memory is not available in this environment.';
    const { bridgeStoreEntry } = await import('../memory/memory-bridge.js');
    const namespace =
      scope === 'agent' ? agentMemoryNamespace(name, def, role) : orgMemoryNamespace(name, def);
    const res = await bridgeStoreEntry({
      key: `mem-${run}-${Date.now().toString(36)}`,
      value: content.slice(0, 20_000),
      namespace,
      dbPath: orgMemoryDbPath(root),
      tags: [scope, role],
      metadata: { origin_refs: [`run:${run}`], by: role },
    });
    if (res?.duplicate) return `Already remembered (near-duplicate exists) — reinforced instead.`;
    return res?.success
      ? `Remembered (${scope} scope).`
      : `Could not store memory${res?.error ? `: ${res.error}` : ''}.`;
  } catch (err) {
    return `org_remember failed (${err instanceof Error ? err.message : 'error'})`;
  }
}

/** org_recall implementation: searches the org's flat memory namespaces AND
 *  the org's memory knowledge graph — independently, then merges. They used to
 *  be chained: an empty flat-memory result returned early, so an org whose
 *  knowledge lived only in the graph was told "nothing found" while the graph
 *  held the answer (graph-boundaries B3 / memory-KG K6). Failures return a
 *  message, never throw into the tool. */
export async function recallOrgMemory(
  daemon: OrgDaemon,
  name: string,
  def: OrgDef,
  query: string,
  role?: string,
): Promise<{ text: string; hits: number }> {
  try {
    if (!(await orgMemoryUsable(daemon.root)))
      return { text: 'org memory is not available in this environment.', hits: 0 };
    const bridge = await import('../memory/memory-bridge.js');
    const kg = await import('../memory/memory-kg.js');
    const dbPath = orgMemoryDbPath(daemon.root);
    // Shared org memory, the caller's private agent scope, and the org's
    // knowledge graph — all three issued together. The graph is a peer surface,
    // not a decoration on a non-empty flat result.
    const [shared, priv, graph] = await Promise.all([
      bridge.bridgeSearchEntries({
        query,
        namespace: orgMemoryNamespace(name, def),
        limit: 5,
        dbPath,
      }),
      role
        ? bridge.bridgeSearchEntries({
            query,
            namespace: agentMemoryNamespace(name, def, role),
            limit: 3,
            dbPath,
          })
        : null,
      kg.kgSearch({ query, dbPath, limit: 5, scope: orgKgScope(name) }).catch(() => null),
    ]);
    const results = [
      ...(shared?.results ?? []),
      ...(priv?.results ?? []).map((r) => ({ ...r, key: `${r.key} (private)` })),
    ]
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    // `context` already renders standalone entities when there are no triplets,
    // so an org whose graph holds only isolated entities still answers.
    const graphContext = graph?.context ? graph.context.slice(0, 1024) : '';
    const graphHits = (graph?.triplets?.length ?? 0) + (graph?.seeds?.length ?? 0);

    if (!results.length && !graphContext) {
      const why =
        graph && graph.success === false
          ? ' (the org knowledge graph could not be read, so this is not proof it holds nothing)'
          : '';
      return {
        text: `No matching org memory or knowledge-graph facts found${why} — this may be the first run covering this topic.`,
        hits: 0,
      };
    }

    const ids = results.map((r) => r.id).filter(Boolean);
    if (ids.length) {
      let used = daemon.recallUsage.get(name);
      if (!used) {
        used = new Set();
        daemon.recallUsage.set(name, used);
      }
      for (const id of ids) used.add(id);
      // Frequency reinforcement is immediate; the feedback rating waits for the
      // run outcome (positive-only — see storeRunMemory).
      bridge.bridgeRecordUsage({ entryIds: ids, dbPath }).catch(() => {
        /* best effort */
      });
    }

    const sections: string[] = [];
    if (results.length)
      sections.push(
        results.map((r, i) => `${i + 1}. [${r.key}] ${r.content.slice(0, 500)}`).join('\n\n'),
      );
    else sections.push('No matching flat org memory — answering from the org knowledge graph.');
    if (graphContext) sections.push(`Knowledge graph:\n${graphContext}`);
    if (graph?.truncated)
      sections.push(
        '(Knowledge-graph scan was incomplete — a relation that exists may be missing above.)',
      );
    return { text: sections.join('\n\n'), hits: results.length + graphHits };
  } catch (err) {
    return {
      text: `org memory unavailable (${err instanceof Error ? err.message : 'error'})`,
      hits: 0,
    };
  }
}

/** The org runtime's `knowledge_search` tool is a DOCUMENT search — the MCP
 *  tool of the same name fuses four surfaces. Same name, different retrieval
 *  surface, and nothing in the answer said so (graph-boundaries B3). Every
 *  answer now names what was searched and what was not, so an agent that got
 *  nothing back knows where else to look rather than concluding the org knows
 *  nothing. */
const DOCUMENT_SEARCH_SURFACES =
  'Searched: Second Brain document index (this project + the personal global brain). ' +
  'Not searched: the org memory knowledge graph (use org_recall) or the Monograph code graph (use the monograph_* tools).';

/** knowledge_search implementation for org agents: the user's Second Brain
 *  (this project's documents + the personal global brain), merged with the
 *  same project-first ranking every other surface uses. Failures return a
 *  message, never throw into the tool call. */
export async function searchProjectKnowledge(
  root: string,
  query: string,
): Promise<{ text: string; hits: number }> {
  try {
    const { searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const excerpts = await searchKnowledge(query, { rootDir: root, limit: 3, store: 'all' });
    if (!excerpts.length)
      return {
        text: `No matching documents in the Second Brain for that query.\n\n${DOCUMENT_SEARCH_SURFACES}`,
        hits: 0,
      };
    const text = excerpts
      .map(
        (e, i) =>
          `${i + 1}. [${e.filePath || 'unknown'}${e.scope === 'global' ? ' · global' : ''}] (${e.similarity.toFixed(2)})\n${e.text.slice(0, 400)}`,
      )
      .join('\n\n');
    return { text: `${text}\n\n${DOCUMENT_SEARCH_SURFACES}`, hits: excerpts.length };
  } catch (err) {
    return {
      text: `document search unavailable (${err instanceof Error ? err.message : 'error'}) — this is a failure, not an empty Second Brain. ${DOCUMENT_SEARCH_SURFACES}`,
      hits: 0,
    };
  }
}

/** org_learn implementation: merge coordinator-extracted entities/relations/
 *  rules into the org's knowledge graph (LLM extraction happens inside the
 *  agent's own subscription-auth SDK session — no separate LLM call here). */
export async function learnOrgKnowledge(
  daemon: OrgDaemon,
  name: string,
  run: string,
  payload: { nodes?: unknown[]; edges?: unknown[]; rules?: unknown[] },
): Promise<string> {
  try {
    if (!(await orgMemoryUsable(daemon.root)))
      return 'org memory is not available in this environment.';
    const kg = await import('../memory/memory-kg.js');
    const dbPath = orgMemoryDbPath(daemon.root);
    const originRef = `run:${run}`;
    // Scoped: this org's claims land in this org's namespaces, and their
    // origin refs record which org asserted them. Nothing here reaches the
    // project-shared graph — that takes an explicit `kgPromote`.
    const scope = orgKgScope(name);
    const graph = await kg.kgIngest({
      nodes: (payload.nodes ?? []) as import('../memory/memory-kg.js').KgNodeInput[],
      edges: (payload.edges ?? []) as import('../memory/memory-kg.js').KgEdgeInput[],
      originRef,
      scope,
      dbPath,
    });
    const rules =
      Array.isArray(payload.rules) && payload.rules.length
        ? await kg.kgIngestRules({
            rules: payload.rules as { rule: string; context?: string }[],
            originRef,
            scope,
            dbPath,
          })
        : null;
    // kgIngest/kgIngestRules report what actually persisted. Believing them is
    // the point: marking the run learned on a refused write both lied to the
    // coordinator and suppressed the heuristic fallback in storeRunMemory, so
    // the run ended with nothing in the graph and nothing to notice it
    // (memory-KG K1, org side).
    const failed = !graph.success || rules?.success === false;
    if (!failed) daemon.orgLearnedRuns.add(`${name}:${run}`);

    const parts = [
      `entities: +${graph.nodesAdded} new, ${graph.nodesMerged} merged`,
      `relations: +${graph.edgesAdded} new, ${graph.edgesMerged} merged`,
    ];
    if (rules)
      parts.push(
        `rules: ${rules.accepted} accepted, ${rules.verdicts.filter((v) => v.verdict === 'already_known').length} already known`,
      );
    if (!failed)
      return `Recorded in org knowledge graph — ${parts.join('; ')}. Rollback ref: ${originRef}.`;

    const problems = [...(graph.failures ?? []), ...(rules?.failures ?? [])];
    const why = problems.length
      ? ` Rejected writes: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}.`
      : ` ${graph.error ?? rules?.error ?? 'the store refused one or more writes'}.`;
    return (
      `Partially recorded in org knowledge graph — counts below are what actually persisted: ${parts.join('; ')}.` +
      `${why} The run is NOT marked learned, so end-of-run heuristic extraction will still run. Rollback ref: ${originRef}.`
    );
  } catch (err) {
    return `org_learn failed (${err instanceof Error ? err.message : 'error'})`;
  }
}

/** Persist the run's outcome into cross-run org memory so org_recall (and
 *  future runs) can find it by meaning, not just recency. Best-effort. */
export async function storeRunMemory(
  daemon: OrgDaemon,
  name: string,
  def: OrgDef,
  run: string,
  summary: RunSummary,
): Promise<void> {
  try {
    if (!(await orgMemoryUsable(daemon.root))) return;
    const { bridgeStoreEntry } = await import('../memory/memory-bridge.js');
    const dbPath = orgMemoryDbPath(daemon.root);
    const when = summary.endedAt ? new Date(summary.endedAt).toISOString().slice(0, 10) : '';
    const lines = [
      `Org run ${run}${when ? ` (${when})` : ''} — goal: ${def.goal}`,
      summary.outcome
        ? `Outcome: ${summary.outcome.status} — ${summary.outcome.summary}`
        : `Outcome: not recorded (${summary.messages} messages exchanged)`,
      summary.assets.length ? `Assets produced: ${summary.assets.slice(0, 10).join(', ')}` : '',
      summary.crashes.length ? `Crashed agents: ${summary.crashes.join(', ')}` : '',
    ].filter(Boolean);
    await bridgeStoreEntry({
      key: `run-${run}`,
      value: lines.join('\n'),
      namespace: orgMemoryNamespace(name, def),
      dbPath,
      upsert: true,
    });

    // Heuristic KG fallback: if the coordinator never called org_learn this
    // run, extract lower-trust entities from the outcome summary so the
    // graph still accumulates something. LLM-quality extraction only comes
    // from org_learn (the agent's own session).
    if (!daemon.orgLearnedRuns.delete(`${name}:${run}`)) {
      try {
        const kg = await import('../memory/memory-kg.js');
        const extracted = kg.heuristicExtract(lines.join('\n'), { sourceName: `run:${run}` });
        if (extracted.nodes.length) {
          await kg.kgIngest({
            ...extracted,
            originRef: `run:${run}`,
            scope: orgKgScope(name),
            dbPath,
          });
        }
      } catch {
        /* best effort */
      }
    }

    // Auto-rate the memories this run recalled — POSITIVE-ONLY: a failed run
    // proves nothing about the recalled memories (the failure may be entirely
    // unrelated), so failure never rates them down. Idempotent per run via
    // the feedback ledger, so a retried stopOrg can't double-apply.
    const used = daemon.recallUsage.get(name);
    daemon.recallUsage.delete(name);
    if (used?.size && summary.outcome?.status === 'achieved') {
      const { bridgeApplyFeedback } = await import('../memory/memory-bridge.js');
      await bridgeApplyFeedback({
        entryIds: [...used],
        score: 0.9,
        ledgerKey: `org-${name}-${run}`,
        dbPath,
      }).catch(() => {
        /* best effort */
      });
    }
  } catch (err) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error(
        `org ${name}: run memory store failed:`,
        err instanceof Error ? err.message : err,
      );
  }
}

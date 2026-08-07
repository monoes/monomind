// packages/@monomind/cli/src/orgrt/org-memory.ts
// Extracted from daemon.ts — org cross-run memory, recall, learn, knowledge search.
import { join } from 'node:path';
import type { OrgDef } from './types.js';
import type { RunSummary } from './reporting.js';
import type { OrgDaemon } from './daemon.js';

export function orgMemoryNamespace(name: string, def: OrgDef): string {
  return def.run_config.memory_namespace ?? `org:${name}`;
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
    const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
    return real(got) === real(want);
  } catch { return false; }
}

/** Namespace for a role's PRIVATE memories, inside the org memory DB. */
export function agentMemoryNamespace(name: string, def: OrgDef, role: string): string {
  return `agent:${orgMemoryNamespace(name, def)}:${role}`;
}

/** org_remember implementation: a deliberate write to org-shared or
 *  role-private memory (both in the org memory DB, split by namespace). */
export async function rememberOrgMemory(root: string, name: string, def: OrgDef, role: string, content: string, scope: 'org' | 'agent', run: string): Promise<string> {
  try {
    if (!(await orgMemoryUsable(root))) return 'org memory is not available in this environment.';
    const { bridgeStoreEntry } = await import('../memory/memory-bridge.js');
    const namespace = scope === 'agent' ? agentMemoryNamespace(name, def, role) : orgMemoryNamespace(name, def);
    const res = await bridgeStoreEntry({
      key: `mem-${run}-${Date.now().toString(36)}`,
      value: content.slice(0, 20_000),
      namespace,
      dbPath: orgMemoryDbPath(root),
      tags: [scope, role],
      metadata: { origin_refs: [`run:${run}`], by: role },
    });
    if (res?.duplicate) return `Already remembered (near-duplicate exists) — reinforced instead.`;
    return res?.success ? `Remembered (${scope} scope).` : `Could not store memory${res?.error ? `: ${res.error}` : ''}.`;
  } catch (err) {
    return `org_remember failed (${err instanceof Error ? err.message : 'error'})`;
  }
}

/** org_recall implementation: search the org's memory namespace via the
 *  memory bridge (semantic when the local model is available, tokenized
 *  keyword otherwise). Failures return a message, never throw into the tool. */
export async function recallOrgMemory(daemon: OrgDaemon, name: string, def: OrgDef, query: string, role?: string): Promise<{ text: string; hits: number }> {
  try {
    if (!(await orgMemoryUsable(daemon.root))) return { text: 'org memory is not available in this environment.', hits: 0 };
    const bridge = await import('../memory/memory-bridge.js');
    const dbPath = orgMemoryDbPath(daemon.root);
    // Shared org memory plus the caller's private agent scope, merged by score.
    const [shared, priv] = await Promise.all([
      bridge.bridgeSearchEntries({
        query, namespace: orgMemoryNamespace(name, def), limit: 5, dbPath,
      }),
      role ? bridge.bridgeSearchEntries({
        query, namespace: agentMemoryNamespace(name, def, role), limit: 3, dbPath,
      }) : null,
    ]);
    const results = [
      ...(shared?.results ?? []),
      ...(priv?.results ?? []).map(r => ({ ...r, key: `${r.key} (private)` })),
    ].sort((a, b) => b.score - a.score).slice(0, 6);
    if (!results.length) return { text: 'No matching org memory found — this may be the first run covering this topic.', hits: 0 };
    const ids = results.map(r => r.id).filter(Boolean);
    let used = daemon.recallUsage.get(name);
    if (!used) { used = new Set(); daemon.recallUsage.set(name, used); }
    for (const id of ids) used.add(id);
    // Frequency reinforcement is immediate; the feedback rating waits for the
    // run outcome (positive-only — see storeRunMemory).
    bridge.bridgeRecordUsage({ entryIds: ids, dbPath }).catch(() => { /* best effort */ });
    let text = results.map((r, i) => `${i + 1}. [${r.key}] ${r.content.slice(0, 500)}`).join('\n\n');
    // Structured knowledge: relationship triplets from the org KG, when any.
    try {
      const kg = await import('../memory/memory-kg.js');
      const graph = await kg.kgSearch({ query, dbPath, limit: 5 });
      if (graph.context) text += `\n\nKnowledge graph:\n${graph.context.slice(0, 1024)}`;
    } catch { /* best effort */ }
    return { text, hits: results.length };
  } catch (err) {
    return { text: `org memory unavailable (${err instanceof Error ? err.message : 'error'})`, hits: 0 };
  }
}

/** knowledge_search implementation for org agents: the user's Second Brain
 *  (this project's documents + the personal global brain), merged with the
 *  same project-first ranking every other surface uses. Failures return a
 *  message, never throw into the tool call. */
export async function searchProjectKnowledge(root: string, query: string): Promise<{ text: string; hits: number }> {
  try {
    const { searchKnowledge } = await import('../knowledge/document-pipeline.js');
    const excerpts = await searchKnowledge(query, { rootDir: root, limit: 3, store: 'all' });
    if (!excerpts.length) return { text: 'No matching documents in the Second Brain for that query.', hits: 0 };
    const text = excerpts.map((e, i) =>
      `${i + 1}. [${e.filePath || 'unknown'}${e.scope === 'global' ? ' · global' : ''}] (${e.similarity.toFixed(2)})\n${e.text.slice(0, 400)}`
    ).join('\n\n');
    return { text, hits: excerpts.length };
  } catch (err) {
    return { text: `knowledge search unavailable (${err instanceof Error ? err.message : 'error'})`, hits: 0 };
  }
}

/** org_learn implementation: merge coordinator-extracted entities/relations/
 *  rules into the org's knowledge graph (LLM extraction happens inside the
 *  agent's own subscription-auth SDK session — no separate LLM call here). */
export async function learnOrgKnowledge(daemon: OrgDaemon, name: string, run: string, payload: { nodes?: unknown[]; edges?: unknown[]; rules?: unknown[] }): Promise<string> {
  try {
    if (!(await orgMemoryUsable(daemon.root))) return 'org memory is not available in this environment.';
    const kg = await import('../memory/memory-kg.js');
    const dbPath = orgMemoryDbPath(daemon.root);
    const originRef = `run:${run}`;
    const graph = await kg.kgIngest({
      nodes: (payload.nodes ?? []) as import('../memory/memory-kg.js').KgNodeInput[],
      edges: (payload.edges ?? []) as import('../memory/memory-kg.js').KgEdgeInput[],
      originRef, dbPath,
    });
    const rules = Array.isArray(payload.rules) && payload.rules.length
      ? await kg.kgIngestRules({ rules: payload.rules as { rule: string; context?: string }[], originRef, dbPath })
      : null;
    daemon.orgLearnedRuns.add(`${name}:${run}`);
    const parts = [
      `entities: +${graph.nodesAdded} new, ${graph.nodesMerged} merged`,
      `relations: +${graph.edgesAdded} new, ${graph.edgesMerged} merged`,
    ];
    if (rules) parts.push(`rules: ${rules.accepted} accepted, ${rules.verdicts.filter(v => v.verdict === 'already_known').length} already known`);
    return `Recorded in org knowledge graph — ${parts.join('; ')}. Rollback ref: ${originRef}.`;
  } catch (err) {
    return `org_learn failed (${err instanceof Error ? err.message : 'error'})`;
  }
}

/** Persist the run's outcome into cross-run org memory so org_recall (and
 *  future runs) can find it by meaning, not just recency. Best-effort. */
export async function storeRunMemory(daemon: OrgDaemon, name: string, def: OrgDef, run: string, summary: RunSummary): Promise<void> {
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
          await kg.kgIngest({ ...extracted, originRef: `run:${run}`, dbPath });
        }
      } catch { /* best effort */ }
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
      }).catch(() => { /* best effort */ });
    }
  } catch (err) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error(`org ${name}: run memory store failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Reflexion worker (P2-15) — self-learning from task failures.
 *
 * Implements the Reflexion pattern (NeurIPS 2023): stores self-reflection on
 * failures in memory, feeds as context on next similar attempt. This is the
 * simplest possible self-learning loop — no trace corpus needed, no GEPA, no
 * training pipeline. Just: "task failed → record what happened → retrieve on
 * similar future task."
 *
 * Bootstraps the trace corpus that future GEPA-based evolution (P3) needs.
 * Run with: `monomind hooks worker run reflexion`
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkerHandler, WorkerResult } from './worker-manager.js';

/**
 * Shape of a route-outcomes.jsonl record, as actually written by
 * recordRoute()/joinOutcome() in
 * packages/@monomind/cli/src/monovector/route-outcomes.ts. Notably: the
 * task description field is `task` (not `taskDescription`), the recommended
 * agent is `recommendedAgent` (not `agentType`), success is `measuredSuccess`
 * (not `success`), the timestamp `ts` is a numeric epoch-ms value (not an
 * ISO string), and there is no `error` field at all — outcome records don't
 * carry failure text, only pass/fail.
 */
interface RouteOutcome {
  routeId?: string;
  ts?: number;
  task?: string;
  recommendedAgent?: string;
  agentActuallyUsed?: string;
  measuredSuccess?: boolean;
  quality?: number;
  /**
   * Not part of the real route-outcomes.jsonl schema — outcome records only
   * carry pass/fail, no failure text. Kept optional here so the reflection
   * template degrades gracefully (falls back to a placeholder) rather than
   * assuming this field exists.
   */
  error?: string;
}

interface Reflection {
  id: string;
  /** routeId + task + ts of the source outcome record, used to dedup across runs. */
  sourceKey: string;
  taskDescription: string;
  agentType: string;
  error: string;
  timestamp: string;
  reflection: string;
  keywords: string[];
}

const REFLEXION_STORE = '.monomind/reflexion-store.json';
const ROUTE_OUTCOMES = '.monomind/route-outcomes.jsonl';

export function createReflexionWorker(projectRoot: string): WorkerHandler {
  return async (): Promise<WorkerResult> => {
    const startTime = Date.now();
    const outcomesPath = path.join(projectRoot, ROUTE_OUTCOMES);
    const storePath = path.join(projectRoot, REFLEXION_STORE);
    const ts = new Date();

    // Read route outcomes
    let outcomes: RouteOutcome[] = [];
    try {
      const content = await fs.readFile(outcomesPath, 'utf-8');
      for (const line of content.trim().split('\n')) {
        if (!line) continue;
        try {
          outcomes.push(JSON.parse(line) as RouteOutcome);
        } catch { /* skip malformed lines */ }
      }
    } catch {
      return {
        worker: 'reflexion', success: true, duration: Date.now() - startTime, timestamp: ts,
        data: { outcomesProcessed: 0, reflectionsGenerated: 0, reason: 'No route-outcomes.jsonl found' },
      };
    }

    // Filter for failures. Real records report failure via `measuredSuccess
    // === false` and the task text lives in `task` (not `success` /
    // `taskDescription`, which don't exist on the real record shape).
    const failures = outcomes.filter(o => o.measuredSuccess === false && o.task);
    if (failures.length === 0) {
      return {
        worker: 'reflexion', success: true, duration: Date.now() - startTime, timestamp: ts,
        data: { outcomesProcessed: outcomes.length, reflectionsGenerated: 0, reason: 'No failures to reflect on' },
      };
    }

    // Load existing reflections (dedup by source record identity)
    let existing: Reflection[] = [];
    try {
      const content = await fs.readFile(storePath, 'utf-8');
      existing = JSON.parse(content) as Reflection[];
    } catch { /* first run */ }
    // There's no `error` field in the real schema to dedup on, so dedup
    // uses the source outcome record's identity (routeId + task + ts) instead.
    const dedupKey = (o: RouteOutcome) => `${o.routeId ?? ''}::${o.task ?? ''}::${o.ts ?? ''}`;
    const existingKeys = new Set(existing.map(r => r.sourceKey));

    // Generate reflections for new failures
    const newReflections: Reflection[] = [];
    for (const failure of failures) {
      const key = dedupKey(failure);
      if (existingKeys.has(key)) continue;

      const keywords = (failure.task || '')
        .toLowerCase()
        .split(/[\s,;:.()/[\]{}'"-]+/)
        .filter(w => w.length > 3 && !['the', 'this', 'that', 'with', 'from', 'have', 'been', 'will', 'into', 'your'].includes(w))
        .slice(0, 8);

      // Real route-outcomes.jsonl records use a numeric epoch-ms `ts`, not a
      // timestamp string — convert explicitly rather than treating it as one.
      const timestamp = typeof failure.ts === 'number' ? new Date(failure.ts).toISOString() : new Date().toISOString();

      newReflections.push({
        id: `reflection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceKey: key,
        taskDescription: failure.task || '(unknown)',
        agentType: failure.recommendedAgent || '(unknown)',
        error: failure.error || '(no error message)',
        timestamp,
        reflection: generateReflection(failure),
        keywords,
      });
      existingKeys.add(key);
    }

    if (newReflections.length === 0) {
      return {
        worker: 'reflexion', success: true, duration: Date.now() - startTime, timestamp: ts,
        data: { outcomesProcessed: outcomes.length, reflectionsGenerated: 0, totalReflections: existing.length, reason: 'All failures already reflected' },
      };
    }

    // Save merged reflections (cap at 500)
    const merged = [...existing, ...newReflections].slice(-500);
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(merged, null, 2), 'utf-8');

    return {
      worker: 'reflexion', success: true, duration: Date.now() - startTime, timestamp: ts,
      data: {
        outcomesProcessed: outcomes.length,
        failuresFound: failures.length,
        reflectionsGenerated: newReflections.length,
        totalReflections: merged.length,
      },
    };
  };
}

/**
 * Generate a deterministic reflection from a failure outcome.
 * No LLM call — this is a template-based v1. Future versions (GEPA/P3) will
 * use natural-language reflection on execution traces.
 */
function generateReflection(failure: RouteOutcome): string {
  const task = failure.task || 'the task';
  const agent = failure.recommendedAgent || 'the agent';
  // Real route-outcomes.jsonl records carry no failure text — this is
  // expected, not a bug; degrade to a placeholder rather than printing
  // "undefined".
  const error = failure.error || '(no error message)';

  return `When "${task}" was routed to ${agent}, it failed with: ${error}. ` +
    `Next time this task type is attempted, consider: (1) a different agent type, ` +
    `(2) breaking the task into smaller steps, (3) checking prerequisites before starting. ` +
    `This reflection was generated automatically by the Reflexion worker (P2-15).`;
}

/**
 * Retrieve relevant reflections for a given task description.
 * Used by the pre-task hook to inject past failures as context.
 * Keyword-based matching — no embeddings needed for v1.
 */
export async function getReflectionsForTask(projectRoot: string, taskDescription: string, limit = 3): Promise<Reflection[]> {
  const storePath = path.join(projectRoot, REFLEXION_STORE);
  let reflections: Reflection[] = [];
  try {
    const content = await fs.readFile(storePath, 'utf-8');
    reflections = JSON.parse(content) as Reflection[];
  } catch {
    return [];
  }

  const taskWords = new Set(
    taskDescription.toLowerCase()
      .split(/[\s,;:.()/[\]{}'"-]+/)
      .filter(w => w.length > 3)
  );

  // Score each reflection by keyword overlap
  const scored = reflections.map(r => ({
    reflection: r,
    score: r.keywords.filter(k => taskWords.has(k)).length,
  }));

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.reflection);
}

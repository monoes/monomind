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

interface RouteOutcome {
  taskId?: string;
  taskDescription?: string;
  agentType?: string;
  agentId?: string;
  success?: boolean;
  error?: string;
  timestamp?: string;
  durationMs?: number;
}

interface Reflection {
  id: string;
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

    // Filter for failures
    const failures = outcomes.filter(o => o.success === false && o.taskDescription);
    if (failures.length === 0) {
      return {
        worker: 'reflexion', success: true, duration: Date.now() - startTime, timestamp: ts,
        data: { outcomesProcessed: outcomes.length, reflectionsGenerated: 0, reason: 'No failures to reflect on' },
      };
    }

    // Load existing reflections (dedup by task+error)
    let existing: Reflection[] = [];
    try {
      const content = await fs.readFile(storePath, 'utf-8');
      existing = JSON.parse(content) as Reflection[];
    } catch { /* first run */ }
    const existingKeys = new Set(existing.map(r => `${r.taskDescription}::${r.error}`));

    // Generate reflections for new failures
    const newReflections: Reflection[] = [];
    for (const failure of failures) {
      const key = `${failure.taskDescription}::${failure.error}`;
      if (existingKeys.has(key)) continue;

      const keywords = (failure.taskDescription || '')
        .toLowerCase()
        .split(/[\s,;:.()/[\]{}'"-]+/)
        .filter(w => w.length > 3 && !['the', 'this', 'that', 'with', 'from', 'have', 'been', 'will', 'into', 'your'].includes(w))
        .slice(0, 8);

      newReflections.push({
        id: `reflection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskDescription: failure.taskDescription || '(unknown)',
        agentType: failure.agentType || '(unknown)',
        error: failure.error || '(no error message)',
        timestamp: failure.timestamp || new Date().toISOString(),
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
  const task = failure.taskDescription || 'the task';
  const agent = failure.agentType || 'the agent';
  const error = failure.error || 'an unknown error';
  const duration = failure.durationMs ? ` after ${(failure.durationMs / 1000).toFixed(1)}s` : '';

  return `When "${task}" was routed to ${agent}, it failed${duration} with: ${error}. ` +
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

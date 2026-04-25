/**
 * JSONL-backed store for persisting agent plans.
 * @packageDocumentation
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentPlan } from './types.js';

const PLANS_FILE = 'plans.jsonl';

/** Serialisable representation used inside the JSONL file. */
interface SerializedPlan extends Omit<AgentPlan, 'createdAt'> {
  createdAt: string;
}

/**
 * Append-only JSONL store for agent plans.
 *
 * Each line in the file is a JSON-serialised {@link AgentPlan}.
 */
export class PlanStore {
  private readonly filePath: string;

  constructor(dirPath: string) {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    this.filePath = join(dirPath, PLANS_FILE);
  }

  /** Append a plan to the store. */
  save(plan: AgentPlan): void {
    const serialized: SerializedPlan = {
      ...plan,
      createdAt: plan.createdAt.toISOString(),
    };
    appendFileSync(this.filePath, JSON.stringify(serialized) + '\n', 'utf-8');
  }

  /** Retrieve a single plan by id, or null if not found. */
  get(planId: string): AgentPlan | null {
    const plans = this.readAll();
    return plans.find((p) => p.planId === planId) ?? null;
  }

  /** List all plans produced by a given agent slug. */
  listByAgent(agentSlug: string): AgentPlan[] {
    return this.readAll().filter((p) => p.agentSlug === agentSlug);
  }

  /** Mark a plan as approved (rewrites the JSONL file). */
  approve(planId: string): void {
    const plans = this.readAll();
    const updated = plans.map((p) =>
      p.planId === planId ? { ...p, approved: true } : p,
    );
    const lines = updated.map((p) => {
      const s: SerializedPlan = { ...p, createdAt: p.createdAt.toISOString() };
      return JSON.stringify(s);
    });
    writeFileSync(this.filePath, lines.join('\n') + '\n', 'utf-8');
  }

  // ---- internal helpers ----

  private readAll(): AgentPlan[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    const content = readFileSync(this.filePath, 'utf-8').trim();
    if (!content) {
      return [];
    }
    return content.split('\n').map((line) => {
      const raw: SerializedPlan = JSON.parse(line);
      return {
        ...raw,
        createdAt: new Date(raw.createdAt),
      } as AgentPlan;
    });
  }
}

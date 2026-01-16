/**
 * Three-Mode Team Routing — Task 22
 *
 * Provides three orchestration modes:
 *  - route:       single-agent dispatch
 *  - coordinate:  planner → fan-out → synthesizer
 *  - collaborate: iterative A↔B with shared scratchpad
 */

import { SharedScratchpad } from '../../../shared/src/scratchpad.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestrationMode = 'route' | 'coordinate' | 'collaborate';

export interface RouteModeConfig {
  agentSlug: string;
  task: string;
}

export interface CoordinateModeConfig {
  plannerSlug?: string;       // default 'planner'
  synthesizerSlug?: string;   // default 'hierarchical-coordinator'
  task: string;
  maxSubtasks?: number;       // default 8
}

export interface CollaborateModeConfig {
  agentA: string;
  agentB: string;
  task: string;
  maxIterations?: number;     // default 5
  convergencePhrase?: string; // default 'APPROVED'
}

export interface ModeResult {
  mode: OrchestrationMode;
  output: unknown;
  agentsInvolved: string[];
  iterationCount: number;
  tokenUsage: { input: number; output: number };
  latencyMs: number;
}

export interface AgentDispatcher {
  dispatch(
    agentSlug: string,
    task: string,
    context?: string,
  ): Promise<{ output: unknown; tokenUsage?: { input: number; output: number } }>;
}

// ---------------------------------------------------------------------------
// Abstract executor
// ---------------------------------------------------------------------------

export abstract class ModeExecutor<TConfig> {
  constructor(protected readonly dispatcher: AgentDispatcher) {}
  abstract execute(config: TConfig): Promise<ModeResult>;
}

// ---------------------------------------------------------------------------
// Route mode — single dispatch
// ---------------------------------------------------------------------------

export class RouteModeExecutor extends ModeExecutor<RouteModeConfig> {
  async execute(config: RouteModeConfig): Promise<ModeResult> {
    const start = Date.now();
    const result = await this.dispatcher.dispatch(config.agentSlug, config.task);
    return {
      mode: 'route',
      output: result.output,
      agentsInvolved: [config.agentSlug],
      iterationCount: 1,
      tokenUsage: result.tokenUsage ?? { input: 0, output: 0 },
      latencyMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Coordinate mode — planner → fan-out → synthesizer
// ---------------------------------------------------------------------------

/**
 * Extract a subtasks array from the planner output.
 * Accepts either a raw array or JSON containing a `subtasks` key.
 */
export function parsePlan(output: unknown): string[] {
  if (Array.isArray(output)) return output.map(String);

  const raw = typeof output === 'string' ? output : JSON.stringify(output);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (Array.isArray(parsed.subtasks)) return parsed.subtasks.map(String);
  } catch {
    // not JSON — treat the whole string as a single subtask
  }
  return [raw];
}

export class CoordinateModeExecutor extends ModeExecutor<CoordinateModeConfig> {
  async execute(config: CoordinateModeConfig): Promise<ModeResult> {
    const start = Date.now();
    const plannerSlug = config.plannerSlug ?? 'planner';
    const synthesizerSlug = config.synthesizerSlug ?? 'hierarchical-coordinator';
    const maxSubtasks = config.maxSubtasks ?? 8;

    const totalTokens = { input: 0, output: 0 };
    const agents: string[] = [plannerSlug];

    // 1. Call planner
    const planResult = await this.dispatcher.dispatch(plannerSlug, config.task);
    this.addTokens(totalTokens, planResult.tokenUsage);

    // 2. Parse subtasks & cap
    const subtasks = parsePlan(planResult.output).slice(0, maxSubtasks);

    // 3. Fan-out
    const fanOutResults = await Promise.all(
      subtasks.map((subtask, i) => {
        const workerSlug = `worker-${i}`;
        agents.push(workerSlug);
        return this.dispatcher.dispatch(workerSlug, subtask);
      }),
    );
    for (const r of fanOutResults) this.addTokens(totalTokens, r.tokenUsage);

    // 4. Synthesize
    agents.push(synthesizerSlug);
    const synthesisContext = JSON.stringify(fanOutResults.map((r) => r.output));
    const synthResult = await this.dispatcher.dispatch(
      synthesizerSlug,
      'Synthesize the following results',
      synthesisContext,
    );
    this.addTokens(totalTokens, synthResult.tokenUsage);

    return {
      mode: 'coordinate',
      output: synthResult.output,
      agentsInvolved: agents,
      iterationCount: 1 + subtasks.length + 1, // planner + workers + synthesizer
      tokenUsage: totalTokens,
      latencyMs: Date.now() - start,
    };
  }

  private addTokens(
    total: { input: number; output: number },
    usage?: { input: number; output: number },
  ): void {
    if (usage) {
      total.input += usage.input;
      total.output += usage.output;
    }
  }
}

// ---------------------------------------------------------------------------
// Collaborate mode — iterative A↔B with shared scratchpad
// ---------------------------------------------------------------------------

export class CollaborateModeExecutor extends ModeExecutor<CollaborateModeConfig> {
  async execute(config: CollaborateModeConfig): Promise<ModeResult> {
    const start = Date.now();
    const maxIterations = config.maxIterations ?? 5;
    const convergencePhrase = config.convergencePhrase ?? 'APPROVED';

    const pad = new SharedScratchpad();
    const totalTokens = { input: 0, output: 0 };
    let lastOutput: unknown;

    for (let i = 0; i < maxIterations; i++) {
      // Agent A
      const aResult = await this.dispatcher.dispatch(
        config.agentA,
        config.task,
        pad.read(),
      );
      pad.append(config.agentA, String(aResult.output));
      this.addTokens(totalTokens, aResult.tokenUsage);

      // Agent B
      const bResult = await this.dispatcher.dispatch(
        config.agentB,
        config.task,
        pad.read(),
      );
      pad.append(config.agentB, String(bResult.output));
      this.addTokens(totalTokens, bResult.tokenUsage);
      lastOutput = bResult.output;

      // Convergence check
      if (String(bResult.output).includes(convergencePhrase)) {
        return {
          mode: 'collaborate',
          output: lastOutput,
          agentsInvolved: [config.agentA, config.agentB],
          iterationCount: i + 1,
          tokenUsage: totalTokens,
          latencyMs: Date.now() - start,
        };
      }
    }

    return {
      mode: 'collaborate',
      output: lastOutput,
      agentsInvolved: [config.agentA, config.agentB],
      iterationCount: maxIterations,
      tokenUsage: totalTokens,
      latencyMs: Date.now() - start,
    };
  }

  private addTokens(
    total: { input: number; output: number },
    usage?: { input: number; output: number },
  ): void {
    if (usage) {
      total.input += usage.input;
      total.output += usage.output;
    }
  }
}

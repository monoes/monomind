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
// Abstract executor
// ---------------------------------------------------------------------------
const SLUG_RE = /^[a-z0-9][a-z0-9\-]{0,63}$/;
const MAX_TASK_BYTES = 64 * 1024;
function assertSlug(value, name) {
    if (!SLUG_RE.test(value))
        throw new Error(`Invalid agent slug for ${name}: ${JSON.stringify(value)}`);
}
function assertTask(task) {
    if (!task || task.trim().length === 0)
        throw new Error('task must not be empty');
    if (task.length > MAX_TASK_BYTES)
        throw new Error(`task exceeds maximum length (${MAX_TASK_BYTES} bytes)`);
}
export class ModeExecutor {
    dispatcher;
    constructor(dispatcher) {
        this.dispatcher = dispatcher;
    }
}
// ---------------------------------------------------------------------------
// Route mode — single dispatch
// ---------------------------------------------------------------------------
export class RouteModeExecutor extends ModeExecutor {
    async execute(config) {
        assertSlug(config.agentSlug, 'agentSlug');
        assertTask(config.task);
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
export function parsePlan(output) {
    if (Array.isArray(output))
        return output.map(String);
    const raw = typeof output === 'string' ? output : JSON.stringify(output);
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return parsed.map(String);
        if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.subtasks))
            return parsed.subtasks.map(String);
    }
    catch {
        // not JSON — treat the whole string as a single subtask
    }
    return [raw];
}
export class CoordinateModeExecutor extends ModeExecutor {
    async execute(config) {
        assertTask(config.task);
        const start = Date.now();
        const plannerSlug = config.plannerSlug ?? 'planner';
        const synthesizerSlug = config.synthesizerSlug ?? 'hierarchical-coordinator';
        assertSlug(plannerSlug, 'plannerSlug');
        assertSlug(synthesizerSlug, 'synthesizerSlug');
        const maxSubtasks = config.maxSubtasks ?? 8;
        const totalTokens = { input: 0, output: 0 };
        const agents = [plannerSlug];
        // 1. Call planner
        const planResult = await this.dispatcher.dispatch(plannerSlug, config.task);
        this.addTokens(totalTokens, planResult.tokenUsage);
        // 2. Parse subtasks & cap
        const subtasks = parsePlan(planResult.output).slice(0, maxSubtasks);
        // 3. Fan-out
        const fanOutResults = await Promise.all(subtasks.map((subtask, i) => {
            const workerSlug = `worker-${i}`;
            agents.push(workerSlug);
            return this.dispatcher.dispatch(workerSlug, subtask);
        }));
        for (const r of fanOutResults)
            this.addTokens(totalTokens, r.tokenUsage);
        // 4. Synthesize
        agents.push(synthesizerSlug);
        const synthesisContext = JSON.stringify(fanOutResults.map((r) => r.output));
        const synthResult = await this.dispatcher.dispatch(synthesizerSlug, 'Synthesize the following results', synthesisContext);
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
    addTokens(total, usage) {
        if (usage) {
            total.input += usage.input;
            total.output += usage.output;
        }
    }
}
// ---------------------------------------------------------------------------
// Collaborate mode — iterative A↔B with shared scratchpad
// ---------------------------------------------------------------------------
export class CollaborateModeExecutor extends ModeExecutor {
    async execute(config) {
        assertTask(config.task);
        assertSlug(config.agentA, 'agentA');
        assertSlug(config.agentB, 'agentB');
        const start = Date.now();
        // Cap iterations: each iteration costs 2 LLM dispatches; an unbounded value
        // turns this into an unbounded token-cost / OOM vector.
        const maxIterations = Math.max(1, Math.min(config.maxIterations ?? 5, 20));
        // Reject empty/short convergence phrase — empty string would make
        // String(bResult.output).includes('') return true on iteration 1, bypassing
        // the entire iterative review and locking in whatever Agent B produced.
        const rawPhrase = (config.convergencePhrase ?? 'APPROVED').trim();
        const convergencePhrase = rawPhrase.length >= 3 ? rawPhrase : 'APPROVED';
        const pad = new SharedScratchpad();
        const totalTokens = { input: 0, output: 0 };
        let lastOutput;
        for (let i = 0; i < maxIterations; i++) {
            // Agent A
            const aResult = await this.dispatcher.dispatch(config.agentA, config.task, pad.read());
            pad.append(config.agentA, String(aResult.output));
            this.addTokens(totalTokens, aResult.tokenUsage);
            // Agent B
            const bResult = await this.dispatcher.dispatch(config.agentB, config.task, pad.read());
            pad.append(config.agentB, String(bResult.output));
            this.addTokens(totalTokens, bResult.tokenUsage);
            lastOutput = bResult.output;
            // Convergence check — require the phrase as a stand-alone token so that
            // an attacker who controls Agent A's output cannot embed `APPROVED` in
            // prose and force premature convergence on iteration 1.
            const escaped = convergencePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const convergenceRe = new RegExp(`(^|\\W)${escaped}(\\W|$)`);
            if (convergenceRe.test(String(bResult.output))) {
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
    addTokens(total, usage) {
        if (usage) {
            total.input += usage.input;
            total.output += usage.output;
        }
    }
}
//# sourceMappingURL=routing-modes.js.map
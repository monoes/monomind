import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  activeTrajectories,
  getRealStoreFunction,
  getSONAOptimizer,
  type TrajectoryData,
} from './hooks-embedding.js';
import { getProjectCwd, type MCPTool } from './types.js';

// Intelligence reset hook
export const hooksIntelligenceReset: MCPTool = {
  name: 'hooks_intelligence-reset',
  description: 'Reset intelligence learning state',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const cwd = getProjectCwd();
    const cleared = {
      trajectories: 0,
      patterns: 0,
      dataFiles: 0,
      neuralFiles: 0,
    };
    const deletedFiles: string[] = [];
    const failedFiles: string[] = [];

    // Clear intelligence data files if they exist
    const dataFiles = [
      join(cwd, '.monomind', 'data', 'auto-memory-store.json'),
      join(cwd, '.monomind', 'data', 'graph-state.json'),
      join(cwd, '.monomind', 'data', 'ranked-context.json'),
    ];

    for (const filePath of dataFiles) {
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath);
          cleared.dataFiles++;
          deletedFiles.push(filePath);
        } catch {
          failedFiles.push(filePath);
        }
      }
    }

    // Clear neural directory if it exists
    const neuralDir = join(cwd, '.monomind', 'neural');
    if (existsSync(neuralDir)) {
      try {
        const files = readdirSync(neuralDir);
        for (const file of files) {
          const filePath = join(neuralDir, file);
          try {
            unlinkSync(filePath);
            cleared.neuralFiles++;
            deletedFiles.push(filePath);
          } catch {
            failedFiles.push(filePath);
          }
        }
      } catch {
        failedFiles.push(neuralDir);
      }
    }

    // Clear in-memory trajectories
    cleared.trajectories = activeTrajectories.size;
    activeTrajectories.clear();

    return {
      reset: failedFiles.length === 0,
      cleared,
      deletedFiles,
      failedFiles,
      timestamp: new Date().toISOString(),
    };
  },
};

// Intelligence trajectory hooks - REAL implementation using activeTrajectories
export const hooksTrajectoryStart: MCPTool = {
  name: 'hooks_intelligence_trajectory-start',
  description: 'Begin recording a task trajectory (task, agent, steps)',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description' },
      agent: { type: 'string', description: 'Agent type' },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    // Cap task and agent lengths to prevent the trajectory map from accumulating
    // large strings (up to MAX_TRAJECTORIES × uncapped length = potential GB of RAM).
    const MAX_TASK_LEN = 4 * 1024; // 4 KB — same cap as trajectory-step fields
    const MAX_AGENT_LEN = 256;
    const rawTask = params.task as string;
    const task =
      typeof rawTask === 'string' && rawTask.length > MAX_TASK_LEN
        ? rawTask.slice(0, MAX_TASK_LEN)
        : rawTask;
    const rawAgent = (params.agent as string) || 'coder';
    const agent =
      typeof rawAgent === 'string' && rawAgent.length > MAX_AGENT_LEN
        ? rawAgent.slice(0, MAX_AGENT_LEN)
        : rawAgent;
    const trajectoryId = `traj-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const startedAt = new Date().toISOString();

    // Create real trajectory entry in memory
    const trajectory: TrajectoryData = {
      id: trajectoryId,
      task,
      agent,
      steps: [],
      startedAt,
    };

    const MAX_TRAJECTORIES = 10000;
    if (activeTrajectories.size >= MAX_TRAJECTORIES) {
      // Evict the oldest trajectory
      const oldest = activeTrajectories.keys().next().value;
      if (oldest) activeTrajectories.delete(oldest);
    }
    activeTrajectories.set(trajectoryId, trajectory);

    return {
      trajectoryId,
      task,
      agent,
      started: startedAt,
      status: 'recording',
      implementation: 'real-trajectory-tracking',
      activeCount: activeTrajectories.size,
    };
  },
};

export const hooksTrajectoryStep: MCPTool = {
  name: 'hooks_intelligence_trajectory-step',
  description: 'Record a step in an active trajectory',
  inputSchema: {
    type: 'object',
    properties: {
      trajectoryId: { type: 'string', description: 'Trajectory ID' },
      action: { type: 'string', description: 'Action taken' },
      result: { type: 'string', description: 'Action result' },
      quality: { type: 'number', description: 'Quality score (0-1)' },
    },
    required: ['trajectoryId', 'action'],
  },
  handler: async (params: Record<string, unknown>) => {
    const trajectoryId = params.trajectoryId as string;
    // Cap action and result strings to prevent unbounded in-memory growth when
    // trajectory-step is called many times with large payloads.
    const MAX_STEP_STRING_LEN = 4 * 1024; // 4 KB per field
    const MAX_STEPS_PER_TRAJECTORY = 1000;
    const rawAction = params.action as string;
    const rawResult = (params.result as string) || 'success';
    const action =
      typeof rawAction === 'string' && rawAction.length > MAX_STEP_STRING_LEN
        ? rawAction.slice(0, MAX_STEP_STRING_LEN)
        : rawAction;
    const result =
      typeof rawResult === 'string' && rawResult.length > MAX_STEP_STRING_LEN
        ? rawResult.slice(0, MAX_STEP_STRING_LEN)
        : rawResult;
    const quality = (params.quality as number) || 0.85;
    const timestamp = new Date().toISOString();
    const stepId = `step-${Date.now()}`;

    // Add step to real trajectory if it exists
    const trajectory = activeTrajectories.get(trajectoryId);
    if (trajectory) {
      if (trajectory.steps.length >= MAX_STEPS_PER_TRAJECTORY) {
        // Drop the oldest step to keep the array bounded
        trajectory.steps.shift();
      }
      trajectory.steps.push({
        action,
        result,
        quality,
        timestamp,
      });
    }

    return {
      trajectoryId,
      stepId,
      action,
      result,
      quality,
      recorded: !!trajectory,
      timestamp,
      totalSteps: trajectory?.steps.length || 0,
      implementation: trajectory ? 'real-step-recording' : 'trajectory-not-found',
    };
  },
};

export const hooksTrajectoryEnd: MCPTool = {
  name: 'hooks_intelligence_trajectory-end',
  description:
    'End a trajectory: persist it to the trajectories memory namespace and update the SONA keyword-to-agent routing pattern confidence (no model is trained)',
  inputSchema: {
    type: 'object',
    properties: {
      trajectoryId: { type: 'string', description: 'Trajectory ID' },
      success: { type: 'boolean', description: 'Overall success' },
      feedback: { type: 'string', description: 'Optional feedback' },
    },
    required: ['trajectoryId'],
  },
  handler: async (params: Record<string, unknown>) => {
    const trajectoryId = params.trajectoryId as string;
    const success = params.success !== false;
    const feedback = params.feedback as string | undefined;
    const endedAt = new Date().toISOString();
    const startTime = Date.now();

    // Get and finalize real trajectory
    const trajectory = activeTrajectories.get(trajectoryId);
    let persistResult: { success: boolean; id?: string; error?: string } = { success: false };

    if (trajectory) {
      trajectory.success = success;
      trajectory.endedAt = endedAt;

      // Persist trajectory to database using real store
      const storeFn = await getRealStoreFunction();
      if (storeFn) {
        try {
          persistResult = await storeFn({
            key: `trajectory-${trajectoryId}`,
            value: JSON.stringify({
              ...trajectory,
              feedback,
            }),
            namespace: 'trajectories',
            generateEmbeddingFlag: true, // Generate embedding for semantic search
            tags: [trajectory.agent, success ? 'success' : 'failure', 'sona-trajectory'],
          });
        } catch (error) {
          persistResult = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // Remove from active trajectories
      activeTrajectories.delete(trajectoryId);

      // Bridge to the local intelligence ReasoningBank/SONA confidence-learning
      // loop (src/memory/intelligence.ts). Previously this handler only wrote
      // to the legacy JSON memory store (namespace 'trajectories') and the
      // SONA routing optimizer's .swarm/sona-patterns.json — neither of which
      // the ReasoningBank read from live, so trajectories recorded through
      // this MCP tool (the path Claude Code actually calls) never fed the
      // pattern store that `findSimilarPatterns`/`suggestAgentsFromIntelligence`
      // read from. Recording a summary 'result' step here generates an
      // embedding, stores a searchable pattern, and — because type 'result'
      // triggers intelligence.ts's endTrajectory+distillLearning — applies
      // the success/failure verdict to any semantically similar patterns.
      try {
        const intel = await import('../memory/intelligence.js');
        await intel.initializeIntelligence();
        const summary = `Task: ${trajectory.task} | Agent: ${trajectory.agent} | Steps: ${trajectory.steps.length} | Success: ${success}${feedback ? ` | Feedback: ${feedback}` : ''}`;
        await intel.recordStep({
          type: 'result',
          content: summary,
          metadata: {
            verdict: success ? 'success' : 'failure',
            trajectoryId,
            agent: trajectory.agent,
          },
        });
      } catch (e) {
        // Non-fatal: intelligence bridge unavailable, trajectory is still
        // persisted via the legacy store above.
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
          console.error('[hooks-intelligence] intelligence bridge recordStep failed:', e);
      }
    }

    // SONA Learning - process trajectory outcome for routing optimization
    let sonaResult: { learned: boolean; patternKey: string; confidence: number } = {
      learned: false,
      patternKey: '',
      confidence: 0,
    };
    const ewcResult: { consolidated: boolean; penalty: number } = {
      consolidated: false,
      penalty: 0,
    };

    if (trajectory && persistResult.success) {
      // Try SONA learning
      const sona = await getSONAOptimizer();
      if (sona) {
        try {
          const outcome = {
            trajectoryId,
            task: trajectory.task,
            agent: trajectory.agent,
            success,
            steps: trajectory.steps,
            feedback,
            duration: trajectory.startedAt
              ? new Date(endedAt).getTime() - new Date(trajectory.startedAt).getTime()
              : 0,
          };
          const result = sona.processTrajectoryOutcome(outcome);
          sonaResult = {
            learned: result.learned,
            patternKey: result.patternKey,
            confidence: result.confidence,
          };
        } catch (e) {
          // SONA learning failed, continue without it
          if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
            console.error('[hooks-intelligence] SONA processTrajectoryOutcome failed:', e);
        }
      }

      // EWC++ consolidation requires a real gradient proxy (e.g. a pattern
      // embedding — see recordPatternOutcome in ewc-consolidation.ts). No such
      // embedding is available from a trajectory here, so consolidation is
      // left un-run rather than fed a fabricated gradient.
    }

    const learningTimeMs = Date.now() - startTime;

    return {
      trajectoryId,
      success,
      ended: endedAt,
      persisted: persistResult.success,
      persistedId: persistResult.id,
      learning: {
        sonaUpdate: sonaResult.learned,
        sonaPatternKey: sonaResult.patternKey || undefined,
        sonaConfidence: sonaResult.confidence || undefined,
        ewcConsolidation: ewcResult.consolidated,
        ewcPenalty: ewcResult.penalty || undefined,
        patternsExtracted: trajectory?.steps.length || 0,
        learningTimeMs,
      },
      trajectory: trajectory
        ? {
            task: trajectory.task,
            agent: trajectory.agent,
            totalSteps: trajectory.steps.length,
            duration: trajectory.startedAt
              ? new Date(endedAt).getTime() - new Date(trajectory.startedAt).getTime()
              : 0,
          }
        : null,
      implementation: sonaResult.learned
        ? 'real-sona-learning'
        : persistResult.success
          ? 'real-persistence'
          : 'memory-only',
      note: sonaResult.learned
        ? `SONA learned pattern "${sonaResult.patternKey}" with ${(sonaResult.confidence * 100).toFixed(1)}% confidence`
        : persistResult.success
          ? 'Trajectory persisted for future learning'
          : persistResult.error || 'Trajectory not found',
    };
  },
};

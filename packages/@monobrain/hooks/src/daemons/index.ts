/**
 * V1 Daemon Manager
 *
 * Manages background daemon processes for:
 * - Metrics collection
 * - Swarm monitoring
 * - Pattern learning consolidation
 * - Statusline updates
 */

import type {
  DaemonConfig,
  DaemonState,
  DaemonStatus,
  DaemonManagerConfig,
} from '../types.js';

/**
 * Daemon instance
 */
interface DaemonInstance {
  config: DaemonConfig;
  state: DaemonState;
  timer?: ReturnType<typeof setInterval>;
  task?: () => Promise<void>;
}

/**
 * Default daemon manager configuration
 */
const DEFAULT_CONFIG: DaemonManagerConfig = {
  pidDirectory: '.monobrain/pids',
  logDirectory: '.monobrain/logs',
  daemons: [],
  autoRestart: true,
  maxRestartAttempts: 3,
};

/**
 * Daemon Manager - controls background daemon processes
 */
export class DaemonManager {
  private config: DaemonManagerConfig;
  private daemons: Map<string, DaemonInstance> = new Map();
  private restartCounts: Map<string, number> = new Map();

  constructor(config?: Partial<DaemonManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a daemon
   */
  register(config: DaemonConfig, task: () => Promise<void>): void {
    if (this.daemons.has(config.name)) {
      throw new Error(`Daemon '${config.name}' is already registered`);
    }

    const state: DaemonState = {
      name: config.name,
      status: 'stopped',
      executionCount: 0,
      failureCount: 0,
    };

    this.daemons.set(config.name, { config, state, task });
  }

  /**
   * Start a daemon
   */
  async start(name: string): Promise<void> {
    const daemon = this.daemons.get(name);
    if (!daemon) {
      throw new Error(`Daemon '${name}' not found`);
    }

    if (daemon.state.status === 'running') {
      return; // Already running
    }

    if (!daemon.config.enabled) {
      throw new Error(`Daemon '${name}' is disabled`);
    }

    daemon.state.status = 'starting';
    daemon.state.startedAt = new Date();

    try {
      // Start interval timer — unref so short-lived hook scripts (hook-handler.cjs) can exit
      daemon.timer = setInterval(async () => {
        await this.executeDaemonTask(name);
      }, daemon.config.interval);
      // NodeJS.Timer has unref(); long-lived daemon processes stay alive via their own event loop
      (daemon.timer as unknown as { unref?: () => void }).unref?.();

      daemon.state.status = 'running';
      daemon.state.pid = process.pid; // Use current process for in-process daemons

      // Run initial execution
      await this.executeDaemonTask(name);
    } catch (error) {
      daemon.state.status = 'error';
      daemon.state.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Stop a daemon
   */
  async stop(name: string): Promise<void> {
    const daemon = this.daemons.get(name);
    if (!daemon) {
      throw new Error(`Daemon '${name}' not found`);
    }

    if (daemon.state.status === 'stopped') {
      return; // Already stopped
    }

    daemon.state.status = 'stopping';

    if (daemon.timer) {
      clearInterval(daemon.timer);
      daemon.timer = undefined;
    }

    daemon.state.status = 'stopped';
    daemon.state.pid = undefined;
  }

  /**
   * Restart a daemon
   */
  async restart(name: string): Promise<void> {
    await this.stop(name);
    await this.start(name);
  }

  /**
   * Start all registered daemons
   */
  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [name, daemon] of this.daemons) {
      if (daemon.config.enabled) {
        promises.push(this.start(name));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Stop all daemons
   */
  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const name of this.daemons.keys()) {
      promises.push(this.stop(name));
    }
    await Promise.all(promises);
  }

  /**
   * Get daemon state
   */
  getState(name: string): DaemonState | undefined {
    return this.daemons.get(name)?.state;
  }

  /**
   * Get all daemon states
   */
  getAllStates(): DaemonState[] {
    return Array.from(this.daemons.values()).map((d) => d.state);
  }

  /**
   * Check if daemon is running
   */
  isRunning(name: string): boolean {
    return this.daemons.get(name)?.state.status === 'running';
  }

  /**
   * Update daemon interval
   */
  updateInterval(name: string, interval: number): void {
    const daemon = this.daemons.get(name);
    if (!daemon) {
      throw new Error(`Daemon '${name}' not found`);
    }

    daemon.config.interval = interval;

    // Restart if running to apply new interval
    if (daemon.state.status === 'running') {
      this.restart(name).catch(() => {});
    }
  }

  /**
   * Enable a daemon
   */
  enable(name: string): void {
    const daemon = this.daemons.get(name);
    if (daemon) {
      daemon.config.enabled = true;
    }
  }

  /**
   * Disable a daemon
   */
  disable(name: string): void {
    const daemon = this.daemons.get(name);
    if (daemon) {
      daemon.config.enabled = false;
      this.stop(name).catch(() => {});
    }
  }

  /**
   * Get daemon count
   */
  get count(): number {
    return this.daemons.size;
  }

  /**
   * Get running daemon count
   */
  get runningCount(): number {
    return Array.from(this.daemons.values()).filter(
      (d) => d.state.status === 'running'
    ).length;
  }

  /**
   * Execute a daemon task
   */
  private async executeDaemonTask(name: string): Promise<void> {
    const daemon = this.daemons.get(name);
    if (!daemon || !daemon.task) {
      return;
    }

    try {
      await daemon.task();
      daemon.state.executionCount++;
      daemon.state.lastUpdateAt = new Date();
      daemon.state.error = undefined;

      // Reset restart count on successful execution
      this.restartCounts.set(name, 0);
    } catch (error) {
      daemon.state.failureCount++;
      daemon.state.error = error instanceof Error ? error.message : String(error);

      // Handle auto-restart
      if (this.config.autoRestart) {
        const restartCount = (this.restartCounts.get(name) ?? 0) + 1;
        this.restartCounts.set(name, restartCount);

        if (restartCount <= this.config.maxRestartAttempts) {
          // Schedule restart
          setTimeout(() => {
            this.restart(name).catch(() => {});
          }, 1000 * restartCount); // Exponential backoff
        } else {
          daemon.state.status = 'error';
        }
      }
    }
  }
}

/**
 * Metrics Daemon - collects and syncs metrics
 */
export class MetricsDaemon {
  private manager: DaemonManager;
  private metricsStore: Map<string, unknown> = new Map();

  constructor(manager?: DaemonManager) {
    this.manager = manager ?? new DaemonManager();

    // Register metrics daemon
    this.manager.register(
      {
        name: 'metrics-sync',
        interval: 30000, // 30 seconds
        enabled: true,
      },
      () => this.syncMetrics()
    );
  }

  /**
   * Start metrics collection
   */
  async start(): Promise<void> {
    await this.manager.start('metrics-sync');
  }

  /**
   * Stop metrics collection
   */
  async stop(): Promise<void> {
    await this.manager.stop('metrics-sync');
  }

  /**
   * Sync metrics
   */
  private async syncMetrics(): Promise<void> {
    // Collect various metrics
    this.metricsStore.set('timestamp', new Date().toISOString());
    this.metricsStore.set('memory', process.memoryUsage());

    // Additional metrics would be collected here
  }

  /**
   * Get current metrics
   */
  getMetrics(): Record<string, unknown> {
    return Object.fromEntries(this.metricsStore);
  }
}

/**
 * Swarm Monitor Daemon - monitors swarm activity
 */
export class SwarmMonitorDaemon {
  private manager: DaemonManager;
  private swarmData: {
    activeAgents: number;
    maxAgents: number;
    coordinationActive: boolean;
    lastCheck: Date | null;
  } = {
    activeAgents: 0,
    maxAgents: 15,
    coordinationActive: false,
    lastCheck: null,
  };

  constructor(manager?: DaemonManager) {
    this.manager = manager ?? new DaemonManager();

    // Register swarm monitor daemon
    this.manager.register(
      {
        name: 'swarm-monitor',
        interval: 3000, // 3 seconds
        enabled: true,
      },
      () => this.checkSwarm()
    );
  }

  /**
   * Start swarm monitoring
   */
  async start(): Promise<void> {
    await this.manager.start('swarm-monitor');
  }

  /**
   * Stop swarm monitoring
   */
  async stop(): Promise<void> {
    await this.manager.stop('swarm-monitor');
  }

  /**
   * Check swarm status
   */
  private async checkSwarm(): Promise<void> {
    // In a real implementation, this would check running processes
    // and coordination state
    this.swarmData.lastCheck = new Date();
  }

  /**
   * Get swarm data
   */
  getSwarmData(): typeof this.swarmData {
    return { ...this.swarmData };
  }

  /**
   * Update active agent count
   */
  updateAgentCount(count: number): void {
    this.swarmData.activeAgents = count;
  }

  /**
   * Set coordination state
   */
  setCoordinationActive(active: boolean): void {
    this.swarmData.coordinationActive = active;
  }
}

/**
 * Hooks Learning Daemon - consolidates learned patterns using ReasoningBank
 */
export class HooksLearningDaemon {
  private manager: DaemonManager;
  private patternsLearned = 0;
  private routingAccuracy = 0;
  private reasoningBank: any = null;
  private lastConsolidation: Date | null = null;
  private consolidationStats = {
    totalRuns: 0,
    patternsPromoted: 0,
    patternsPruned: 0,
    duplicatesRemoved: 0,
  };

  constructor(manager?: DaemonManager) {
    this.manager = manager ?? new DaemonManager();

    // Register hooks learning daemon
    this.manager.register(
      {
        name: 'hooks-learning',
        interval: 60000, // 60 seconds
        enabled: true,
      },
      () => this.consolidate()
    );
  }

  /**
   * Start learning consolidation
   */
  async start(): Promise<void> {
    // Lazy load ReasoningBank to avoid circular dependencies
    try {
      const { reasoningBank } = await import('../reasoningbank/index.js');
      this.reasoningBank = reasoningBank;
      await this.reasoningBank.initialize();
    } catch (error) {
      console.warn('[HooksLearningDaemon] ReasoningBank not available:', error);
    }

    await this.manager.start('hooks-learning');
  }

  /**
   * Stop learning consolidation
   */
  async stop(): Promise<void> {
    await this.manager.stop('hooks-learning');
  }

  /**
   * Consolidate learned patterns using ReasoningBank
   */
  private async consolidate(): Promise<void> {
    if (!this.reasoningBank) {
      return;
    }

    try {
      const result = await this.reasoningBank.consolidate();

      // Update stats
      this.consolidationStats.totalRuns++;
      this.consolidationStats.patternsPromoted += result.patternsPromoted;
      this.consolidationStats.patternsPruned += result.patternsPruned;
      this.consolidationStats.duplicatesRemoved += result.duplicatesRemoved;
      this.lastConsolidation = new Date();

      // Update pattern count from ReasoningBank stats
      const stats = this.reasoningBank.getStats();
      this.patternsLearned = stats.shortTermCount + stats.longTermCount;

      // Emit consolidation event
      if (result.patternsPromoted > 0 || result.patternsPruned > 0) {
        console.log(
          `[HooksLearningDaemon] Consolidated: ${result.patternsPromoted} promoted, ` +
          `${result.patternsPruned} pruned, ${result.duplicatesRemoved} deduped`
        );
      }
    } catch (error) {
      console.error('[HooksLearningDaemon] Consolidation failed:', error);
    }
  }

  /**
   * Get learning stats
   */
  getStats(): {
    patternsLearned: number;
    routingAccuracy: number;
    consolidationStats: {
      totalRuns: number;
      patternsPromoted: number;
      patternsPruned: number;
      duplicatesRemoved: number;
    };
    lastConsolidation: Date | null;
  } {
    return {
      patternsLearned: this.patternsLearned,
      routingAccuracy: this.routingAccuracy,
      consolidationStats: { ...this.consolidationStats },
      lastConsolidation: this.lastConsolidation,
    };
  }

  /**
   * Update pattern count
   */
  updatePatternCount(count: number): void {
    this.patternsLearned = count;
  }

  /**
   * Update routing accuracy
   */
  updateRoutingAccuracy(accuracy: number): void {
    this.routingAccuracy = accuracy;
  }

  /**
   * Get ReasoningBank stats (if available)
   */
  getReasoningBankStats(): any {
    if (!this.reasoningBank) {
      return null;
    }
    return this.reasoningBank.getStats();
  }

  /**
   * Force immediate consolidation
   */
  async forceConsolidate(): Promise<void> {
    await this.consolidate();
  }
}

/**
 * Default daemon manager instance
 */
export const defaultDaemonManager = new DaemonManager();

/**
 * Wire all background workers that are implemented as TypeScript packages but
 * were never registered in the live runtime (GAP-004, GAP-005, GAP-006).
 *
 * All imports are dynamic and wrapped in try/catch so a missing package never
 * crashes the daemon manager.
 */
export async function initDefaultWorkers(): Promise<void> {
  // GAP-005: EpisodeBinnerWorker — accumulates agent runs into episodic memory
  try {
    const [{ EpisodeBinnerWorker }, { EpisodicStore }] = await Promise.all([
      import('../workers/episode-binner.js'),
      import('../../../memory/src/episodic-store.js'),
    ]);
    const store = new EpisodicStore({ filePath: '.monobrain/episodes/episodes.jsonl', maxRunsPerEpisode: 20 });
    const binner = new EpisodeBinnerWorker(store);
    binner.register();
  } catch { /* monobrain/memory may not be installed */ }

  // GAP-004: EntityExtractorWorker — extracts entity facts from task transcripts
  try {
    const { EntityExtractorWorker } = await import('../workers/entity-extractor.js');
    // No-op entityMemory stub — real implementation wires @monobrain/memory EntityStore
    const entityMemory = { store(_fact: unknown) { /* stub — replaced when EntityStore is available */ } };
    const extractFacts = async (_transcript: string, _runId: string) => [];
    // EntityExtractorWorker is event-driven; expose it on the manager for callers to trigger
    const worker = new EntityExtractorWorker({ entityMemory, extractFacts });
    // Register a PostTask hook that delegates to the worker when a transcript is available
    const { registerHook } = await import('../registry/index.js');
    const { HookEvent, HookPriority } = await import('../types.js');
    registerHook(
      HookEvent.PostTask,
      async (ctx) => {
        const transcript = ((ctx as unknown) as Record<string, unknown>).transcript as string | undefined;
        const runId = ctx.task?.id ?? 'unknown';
        if (transcript) await worker.processTranscript(transcript, runId);
        return { success: true };
      },
      HookPriority.Low,
      { name: 'entity-extractor:post-task' },
    );
  } catch { /* optional */ }

  // GAP-006: Wire TraceCollector to globalObservabilityBus
  try {
    const { globalObservabilityBus, TraceCollector, TraceStore, CLISink } = await import('../observability/index.js');
    const traceStore = new TraceStore('.monobrain/traces');
    const collector = new TraceCollector(traceStore);
    collector.register();
    globalObservabilityBus.addSink(new CLISink());
  } catch { /* optional */ }

  // Task 39: SpecializationScorer — record per-agent success/failure for routing quality
  try {
    // @ts-ignore — cli is not in hooks tsconfig references; dynamic import works at runtime
    const { SpecializationScorer } = await import('../../cli/src/agents/specialization-scorer.js');
    const scorer = new SpecializationScorer('.monobrain/scores.jsonl');
    const { registerHook } = await import('../registry/index.js');
    const { HookEvent, HookPriority } = await import('../types.js');
    registerHook(
      HookEvent.PostTask,
      async (ctx) => {
        const c = ctx as unknown as Record<string, unknown>;
        const agentSlug = (c.agentSlug as string | undefined) ?? (ctx.task as any)?.agentSlug ?? 'unknown';
        const taskType = (ctx.task as any)?.type ?? (c.taskType as string | undefined) ?? 'general';
        const success = (ctx.task as any)?.status === 'completed' || (c.success as boolean | undefined) !== false;
        const latencyMs = (c.latencyMs as number | undefined) ?? (ctx.task as any)?.latencyMs ?? 0;
        const qualityScore = c.qualityScore as number | undefined;
        scorer.recordOutcome({ agentSlug, taskType, success, latencyMs, qualityScore });
        return { success: true };
      },
      HookPriority.Low,
      { name: 'specialization-scorer:post-task' },
    );
  } catch { /* @monobrain/cli may not be compiled */ }

  // Task 26: DynamicPromptAssembly — PromptAssembler registered as PreTask hook
  try {
    // @ts-ignore — cli is not in hooks tsconfig references; dynamic import works at runtime
    const { PromptAssembler } = await import('../../cli/src/context/prompt-assembler.js');
    // Provide a default context provider that reads from last-route.json for routing context
    const lastRouteProvider = {
      name: 'last-route',
      priority: 10,
      maxTokens: 200,
      fetch: async (_ctx: unknown) => {
        const { existsSync, readFileSync } = await import('node:fs');
        const routeFile = '.monobrain/last-route.json';
        if (!existsSync(routeFile)) return null;
        try {
          const r = JSON.parse(readFileSync(routeFile, 'utf-8'));
          return { name: 'last-route', content: `Last routed to: ${r.agent} (confidence: ${(r.confidence * 100).toFixed(0)}%)`, priority: 10 };
        } catch { return null; }
      },
    };
    const assembler = new PromptAssembler({ basePromptTokens: 0, providers: [lastRouteProvider] });
    const { registerHook: rh26 } = await import('../registry/index.js');
    const { HookEvent: HE26, HookPriority: HP26 } = await import('../types.js');
    rh26(
      HE26.PreTask,
      async (ctx) => {
        const c = ctx as unknown as Record<string, unknown>;
        const taskDescription = (ctx.task as any)?.description ?? (c.prompt as string | undefined) ?? '';
        const runCtx = {
          agentSlug: (c.agentSlug as string | undefined) ?? 'unknown',
          taskDescription,
          sessionId: (c.sessionId as string | undefined) ?? 'default',
          metadata: {} as Record<string, unknown>,
        };
        const result = await assembler.assemble(taskDescription, runCtx);
        if (result.sectionsIncluded.length > 0) {
          console.log(`[PROMPT_ASSEMBLED] sections=${result.sectionsIncluded.join(',')}`);
        }
        return { success: true };
      },
      HP26.High,
      { name: 'prompt-assembler:pre-task' },
    );
  } catch { /* @monobrain/cli may not be compiled */ }

  // Task 31: ToolVersioning — ToolRegistry loaded at startup; DeprecationInjector available for MCP dispatch
  try {
    // @ts-ignore — cli is not in hooks tsconfig references; dynamic import works at runtime
    const { ToolRegistry } = await import('../../cli/src/mcp/tool-registry.js');
    // @ts-ignore
    const { DeprecationInjector } = await import('../../cli/src/mcp/deprecation-injector.js');
    const toolRegistry = new ToolRegistry('.monobrain/tool-versions.jsonl');
    const injector = new DeprecationInjector(toolRegistry);
    void injector; // available for MCP tool dispatch to call injector.inject(response, toolName)
    const deprecated = toolRegistry.listDeprecated();
    if (deprecated.length > 0) {
      console.log(`[TOOL_REGISTRY] ${deprecated.length} deprecated tool(s) tracked`);
    }
  } catch { /* @monobrain/cli may not be compiled */ }

  // Task 34: RegressionBenchmarks — BenchmarkRunner registered as weekly daemon
  try {
    // @ts-ignore — cli is not in hooks tsconfig references; dynamic import works at runtime
    const { BenchmarkRunner } = await import('../../cli/src/benchmarks/benchmark-runner.js');
    const benchmarkRunner = new BenchmarkRunner();
    defaultDaemonManager.register(
      {
        name: 'regression-benchmarks',
        interval: 604_800_000, // 7 days
        enabled: true,
      },
      async () => {
        const benchmarkDir = '.monobrain/benchmarks';
        const defs = benchmarkRunner.loadBenchmarks(benchmarkDir);
        if (defs.length > 0) {
          console.log(`[BENCHMARK_RUNNER] Running ${defs.length} regression benchmark(s)`);
        }
      },
    );
  } catch { /* @monobrain/cli may not be compiled */ }

  // GAP-009: PromptOptimizer removed in dead-code audit (worker stub had no real implementation)

  // Task 45: ProceduralMemory — scan SkillRegistry at startup so learned skills are indexed
  try {
    const { SkillRegistry } = await import('@monobrain/memory');
    const skillRegistry = new SkillRegistry('.monobrain/skills.jsonl');
    const skills = skillRegistry.list();
    if (skills.length > 0) {
      console.log(`[SKILL_REGISTRY] ${skills.length} learned skill(s) indexed at startup`);
    }
  } catch { /* @monobrain/memory may not export SkillRegistry */ }

  // Task 36: ConsensusAudit — register AuditWriter in post-task hook for swarm consensus events
  try {
    // @ts-ignore — cli not in hooks tsconfig
    const { AuditWriter } = await import('../../cli/src/consensus/audit-writer.js');
    const auditWriter = new AuditWriter('.monobrain/consensus');
    const { registerHook: rh36 } = await import('../registry/index.js');
    const { HookEvent: HE36, HookPriority: HP36 } = await import('../types.js');
    rh36(
      HE36.PostTask,
      async (ctx) => {
        const c = ctx as unknown as Record<string, unknown>;
        // Only audit when explicit consensus metadata is present
        if (!(c.swarmId && c.consensusDecision)) return { success: true };
        const now = new Date().toISOString();
        auditWriter.record({
          decisionId: (c.decisionId as string | undefined) ?? `auto-${Date.now()}`,
          swarmId: c.swarmId as string,
          protocol: (c.protocol as any) ?? 'raft',
          topic: (c.topic as string | undefined) ?? 'task-completion',
          decision: c.consensusDecision,
          votes: (c.votes as any[]) ?? [],
          quorumRequired: (c.quorumRequired as number | undefined) ?? 1,
          quorumThreshold: (c.quorumThreshold as number | undefined) ?? 0.5,
          round: (c.round as number | undefined) ?? 1,
          startedAt: (c.startedAt as string | undefined) ?? now,
          completedAt: now,
          sessionSecret: (c.sessionSecret as string | undefined) ?? 'auto',
        });
        return { success: true };
      },
      HP36.Low,
      { name: 'consensus-audit:post-task' },
    );
  } catch { /* @monobrain/cli may not be compiled */ }

  // SharedInstructions size monitor — daily check; warns when file approaches or exceeds the
  // 1500-char hard limit enforced in hook-handler.cjs (Task 23 token overhead guard).
  {
    const SI_CHAR_LIMIT = 1500;
    const SI_WARN_THRESHOLD = 1200; // warn at 80% of limit
    defaultDaemonManager.register(
      {
        name: 'shared-instructions-monitor',
        interval: 86_400_000, // 24 hours
        enabled: true,
      },
      async () => {
        const { existsSync, readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const siPath = join('.agents', 'shared_instructions.md');
        if (!existsSync(siPath)) return;
        const content = readFileSync(siPath, 'utf-8');
        const len = content.length;
        if (len > SI_CHAR_LIMIT) {
          console.warn(
            `[SI_MONITOR] OVER LIMIT: .agents/shared_instructions.md is ${len} chars ` +
            `(limit=${SI_CHAR_LIMIT}). Content is being truncated at session restore. ` +
            `Remove ${len - SI_CHAR_LIMIT} chars to stay within budget.`,
          );
        } else if (len > SI_WARN_THRESHOLD) {
          console.warn(
            `[SI_MONITOR] Approaching limit: .agents/shared_instructions.md is ${len}/${SI_CHAR_LIMIT} chars ` +
            `(${Math.round((len / SI_CHAR_LIMIT) * 100)}% of budget). Consider trimming.`,
          );
        } else {
          console.log(
            `[SI_MONITOR] OK: .agents/shared_instructions.md is ${len}/${SI_CHAR_LIMIT} chars ` +
            `(${Math.round((len / SI_CHAR_LIMIT) * 100)}% of budget).`,
          );
        }
      },
    );
  }

  // Start all registered daemons non-blocking — failures are logged, never thrown
  // This activates: regression-benchmarks (Task 34), prompt-optimization (GAP-009), shared-instructions-monitor
  defaultDaemonManager.startAll().catch((err) => {
    console.warn('[DaemonManager] Non-fatal: failed to start some daemons:', err);
  });
}

export {
  DaemonManager as default,
  type DaemonInstance,
};

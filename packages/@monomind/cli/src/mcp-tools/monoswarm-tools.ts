/**
 * Monoswarm MCP Tools for CLI
 *
 * Merged replacement for the former swarm-tools.ts + hive-mind-tools.ts.
 * Every tool here does one of two things: read/write a single JSON state
 * file (`.monomind/monoswarm/state.json`), or tally votes already recorded
 * in that file against a threshold. Nothing here starts a process, thread,
 * or network connection — real concurrent work happens only when the caller
 * separately dispatches subagents with Claude Code's Task tool.
 *
 * This is a clean break, not a migration: the old `.monomind/swarm/` and
 * `.monomind/hive-mind/` state files are abandoned in place (a later cleanup
 * phase purges them) rather than imported here.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentTools, loadAgentStore, loadAgentStoreOrNull } from './agent-tools.js';
import { getMonomindDataRoot, getProjectCwd, type MCPTool } from './types.js';

// ---------------------------------------------------------------------------
// State persistence — single file under the git-safe data root.
// ---------------------------------------------------------------------------

const MONOSWARM_DIR = 'monoswarm';
const MONOSWARM_STATE_FILE = 'state.json';

/** Vote-count threshold strategies (see module note — not distributed consensus). */
type VoteStrategy = 'majority' | 'supermajority' | 'unanimous' | 'threshold';

interface VoteProposal {
  proposalId: string;
  type: string;
  value: unknown;
  proposedBy: string;
  proposedAt: string;
  votes: Record<string, boolean>;
  status: 'pending' | 'approved' | 'rejected';
  strategy: VoteStrategy;
  minVotes?: number; // threshold strategy: explicit required vote count
  duplicateVoters?: string[]; // voters caught casting conflicting votes on this proposal
  /**
   * Anti-groupthink delay: minimum number of voting rounds that must show
   * divergent votes (not unanimous) before the proposal can resolve, even if
   * the vote threshold is already met.
   */
  minDivergenceRounds?: number;
  /** Counter: number of rounds so far where votes were not unanimous. */
  divergenceRoundsSeen?: number;
}

interface VoteResult {
  proposalId: string;
  type: string;
  result: 'approved' | 'rejected';
  votes: { for: number; against: number };
  decidedAt: string;
  strategy: VoteStrategy;
  duplicateVotersDetected?: string[];
}

interface MonoswarmState {
  monoswarmId: string;
  initialized: boolean;
  topology: string;
  maxAgents: number;
  status: 'initializing' | 'running' | 'paused' | 'shutting_down' | 'terminated';
  /** Agent roster — hive "workers" and swarm "agents" are the same list here. */
  agents: string[];
  /** Optional elected coordinator, carried over from hive-mind's "queen" concept. */
  coordinator?: {
    agentId: string;
    electedAt: string;
    term: number;
  };
  tasks: string[];
  config: Record<string, unknown>;
  /** Vote strategy chosen at monoswarm_init; the default for monoswarm_vote when unspecified. */
  voteStrategy?: VoteStrategy;
  votes: {
    pending: VoteProposal[];
    history: VoteResult[];
  };
  sharedMemory: Record<string, unknown>;
  notices: Array<{
    noticeId: string;
    message: string;
    priority: string;
    fromId: string;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

function getMonoswarmDir(): string {
  return join(getMonomindDataRoot(), MONOSWARM_DIR);
}

function getMonoswarmStatePath(): string {
  return join(getMonoswarmDir(), MONOSWARM_STATE_FILE);
}

function ensureMonoswarmDir(): void {
  const dir = getMonoswarmDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

const MAX_MONOSWARM_STATE_BYTES = 10 * 1024 * 1024; // 10 MB

function defaultState(): MonoswarmState {
  const now = new Date().toISOString();
  return {
    monoswarmId: '',
    initialized: false,
    topology: 'mesh',
    maxAgents: 8,
    status: 'initializing',
    agents: [],
    tasks: [],
    config: {},
    votes: { pending: [], history: [] },
    sharedMemory: {},
    notices: [],
    createdAt: now,
    updatedAt: now,
  };
}

function loadMonoswarmState(): MonoswarmState {
  try {
    const path = getMonoswarmStatePath();
    if (existsSync(path)) {
      if (statSync(path).size > MAX_MONOSWARM_STATE_BYTES) return defaultState();
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error(
        '[monoswarm-tools] failed to parse state.json — resetting to default state:',
        e,
      );
  }
  return defaultState();
}

function saveMonoswarmState(state: MonoswarmState): void {
  ensureMonoswarmDir();
  state.updatedAt = new Date().toISOString();
  const dest = getMonoswarmStatePath();
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  renameSync(tmp, dest);
}

const AUDIT_KEY_FILE = 'audit-key';

/**
 * Resolve the HMAC signing key used for vote/audit records. Falls back to a
 * per-project key generated once and persisted alongside the monoswarm
 * state (kept out of state.json and never returned by any tool).
 * MONOMIND_SESSION_SECRET still takes precedence for callers that want to
 * manage/rotate the key themselves.
 */
function getOrCreateAuditKey(): string {
  const envKey = process.env.MONOMIND_SESSION_SECRET;
  if (envKey) return envKey;

  const path = join(getMonoswarmDir(), AUDIT_KEY_FILE);
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf-8').trim();
      if (existing) return existing;
    }
  } catch {
    /* fall through to regeneration */
  }

  try {
    ensureMonoswarmDir();
    const key = randomBytes(32).toString('hex');
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, key, 'utf-8');
    renameSync(tmp, path);
    return key;
  } catch {
    // Filesystem unavailable — fall back to an ephemeral in-process key.
    return randomBytes(32).toString('hex');
  }
}

function saveAgentStore(store: { agents: Record<string, unknown> }): void {
  const storeDir = join(getMonomindDataRoot(), 'agents');
  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true });
  }
  const dest = join(storeDir, 'store.json');
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmp, dest);
}

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const VALID_TOPOLOGIES = new Set([
  'hierarchical',
  'mesh',
  'hierarchical-mesh',
  'ring',
  'star',
  'hybrid',
  'adaptive',
]);

// ---------------------------------------------------------------------------
// Vote-threshold math
// ---------------------------------------------------------------------------

/** Calculate required votes for a given strategy and total voter count. */
function calculateRequiredVotes(
  strategy: VoteStrategy,
  totalVoters: number,
  minVotes?: number,
): number {
  if (totalVoters <= 0) return 1;
  switch (strategy) {
    case 'supermajority':
      return Math.floor((totalVoters * 2) / 3) + 1;
    case 'unanimous':
      return totalVoters;
    case 'threshold':
      return Math.min(Math.max(1, minVotes ?? Math.floor(totalVoters / 2) + 1), totalVoters);
    default:
      return Math.floor(totalVoters / 2) + 1;
  }
}

/**
 * Detect a voter who cast conflicting votes across proposals of the same
 * type — a double-vote check, not real Byzantine fault detection.
 */
function detectDuplicateVotes(
  pending: VoteProposal[],
  currentProposal: VoteProposal,
  voterId: string,
  newVote: boolean,
): boolean {
  for (const p of pending) {
    if (p.proposalId === currentProposal.proposalId) continue;
    if (p.type !== currentProposal.type) continue;
    if (voterId in p.votes && p.votes[voterId] !== newVote) {
      return true; // Conflicting vote detected
    }
  }
  return false;
}

/**
 * Try to resolve a proposal based on its strategy. Returns 'approved',
 * 'rejected', or null if still pending.
 */
function tryResolveProposal(
  proposal: VoteProposal,
  totalVoters: number,
): 'approved' | 'rejected' | null {
  const votesFor = Object.values(proposal.votes).filter((v) => v).length;
  const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;
  const required = calculateRequiredVotes(proposal.strategy, totalVoters, proposal.minVotes);

  if (votesFor >= required) return 'approved';
  if (votesAgainst >= required) return 'rejected';

  if (proposal.strategy === 'unanimous' && votesAgainst > 0) {
    return 'rejected';
  }

  const totalVotes = Object.keys(proposal.votes).length;
  const remaining = totalVoters - totalVotes;
  if (votesFor + remaining < required && votesAgainst + remaining < required) {
    return 'rejected'; // Deadlock: neither side can win
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const monoswarmTools: MCPTool[] = [
  {
    name: 'monoswarm_init',
    description:
      "Record a coordination topology, agent roster, and vote strategy in a JSON state file. Starts no process — agents are dispatched separately via Claude Code's Task tool.",
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        topology: {
          type: 'string',
          description:
            'Topology label (hierarchical, mesh, hierarchical-mesh, ring, star, hybrid, adaptive)',
        },
        maxAgents: { type: 'number', description: 'Maximum number of agents (1-50)' },
        strategy: {
          type: 'string',
          description: 'Agent role strategy (specialized, balanced, adaptive)',
        },
        coordinatorId: {
          type: 'string',
          description: 'Initial coordinator agent ID (formerly "queen")',
        },
        voteStrategy: {
          type: 'string',
          enum: ['majority', 'supermajority', 'unanimous', 'threshold'],
          description: 'Default vote strategy for monoswarm_vote. Default: majority.',
        },
      },
    },
    handler: async (input) => {
      const topology = (input.topology as string) || 'hierarchical-mesh';
      const maxAgents = Math.min(Math.max((input.maxAgents as number) || 8, 1), 50);
      const MAX_FIELD_LEN = 256;
      const rawStrategy = (input.strategy as string) || 'specialized';
      const strategy =
        typeof rawStrategy === 'string' && rawStrategy.length > MAX_FIELD_LEN
          ? rawStrategy.slice(0, MAX_FIELD_LEN)
          : rawStrategy;

      if (!VALID_TOPOLOGIES.has(topology)) {
        return {
          success: false,
          error: `Invalid topology: ${topology}. Valid: ${[...VALID_TOPOLOGIES].join(', ')}`,
        };
      }

      const VALID_VOTE_STRATEGIES: VoteStrategy[] = [
        'majority',
        'supermajority',
        'unanimous',
        'threshold',
      ];
      const rawVoteStrategy = (input.voteStrategy as string) || 'majority';
      const voteStrategy: VoteStrategy = (VALID_VOTE_STRATEGIES as string[]).includes(
        rawVoteStrategy,
      )
        ? (rawVoteStrategy as VoteStrategy)
        : 'majority';

      const rawCoordinatorId = (input.coordinatorId as string) || undefined;
      const coordinatorId =
        typeof rawCoordinatorId === 'string' && rawCoordinatorId.length > MAX_FIELD_LEN
          ? rawCoordinatorId.slice(0, MAX_FIELD_LEN)
          : rawCoordinatorId;

      const monoswarmId = `monoswarm-${Date.now()}-${randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();

      const state: MonoswarmState = {
        monoswarmId,
        initialized: true,
        topology,
        maxAgents,
        status: 'running',
        agents: [],
        coordinator: coordinatorId
          ? { agentId: coordinatorId, electedAt: now, term: 1 }
          : undefined,
        tasks: [],
        config: { topology, maxAgents, strategy },
        voteStrategy,
        votes: { pending: [], history: [] },
        sharedMemory: {},
        notices: [],
        createdAt: now,
        updatedAt: now,
      };

      saveMonoswarmState(state);

      return {
        success: true,
        monoswarmId,
        topology,
        strategy,
        maxAgents,
        voteStrategy,
        coordinatorId,
        initializedAt: now,
        config: state.config,
        persisted: true,
      };
    },
  },
  {
    name: 'monoswarm_status',
    description:
      'Read the merged coordination + vote state from the JSON state file — agent roster, topology, pending/resolved votes, shared memory key count.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: {
          type: 'boolean',
          description: 'Include worker details, vote history, and shared memory contents',
        },
      },
    },
    handler: async (input) => {
      const state = loadMonoswarmState();

      if (!state.initialized) {
        return {
          status: 'not_initialized',
          message: 'No monoswarm state recorded. Use monoswarm_init to create one.',
        };
      }

      const agentStore = loadAgentStore();
      const uptime = state.createdAt ? Date.now() - new Date(state.createdAt).getTime() : 0;

      let stateBytes = 0;
      try {
        const path = getMonoswarmStatePath();
        if (existsSync(path)) stateBytes = statSync(path).size;
      } catch {
        /* best-effort */
      }

      const summary = {
        monoswarmId: state.monoswarmId,
        status: state.status,
        topology: state.topology,
        maxAgents: state.maxAgents,
        agentCount: state.agents.length,
        taskCount: state.tasks.length,
        voteStrategy: state.voteStrategy ?? 'majority',
        coordinator: state.coordinator
          ? {
              agentId: state.coordinator.agentId,
              electedAt: state.coordinator.electedAt,
              term: state.coordinator.term,
            }
          : undefined,
        agents: state.agents.map((id) => {
          const agent = agentStore.agents[id];
          return {
            id,
            type: agent?.agentType || 'worker',
            status: agent?.status || 'unknown',
            tasksCompleted: agent?.taskCount || 0,
          };
        }),
        pendingVotes: state.votes.pending.length,
        voteHistoryCount: state.votes.history.length,
        sharedMemoryKeys: Object.keys(state.sharedMemory).length,
        stateSize: `${Math.round(stateBytes / 1024)} KB`,
        config: state.config,
        uptime,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      };

      if (input.verbose) {
        return {
          ...summary,
          voteHistory: state.votes.history.slice(-10),
          sharedMemory: state.sharedMemory,
          notices: state.notices.slice(-10),
        };
      }

      return summary;
    },
  },
  {
    name: 'monoswarm_scale',
    description:
      'Adjust the number of agent records in the roster to a target count by writing/removing bookkeeping entries in the state file. No process is started or stopped.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        targetAgents: { type: 'number', description: 'Target number of agents' },
        agentType: {
          type: 'string',
          description: 'Agent type for newly spawned agent records (default: worker)',
        },
      },
      required: ['targetAgents'],
    },
    handler: async (input) => {
      const targetAgents = input.targetAgents as number;
      const agentType = (input.agentType as string) || 'worker';

      if (!Number.isFinite(targetAgents) || targetAgents < 0 || !Number.isInteger(targetAgents)) {
        return { success: false, error: 'targetAgents must be a non-negative integer' };
      }

      const state = loadMonoswarmState();
      if (!state.initialized) {
        return { success: false, error: 'Monoswarm not initialized. Use monoswarm_init first.' };
      }

      const currentCount = state.agents.length;
      const delta = targetAgents - currentCount;

      const spawnTool = agentTools.find((t) => t.name === 'agent_spawn')!;
      const terminateTool = agentTools.find((t) => t.name === 'agent_terminate')!;

      const spawned: string[] = [];
      const terminated: string[] = [];

      if (delta > 0) {
        for (let i = 0; i < delta; i++) {
          const result = (await spawnTool.handler({ agentType })) as {
            success: boolean;
            agentId?: string;
          };
          if (result.success && result.agentId) {
            state.agents.push(result.agentId);
            spawned.push(result.agentId);
          }
        }
      } else if (delta < 0) {
        const toRemove = state.agents.slice(0, -delta);
        for (const agentId of toRemove) {
          const result = (await terminateTool.handler({ agentId })) as { success: boolean };
          if (result.success) {
            terminated.push(agentId);
          }
        }
        state.agents = state.agents.filter((id) => !terminated.includes(id));
      }

      state.maxAgents = Math.max(state.maxAgents, state.agents.length);
      saveMonoswarmState(state);

      const targetReached = state.agents.length === targetAgents;

      return {
        success: targetReached,
        error: targetReached
          ? undefined
          : `Reached ${state.agents.length}/${targetAgents} agents — some spawn/terminate operations failed`,
        monoswarmId: state.monoswarmId,
        previousCount: currentCount,
        currentCount: state.agents.length,
        targetAgents,
        spawned,
        terminated,
      };
    },
  },
  {
    name: 'monoswarm_health',
    description:
      'Inspect the state file and agent roster and report a derived healthy/degraded status — no live process is polled.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const state = loadMonoswarmState();

      if (!state.initialized) {
        return {
          status: 'not_initialized',
          healthy: false,
          checks: [
            { name: 'monoswarm_exists', status: 'fail', message: 'No monoswarm state recorded' },
          ],
          checkedAt: new Date().toISOString(),
        };
      }

      const isRunning = state.status === 'running';
      const stateFileExists = existsSync(getMonoswarmStatePath());

      const checks = [
        {
          name: 'monoswarm_exists',
          status: 'ok',
          message: `Monoswarm ${state.monoswarmId} recorded`,
        },
        {
          name: 'coordinator',
          status: isRunning ? 'ok' : 'warn',
          message: isRunning ? 'Status: running' : `Status: ${state.status}`,
        },
        {
          name: 'agents',
          status: state.agents.length > 0 ? 'ok' : 'info',
          message: `${state.agents.length} agents registered (max: ${state.maxAgents})`,
        },
        {
          name: 'persistence',
          status: stateFileExists ? 'ok' : 'warn',
          message: stateFileExists ? 'State file persisted' : 'State file missing',
        },
        {
          name: 'topology',
          status: 'ok',
          message: `Topology: ${state.topology}`,
        },
      ];

      const healthy = isRunning && stateFileExists;

      return {
        status: healthy ? 'healthy' : 'degraded',
        healthy,
        monoswarmId: state.monoswarmId,
        topology: state.topology,
        agentCount: state.agents.length,
        checks,
        checkedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'monoswarm_shutdown',
    description:
      'Mark the state file terminated and remove roster agents from the agent store. No process is stopped because none was started.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        graceful: {
          type: 'boolean',
          description:
            'Refuse to shut down while votes are pending unless force is set (default: true)',
        },
        force: { type: 'boolean', description: 'Force immediate shutdown even with pending votes' },
      },
    },
    handler: async (input) => {
      const state = loadMonoswarmState();

      if (!state.initialized) {
        return { success: false, error: 'Monoswarm not initialized or already shut down' };
      }
      if (state.status === 'terminated') {
        return {
          success: false,
          monoswarmId: state.monoswarmId,
          error: 'Monoswarm already terminated',
        };
      }

      const graceful = input.graceful !== false;
      const force = input.force === true;
      const pendingVotes = state.votes.pending.length;

      if (graceful && pendingVotes > 0 && !force) {
        return {
          success: false,
          error: `Cannot gracefully shut down with ${pendingVotes} pending vote(s). Use force: true to override.`,
          pendingVotes,
          agentCount: state.agents.length,
        };
      }

      // Clear roster agents from the agent store. Must use the null-aware
      // loader here (this handler mutates and saves) — loadAgentStore() on a
      // corrupt/oversized store.json returns the empty default, and saving
      // that back would wipe every real agent, not just this roster.
      const agentStore = loadAgentStoreOrNull();
      if (!agentStore) {
        return {
          success: false,
          error:
            'Agent store is unreadable/corrupt — refusing to shut down to avoid overwriting real agent data.',
          pendingVotes,
          agentCount: state.agents.length,
        };
      }
      for (const agentId of state.agents) {
        if (agentStore.agents[agentId]) delete agentStore.agents[agentId];
      }
      saveAgentStore(agentStore);

      const shutdownTime = new Date().toISOString();
      const agentsTerminated = state.agents.length;
      const previousCoordinator = state.coordinator?.agentId;

      state.status = 'terminated';
      state.initialized = false;
      state.coordinator = undefined;
      state.agents = [];
      state.votes.pending = [];
      state.sharedMemory = {};

      saveMonoswarmState(state);

      return {
        success: true,
        monoswarmId: state.monoswarmId,
        terminated: true,
        graceful,
        agentsTerminated,
        previousCoordinator,
        votesCleared: pendingVotes,
        terminatedAt: shutdownTime,
      };
    },
  },
  {
    name: 'monoswarm_agent_add',
    description:
      'Add an agent record (id, role) to the roster in the state file, and write a matching record into the agent store. Starts nothing.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of agent records to add (default: 1)',
          default: 1,
        },
        role: {
          type: 'string',
          enum: ['worker', 'specialist', 'scout'],
          description: 'Agent role',
          default: 'worker',
        },
        agentType: {
          type: 'string',
          description: 'Agent type for added agents',
          default: 'worker',
        },
        prefix: { type: 'string', description: 'Prefix for agent IDs', default: 'monoswarm-agent' },
      },
    },
    handler: async (input) => {
      const state = loadMonoswarmState();

      if (!state.initialized) {
        return { success: false, error: 'Monoswarm not initialized. Run monoswarm_init first.' };
      }

      const count = Math.min(Math.max(1, (input.count as number) || 1), 20);
      const MAX_ROLE_LEN = 256;
      const MAX_PREFIX_LEN = 128;
      const rawRole = (input.role as string) || 'worker';
      const role =
        typeof rawRole === 'string' && rawRole.length > MAX_ROLE_LEN
          ? rawRole.slice(0, MAX_ROLE_LEN)
          : rawRole;
      const rawAgentType = (input.agentType as string) || 'worker';
      const agentType =
        typeof rawAgentType === 'string' && rawAgentType.length > MAX_ROLE_LEN
          ? rawAgentType.slice(0, MAX_ROLE_LEN)
          : rawAgentType;
      const rawPrefix = (input.prefix as string) || 'monoswarm-agent';
      const prefix =
        typeof rawPrefix === 'string' && rawPrefix.length > MAX_PREFIX_LEN
          ? rawPrefix.slice(0, MAX_PREFIX_LEN)
          : rawPrefix;

      const agentStore = loadAgentStoreOrNull();
      if (!agentStore) {
        return {
          success: false,
          error:
            'Agent store is unreadable/corrupt — refusing to add agents to avoid overwriting real agent data.',
        };
      }

      const added: Array<{ agentId: string; role: string; joinedAt: string }> = [];

      for (let i = 0; i < count; i++) {
        const agentId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        if (RESERVED_KEYS.has(agentId)) continue;

        agentStore.agents[agentId] = {
          agentId,
          agentType,
          status: 'idle',
          health: 1.0,
          taskCount: 0,
          config: { role },
          createdAt: new Date().toISOString(),
          domain: 'monoswarm',
        };

        const MAX_AGENTS = 100;
        if (!state.agents.includes(agentId)) {
          if (state.agents.length >= MAX_AGENTS) {
            return {
              success: false,
              error: `Monoswarm has reached max agent capacity (${MAX_AGENTS})`,
            };
          }
          state.agents.push(agentId);
        }

        added.push({ agentId, role, joinedAt: new Date().toISOString() });
      }

      saveAgentStore(agentStore);
      saveMonoswarmState(state);

      return {
        success: true,
        added: count,
        agents: added,
        totalAgents: state.agents.length,
        message: `Added ${count} agent record(s) to the roster`,
      };
    },
  },
  {
    name: 'monoswarm_join',
    description:
      'Append an agent id to the roster array in the state file. No membership handshake occurs — this is a list append.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID to add to the roster' },
        role: {
          type: 'string',
          enum: ['worker', 'specialist', 'scout'],
          description: 'Agent role',
        },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const state = loadMonoswarmState();
      const agentId = input.agentId as string;

      if (
        typeof agentId !== 'string' ||
        agentId.length === 0 ||
        agentId.length > 128 ||
        RESERVED_KEYS.has(agentId) ||
        !/^[a-zA-Z0-9_-]+$/.test(agentId)
      ) {
        return { success: false, error: 'Invalid agentId' };
      }

      if (!state.initialized) {
        return { success: false, error: 'Monoswarm not initialized' };
      }

      const MAX_AGENTS = 100;
      if (!state.agents.includes(agentId)) {
        if (state.agents.length >= MAX_AGENTS) {
          return {
            success: false,
            error: `Monoswarm has reached max agent capacity (${MAX_AGENTS})`,
          };
        }
        state.agents.push(agentId);
        saveMonoswarmState(state);
      }

      return {
        success: true,
        agentId,
        role: input.role || 'worker',
        totalAgents: state.agents.length,
        joinedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'monoswarm_leave',
    description: 'Remove an agent id from the roster array in the state file.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID to remove' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const state = loadMonoswarmState();
      const agentId = input.agentId as string;

      if (
        typeof agentId !== 'string' ||
        agentId.length === 0 ||
        agentId.length > 128 ||
        RESERVED_KEYS.has(agentId) ||
        !/^[a-zA-Z0-9_-]+$/.test(agentId)
      ) {
        return { success: false, error: 'Invalid agentId' };
      }

      const index = state.agents.indexOf(agentId);
      if (index > -1) {
        state.agents.splice(index, 1);
        saveMonoswarmState(state);
        return {
          success: true,
          agentId,
          leftAt: new Date().toISOString(),
          remainingAgents: state.agents.length,
        };
      }

      return { success: false, agentId, error: 'Agent not in roster' };
    },
  },
  {
    name: 'monoswarm_vote',
    description:
      "Create or vote on a proposal; passes when the vote count meets the chosen strategy's threshold (majority / supermajority / unanimous / a custom threshold) — single in-process tally, not a distributed consensus protocol.",
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['propose', 'vote', 'status', 'list'],
          description: 'Vote action',
        },
        proposalId: { type: 'string', description: 'Proposal ID (for vote/status)' },
        type: { type: 'string', description: 'Proposal type (for propose)' },
        value: { description: 'Proposal value (for propose)' },
        vote: { type: 'boolean', description: 'Vote (true=for, false=against)' },
        voterId: { type: 'string', description: 'Voter agent ID' },
        strategy: {
          type: 'string',
          enum: ['majority', 'supermajority', 'unanimous', 'threshold'],
          description:
            'Vote strategy (default: the strategy chosen at monoswarm_init, else majority)',
        },
        minVotes: {
          type: 'number',
          description: 'Explicit vote count required (for threshold strategy)',
        },
        minDivergenceRounds: {
          type: 'number',
          description:
            'Anti-groupthink delay: minimum rounds with divergent votes required before resolution. Default: 0 (disabled).',
        },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const state = loadMonoswarmState();
      const action = input.action as string;
      const rawStrategy = (input.strategy as string) || state.voteStrategy || 'majority';
      const VALID_STRATEGIES: VoteStrategy[] = [
        'majority',
        'supermajority',
        'unanimous',
        'threshold',
      ];
      if (!(VALID_STRATEGIES as string[]).includes(rawStrategy)) {
        return {
          action,
          error: `Unknown strategy "${rawStrategy}". Available strategies: ${VALID_STRATEGIES.join(', ')}.`,
          availableStrategies: VALID_STRATEGIES,
        };
      }
      const strategy = rawStrategy as VoteStrategy;
      const totalVoters = state.agents.length;

      if (action === 'propose') {
        const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const minVotes = strategy === 'threshold' ? (input.minVotes as number) : undefined;

        const required = calculateRequiredVotes(strategy, totalVoters, minVotes);

        const minDivergenceRounds =
          typeof input.minDivergenceRounds === 'number'
            ? Math.max(0, input.minDivergenceRounds as number)
            : 0;

        const MAX_TYPE_LEN = 128;
        const MAX_VOTER_ID_LEN = 256;
        const MAX_VALUE_BYTES = 64 * 1024;
        const rawType = (input.type as string) || 'general';
        const proposalType =
          typeof rawType === 'string' && rawType.length > MAX_TYPE_LEN
            ? rawType.slice(0, MAX_TYPE_LEN)
            : rawType;
        const rawVoterId = (input.voterId as string) || 'system';
        const proposedBy =
          typeof rawVoterId === 'string' && rawVoterId.length > MAX_VOTER_ID_LEN
            ? rawVoterId.slice(0, MAX_VOTER_ID_LEN)
            : rawVoterId;
        const rawValue = input.value;
        const cappedValue =
          typeof rawValue === 'string' && rawValue.length > MAX_VALUE_BYTES
            ? rawValue.slice(0, MAX_VALUE_BYTES)
            : rawValue;

        const proposal: VoteProposal = {
          proposalId,
          type: proposalType,
          value: cappedValue,
          proposedBy,
          proposedAt: new Date().toISOString(),
          votes: {},
          status: 'pending',
          strategy,
          minVotes: strategy === 'threshold' ? required : undefined,
          duplicateVoters: undefined,
          minDivergenceRounds: minDivergenceRounds > 0 ? minDivergenceRounds : undefined,
          divergenceRoundsSeen: 0,
        };

        state.votes.pending.push(proposal);
        saveMonoswarmState(state);

        return {
          action,
          proposalId,
          type: proposal.type,
          strategy,
          status: 'pending',
          required,
          totalVoters,
          minVotes: proposal.minVotes,
          minDivergenceRounds: proposal.minDivergenceRounds,
        };
      }

      if (action === 'vote') {
        const proposal = state.votes.pending.find((p) => p.proposalId === input.proposalId);
        if (!proposal) {
          return { action, error: 'Proposal not found or already resolved' };
        }

        const voterId = input.voterId as string;
        if (!voterId) {
          return { action, error: 'voterId is required for voting' };
        }
        if (totalVoters === 0) {
          return { action, error: 'No agents in roster — cannot vote' };
        }
        if (!state.agents.includes(voterId)) {
          return { action, error: `Voter ${voterId} is not a member of this roster` };
        }

        const voteValue = input.vote as boolean;
        const proposalStrategy = proposal.strategy || 'majority';
        const required = calculateRequiredVotes(proposalStrategy, totalVoters, proposal.minVotes);

        if (voterId in proposal.votes) {
          const previousVote = proposal.votes[voterId];
          if (previousVote === voteValue) {
            return {
              action,
              error: `Voter ${voterId} has already cast the same vote on this proposal`,
              proposalId: proposal.proposalId,
              existingVote: previousVote,
            };
          }
          // Conflicting vote from the same voter — flag it and drop the vote.
          if (!proposal.duplicateVoters) proposal.duplicateVoters = [];
          if (!proposal.duplicateVoters.includes(voterId)) {
            proposal.duplicateVoters.push(voterId);
          }
          delete proposal.votes[voterId];
          saveMonoswarmState(state);

          return {
            action,
            proposalId: proposal.proposalId,
            voterId,
            duplicateVoteDetected: true,
            message: `Voter ${voterId} attempted a conflicting vote. Previous vote invalidated.`,
            duplicateVoters: proposal.duplicateVoters,
            status: proposal.status,
          };
        }

        // Cross-proposal duplicate-vote check (same voter, same proposal type, conflicting votes).
        const isDuplicate = detectDuplicateVotes(state.votes.pending, proposal, voterId, voteValue);
        if (isDuplicate) {
          if (!proposal.duplicateVoters) proposal.duplicateVoters = [];
          if (!proposal.duplicateVoters.includes(voterId)) {
            proposal.duplicateVoters.push(voterId);
          }
          saveMonoswarmState(state);
          return {
            action,
            proposalId: proposal.proposalId,
            voterId,
            duplicateVoteDetected: true,
            message: `Voter ${voterId} cast conflicting votes across proposals of the same type. Vote rejected.`,
            duplicateVoters: proposal.duplicateVoters,
            status: proposal.status,
          };
        }

        proposal.votes[voterId] = voteValue;

        const votesFor = Object.values(proposal.votes).filter((v) => v).length;
        const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

        const allVotes = Object.values(proposal.votes);
        const isUnanimous = allVotes.every((v) => v) || allVotes.every((v) => !v);
        if (!isUnanimous && allVotes.length >= 2) {
          proposal.divergenceRoundsSeen = (proposal.divergenceRoundsSeen ?? 0) + 1;
        }

        const totalVotesCast = Object.keys(proposal.votes).length;
        const electorateExhausted = totalVoters > 0 && totalVotesCast >= totalVoters;
        const divergenceGateOpen =
          !proposal.minDivergenceRounds ||
          (proposal.divergenceRoundsSeen ?? 0) >= proposal.minDivergenceRounds ||
          electorateExhausted;

        const resolution = divergenceGateOpen ? tryResolveProposal(proposal, totalVoters) : null;
        let resolved = false;

        if (resolution !== null) {
          resolved = true;
          proposal.status = resolution;
          state.votes.history.push({
            proposalId: proposal.proposalId,
            type: proposal.type,
            result: resolution,
            votes: { for: votesFor, against: votesAgainst },
            decidedAt: new Date().toISOString(),
            strategy: proposalStrategy,
            duplicateVotersDetected: proposal.duplicateVoters?.length
              ? proposal.duplicateVoters
              : undefined,
          });
          if (state.votes.history.length > 1000) {
            state.votes.history = state.votes.history.slice(-1000);
          }
          state.votes.pending = state.votes.pending.filter(
            (p) => p.proposalId !== proposal.proposalId,
          );
        }

        saveMonoswarmState(state);

        if (resolved) {
          try {
            const bridge = await import('../memory/memory-bridge.js');
            await bridge.bridgeStoreEntry({
              key: `monoswarm-vote-${proposal.proposalId}`,
              value: JSON.stringify({
                proposalId: proposal.proposalId,
                type: proposal.type,
                strategy: proposalStrategy,
                status: proposal.status,
                votes: proposal.votes,
                resolvedAt: new Date().toISOString(),
              }),
              namespace: 'monoswarm-votes',
              tags: [proposal.type, proposalStrategy, proposal.status],
            });
          } catch {
            /* SQLite memory backend not available — JSON store is primary */
          }

          const hk = getOrCreateAuditKey();
          try {
            const { AuditWriter } = await import('../consensus/audit-writer.js');
            const auditDir = join(getProjectCwd(), '.monomind', 'consensus');
            const writer = new AuditWriter(auditDir);
            const now = new Date().toISOString();
            const voteEntries = Object.entries(proposal.votes).map(([agentId, vote]) => ({
              agentId,
              agentSlug: agentId,
              vote,
              votedAt: now,
            }));
            writer.record({
              decisionId: proposal.proposalId,
              swarmId: state.monoswarmId,
              protocol: proposalStrategy as
                | 'majority'
                | 'supermajority'
                | 'unanimous'
                | 'threshold',
              topic: proposal.type,
              decision: resolution,
              votes: voteEntries,
              quorumRequired: required,
              quorumThreshold: required / Math.max(totalVoters, 1),
              round: (proposal.divergenceRoundsSeen ?? 0) + 1,
              startedAt: proposal.proposedAt,
              completedAt: now,
              sessionSecret: hk,
            });
          } catch (e) {
            if (process.env.MONOMIND_LOG_LEVEL === 'debug') {
              process.stderr.write(
                `[monoswarm-vote] Audit write failed: ${(e as Error).message}\n`,
              );
            }
          }
        }

        return {
          action,
          proposalId: proposal.proposalId,
          voterId,
          vote: voteValue,
          strategy: proposalStrategy,
          votesFor,
          votesAgainst,
          required,
          totalVoters,
          resolved,
          result: resolved ? resolution : undefined,
          status: proposal.status,
          duplicateVoters: proposal.duplicateVoters?.length ? proposal.duplicateVoters : undefined,
          divergenceGateOpen,
          divergenceRoundsSeen: proposal.divergenceRoundsSeen ?? 0,
          minDivergenceRounds: proposal.minDivergenceRounds,
          divergenceHint: !divergenceGateOpen
            ? `Anti-groupthink delay: ${proposal.divergenceRoundsSeen ?? 0}/${proposal.minDivergenceRounds} divergent rounds seen. Resolution deferred.`
            : undefined,
        };
      }

      if (action === 'status') {
        const proposal = state.votes.pending.find((p) => p.proposalId === input.proposalId);
        if (!proposal) {
          const historical = state.votes.history.find((h) => h.proposalId === input.proposalId);
          if (historical) {
            return { action, ...historical, historical: true, resolved: true };
          }
          return { action, error: 'Proposal not found' };
        }

        const votesFor = Object.values(proposal.votes).filter((v) => v).length;
        const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;
        const proposalStrategy = proposal.strategy || 'majority';
        const required = calculateRequiredVotes(proposalStrategy, totalVoters, proposal.minVotes);

        return {
          action,
          proposalId: proposal.proposalId,
          type: proposal.type,
          strategy: proposalStrategy,
          status: proposal.status,
          votesFor,
          votesAgainst,
          totalVotes: Object.keys(proposal.votes).length,
          required,
          totalVoters,
          resolved: false,
          minVotes: proposal.minVotes,
          duplicateVoters: proposal.duplicateVoters?.length ? proposal.duplicateVoters : undefined,
        };
      }

      if (action === 'list') {
        return {
          action,
          pending: state.votes.pending.map((p) => ({
            proposalId: p.proposalId,
            type: p.type,
            strategy: p.strategy || 'majority',
            proposedAt: p.proposedAt,
            totalVotes: Object.keys(p.votes).length,
            required: calculateRequiredVotes(p.strategy || 'majority', totalVoters, p.minVotes),
            status: p.status,
          })),
          recentHistory: state.votes.history.slice(-5),
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
  {
    name: 'monoswarm_notice',
    description:
      'Append a message to a shared array in the state file — a noticeboard, not message delivery; nothing subscribes to it.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Notice text' },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical'],
          description: 'Notice priority',
        },
        fromId: { type: 'string', description: 'Sender agent ID' },
      },
      required: ['message'],
    },
    handler: async (input) => {
      const state = loadMonoswarmState();

      if (!state.initialized) {
        return { success: false, error: 'Monoswarm not initialized' };
      }

      const MAX_MSG_LEN = 1024 * 1024; // 1 MB
      const MAX_FROM_ID_LEN = 256;
      const MAX_PRIORITY_LEN = 16;
      const rawMessage = input.message as string;
      const message =
        typeof rawMessage === 'string' && rawMessage.length > MAX_MSG_LEN
          ? rawMessage.slice(0, MAX_MSG_LEN)
          : rawMessage;
      const rawFromId = (input.fromId as string) || 'system';
      const fromId =
        typeof rawFromId === 'string' && rawFromId.length > MAX_FROM_ID_LEN
          ? rawFromId.slice(0, MAX_FROM_ID_LEN)
          : rawFromId;
      const rawPriority = (input.priority as string) || 'normal';
      const priority =
        typeof rawPriority === 'string' && rawPriority.length > MAX_PRIORITY_LEN
          ? rawPriority.slice(0, MAX_PRIORITY_LEN)
          : rawPriority;

      const noticeId = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      state.notices.push({
        noticeId,
        message,
        priority,
        fromId,
        timestamp: new Date().toISOString(),
      });
      state.notices = state.notices.slice(-100); // Keep only the last 100 notices

      saveMonoswarmState(state);

      return {
        success: true,
        noticeId,
        recipients: state.agents.length,
        priority,
        postedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'monoswarm_memory',
    description:
      'Plain key/value bookkeeping in the state file — not a distributed or replicated store.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'delete', 'list'],
          description: 'Memory action',
        },
        key: { type: 'string', description: 'Memory key' },
        value: { description: 'Value to store (for set)' },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const state = loadMonoswarmState();
      const action = input.action as string;
      const key = input.key as string;

      const MAX_KEY_LEN = 256;
      const MAX_VALUE_BYTES = 1024 * 1024; // 1 MB
      const MAX_KEYS = 1000;

      if (action === 'get') {
        if (!key) return { action, error: 'Key required' };
        if (typeof key !== 'string' || key.length > MAX_KEY_LEN || RESERVED_KEYS.has(key)) {
          return { action, error: 'Invalid key' };
        }
        return {
          action,
          key,
          value: Object.hasOwn(state.sharedMemory, key) ? state.sharedMemory[key] : undefined,
          exists: Object.hasOwn(state.sharedMemory, key),
        };
      }

      if (action === 'set') {
        if (!key) return { action, error: 'Key required' };
        if (typeof key !== 'string' || key.length > MAX_KEY_LEN || RESERVED_KEYS.has(key)) {
          return { action, error: 'Invalid key' };
        }
        const rawValue = input.value;
        const cappedValue =
          typeof rawValue === 'string' && rawValue.length > MAX_VALUE_BYTES
            ? rawValue.slice(0, MAX_VALUE_BYTES)
            : rawValue;
        const keyCount = Object.keys(state.sharedMemory).length;
        if (!Object.hasOwn(state.sharedMemory, key) && keyCount >= MAX_KEYS) {
          return { action, error: `Shared memory full (max ${MAX_KEYS} keys)` };
        }
        state.sharedMemory[key] = cappedValue;
        saveMonoswarmState(state);

        try {
          const bridge = await import('../memory/memory-bridge.js');
          await bridge.bridgeStoreEntry({
            key: `monoswarm-memory-${key}`,
            value: JSON.stringify(input.value),
            namespace: 'monoswarm-memory',
          });
        } catch {
          /* SQLite memory backend not available */
        }

        return { action, key, success: true, updatedAt: new Date().toISOString() };
      }

      if (action === 'delete') {
        if (!key) return { action, error: 'Key required' };
        if (typeof key !== 'string' || key.length > MAX_KEY_LEN || RESERVED_KEYS.has(key)) {
          return { action, error: 'Invalid key' };
        }
        const existed = Object.hasOwn(state.sharedMemory, key);
        delete state.sharedMemory[key];
        saveMonoswarmState(state);
        return { action, key, deleted: existed };
      }

      if (action === 'list') {
        return {
          action,
          keys: Object.keys(state.sharedMemory),
          count: Object.keys(state.sharedMemory).length,
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
  {
    name: 'monoswarm_audit_list',
    description:
      'List tamper-evident vote audit records (HMAC-signed JSONL trail) — local file, not a distributed ledger.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string', description: 'Filter by monoswarm ID (optional)' },
        limit: { type: 'number', description: 'Max records to return (default: 50, max: 500)' },
      },
    },
    handler: async (input) => {
      try {
        const { AuditWriter } = await import('../consensus/audit-writer.js');
        const auditDir = join(getProjectCwd(), '.monomind', 'consensus');
        const writer = new AuditWriter(auditDir);
        const limit = Math.min(Math.max(1, (input.limit as number) || 50), 500);
        const swarmId = input.swarmId as string | undefined;
        const records = writer.listDecisions(swarmId, limit);
        return {
          success: true,
          count: records.length,
          records: records.map((r) => ({
            decisionId: r.decisionId,
            swarmId: r.swarmId,
            protocol: r.protocol,
            topic: r.topic,
            decision: r.decision,
            voteCount: r.votes.length,
            quorumAchieved: r.quorumAchieved,
            round: r.round,
            durationMs: r.durationMs,
            completedAt: r.completedAt,
            signed: !!r.recordSignature,
          })),
        };
      } catch (e) {
        return { success: false, error: `Audit trail unavailable: ${(e as Error).message}` };
      }
    },
  },
  {
    name: 'monoswarm_audit_verify',
    description:
      'Verify tamper-evidence of a vote decision (checks HMAC signatures on all votes and the record itself) — a local file check, not a distributed ledger.',
    category: 'monoswarm',
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: { type: 'string', description: 'Decision/proposal ID to verify' },
      },
      required: ['decisionId'],
    },
    handler: async (input) => {
      const hk = getOrCreateAuditKey();
      const decisionId = input.decisionId as string;
      if (typeof decisionId !== 'string' || decisionId.length === 0 || decisionId.length > 256) {
        return { success: false, error: 'Invalid decisionId' };
      }
      try {
        const { AuditWriter } = await import('../consensus/audit-writer.js');
        const auditDir = join(getProjectCwd(), '.monomind', 'consensus');
        const writer = new AuditWriter(auditDir);
        const result = writer.verifyDecision(decisionId, hk);
        return {
          success: true,
          decisionId,
          valid: result.valid,
          invalidVotes: result.invalidVotes,
          message: result.valid
            ? 'All vote signatures and record signature verified — no tampering detected.'
            : `Verification failed: ${result.invalidVotes.length} invalid vote(s) or record signature mismatch.`,
        };
      } catch (e) {
        return { success: false, error: `Audit verification failed: ${(e as Error).message}` };
      }
    },
  },
];

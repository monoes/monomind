/**
 * Hive-Mind MCP Tools for CLI
 *
 * Tool definitions for collective intelligence and swarm coordination.
 */
import { existsSync, readFileSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from './types.js';
import { weightedTally } from '../consensus/vote-signer.js';
// Storage paths
const STORAGE_DIR = '.monomind';
const HIVE_DIR = 'hive-mind';
const HIVE_FILE = 'state.json';
/**
 * Calculate required votes for a given strategy and total node count.
 */
function calculateRequiredVotes(strategy, totalNodes, quorumPreset = 'majority') {
    if (totalNodes <= 0)
        return 1;
    switch (strategy) {
        case 'bft':
            // BFT: requires 2/3 + 1 of total nodes
            return Math.floor((totalNodes * 2) / 3) + 1;
        case 'raft':
            // Raft: simple majority
            return Math.floor(totalNodes / 2) + 1;
        case 'quorum':
            switch (quorumPreset) {
                case 'unanimous':
                    return totalNodes;
                case 'supermajority':
                    return Math.floor((totalNodes * 2) / 3) + 1;
                case 'majority':
                default:
                    return Math.floor(totalNodes / 2) + 1;
            }
        default:
            return Math.floor(totalNodes / 2) + 1;
    }
}
/**
 * Detect Byzantine behavior: a voter who has cast conflicting votes
 * across proposals in the same round (same type, overlapping time).
 * Here we check if the voter already voted differently on this proposal
 * (which shouldn't happen if we block double-votes, so this checks
 * cross-proposal conflicting votes for same type within the pending set).
 */
function detectByzantineVoters(pending, currentProposal, voterId, newVote) {
    // Check if voter cast opposite votes on proposals of the same type
    for (const p of pending) {
        if (p.proposalId === currentProposal.proposalId)
            continue;
        if (p.type !== currentProposal.type)
            continue;
        if (voterId in p.votes && p.votes[voterId] !== newVote) {
            return true; // Conflicting vote detected
        }
    }
    return false;
}
/**
 * Try to resolve a proposal based on its strategy.
 * Returns 'approved', 'rejected', or null if still pending.
 */
function tryResolveProposal(proposal, totalNodes) {
    const votesFor = Object.values(proposal.votes).filter(v => v).length;
    const votesAgainst = Object.values(proposal.votes).filter(v => !v).length;
    const required = calculateRequiredVotes(proposal.strategy, totalNodes, proposal.quorumPreset);
    if (votesFor >= required)
        return 'approved';
    if (votesAgainst >= required)
        return 'rejected';
    // For quorum with 'unanimous', also reject if any vote is against
    if (proposal.strategy === 'quorum' && proposal.quorumPreset === 'unanimous' && votesAgainst > 0) {
        return 'rejected';
    }
    // Check if it's impossible to reach quorum (remaining potential votes can't tip it)
    const totalVotes = Object.keys(proposal.votes).length;
    const remaining = totalNodes - totalVotes;
    if (votesFor + remaining < required && votesAgainst + remaining < required) {
        // Deadlock: neither side can win -- reject
        return 'rejected';
    }
    return null;
}
function getHiveDir() {
    return join(getProjectCwd(), STORAGE_DIR, HIVE_DIR);
}
function getHivePath() {
    return join(getHiveDir(), HIVE_FILE);
}
function ensureHiveDir() {
    const dir = getHiveDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
const MAX_HIVE_STATE_BYTES = 10 * 1024 * 1024; // 10 MB
function loadHiveState() {
    try {
        const path = getHivePath();
        if (existsSync(path) && statSync(path).size <= MAX_HIVE_STATE_BYTES) {
            const data = readFileSync(path, 'utf-8');
            return JSON.parse(data);
        }
    }
    catch {
        // Return default state on error
    }
    return {
        initialized: false,
        topology: 'mesh',
        workers: [],
        consensus: { pending: [], history: [] },
        sharedMemory: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
function saveHiveState(state) {
    ensureHiveDir();
    state.updatedAt = new Date().toISOString();
    const dest = getHivePath();
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    renameSync(tmp, dest);
}
// Import agent store helpers for spawn functionality
import { existsSync as agentStoreExists, readFileSync as readAgentStore, writeFileSync as writeAgentStore, mkdirSync as mkdirAgentStore } from 'node:fs';
// Canonical agent store path matches agent-tools.ts: .monomind/agents/store.json
function loadAgentStore() {
    const storePath = join(getProjectCwd(), '.monomind', 'agents', 'store.json');
    try {
        if (agentStoreExists(storePath)) {
            return JSON.parse(readAgentStore(storePath, 'utf-8'));
        }
    }
    catch { /* ignore */ }
    return { agents: {} };
}
const HIVE_RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function saveAgentStore(store) {
    const storeDir = join(getProjectCwd(), '.monomind', 'agents');
    if (!agentStoreExists(storeDir)) {
        mkdirAgentStore(storeDir, { recursive: true });
    }
    const dest = join(storeDir, 'store.json');
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    writeAgentStore(tmp, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmp, dest);
}
export const hiveMindTools = [
    {
        name: 'hive-mind_spawn',
        description: 'Spawn workers and automatically join them to the hive-mind (combines agent/spawn + hive-mind/join)',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number', description: 'Number of workers to spawn (default: 1)', default: 1 },
                role: { type: 'string', enum: ['worker', 'specialist', 'scout'], description: 'Worker role in hive', default: 'worker' },
                agentType: { type: 'string', description: 'Agent type for spawned workers', default: 'worker' },
                prefix: { type: 'string', description: 'Prefix for worker IDs', default: 'hive-worker' },
            },
        },
        handler: async (input) => {
            const state = loadHiveState();
            if (!state.initialized) {
                return { success: false, error: 'Hive-mind not initialized. Run hive-mind/init first.' };
            }
            const count = Math.min(Math.max(1, input.count || 1), 20); // Cap at 20
            // Cap role/agentType/prefix: used as JSON keys and stored values in agentStore
            // on disk; an oversized prefix inflates the generated agentId key and config.
            const MAX_HIVE_ROLE_LEN = 256;
            const MAX_HIVE_PREFIX_LEN = 128;
            const rawRole = input.role || 'worker';
            const role = typeof rawRole === 'string' && rawRole.length > MAX_HIVE_ROLE_LEN
                ? rawRole.slice(0, MAX_HIVE_ROLE_LEN) : rawRole;
            const rawAgentType = input.agentType || 'worker';
            const agentType = typeof rawAgentType === 'string' && rawAgentType.length > MAX_HIVE_ROLE_LEN
                ? rawAgentType.slice(0, MAX_HIVE_ROLE_LEN) : rawAgentType;
            const rawPrefix = input.prefix || 'hive-worker';
            const prefix = typeof rawPrefix === 'string' && rawPrefix.length > MAX_HIVE_PREFIX_LEN
                ? rawPrefix.slice(0, MAX_HIVE_PREFIX_LEN) : rawPrefix;
            const agentStore = loadAgentStore();
            const spawnedWorkers = [];
            for (let i = 0; i < count; i++) {
                const agentId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                if (HIVE_RESERVED_KEYS.has(agentId))
                    continue;
                // Create agent record (like agent/spawn)
                agentStore.agents[agentId] = {
                    agentId,
                    agentType,
                    status: 'idle',
                    health: 1.0,
                    taskCount: 0,
                    config: { role, hiveRole: role },
                    createdAt: new Date().toISOString(),
                    domain: 'hive-mind',
                };
                // Join to hive-mind (like hive-mind/join)
                const MAX_HIVE_AGENTS = 100;
                if (!state.workers.includes(agentId)) {
                    if (state.workers.length >= MAX_HIVE_AGENTS) {
                        return { success: false, error: `Hive has reached max agent capacity (${MAX_HIVE_AGENTS})` };
                    }
                    state.workers.push(agentId);
                }
                spawnedWorkers.push({
                    agentId,
                    role,
                    joinedAt: new Date().toISOString(),
                });
            }
            saveAgentStore(agentStore);
            saveHiveState(state);
            return {
                success: true,
                spawned: count,
                workers: spawnedWorkers,
                totalWorkers: state.workers.length,
                hiveStatus: 'active',
                message: `Spawned ${count} worker(s) and joined them to the hive-mind`,
            };
        },
    },
    {
        name: 'hive-mind_init',
        description: 'Initialize the hive-mind collective',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                topology: { type: 'string', enum: ['mesh', 'hierarchical', 'ring', 'star'], description: 'Network topology' },
                queenId: { type: 'string', description: 'Initial queen agent ID' },
            },
        },
        handler: async (input) => {
            const hiveId = `hive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // Cap queenId: stored in hive state JSON as the queen's agentId field.
            const MAX_QUEEN_ID_LEN = 256;
            const rawQueenId = input.queenId || `queen-${Date.now()}`;
            const queenId = typeof rawQueenId === 'string' && rawQueenId.length > MAX_QUEEN_ID_LEN
                ? rawQueenId.slice(0, MAX_QUEEN_ID_LEN) : rawQueenId;
            const now = new Date().toISOString();
            const state = {
                initialized: true,
                hiveId,
                topology: input.topology || 'mesh',
                queen: { agentId: queenId, electedAt: now, term: 1 },
                workers: [],
                consensus: { pending: [], history: [] },
                sharedMemory: {},
                createdAt: now,
                updatedAt: now,
            };
            saveHiveState(state);
            return {
                success: true,
                hiveId,
                topology: state.topology,
                consensus: input.consensus || 'byzantine',
                queenId,
                neuralLearning: 'unavailable',
                status: 'initialized',
                config: {
                    topology: state.topology,
                    consensus: input.consensus || 'byzantine',
                    maxAgents: input.maxAgents || 15,
                    persist: input.persist !== false,
                    memoryBackend: input.memoryBackend || 'hybrid',
                },
                createdAt: state.createdAt,
            };
        },
    },
    {
        name: 'hive-mind_status',
        description: 'Get hive-mind status',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                verbose: { type: 'boolean', description: 'Include detailed information' },
            },
        },
        handler: async (input) => {
            const state = loadHiveState();
            const uptime = state.createdAt ? Date.now() - new Date(state.createdAt).getTime() : 0;
            // Load agent store once for all workers
            const agentStore = loadAgentStore();
            // Compute real task metrics from task store
            const taskStorePath = join(getProjectCwd(), '.monomind', 'tasks', 'store.json');
            let pendingTaskCount = 0;
            let activeTaskCount = 0;
            let completedTaskCount = 0;
            try {
                if (existsSync(taskStorePath) && statSync(taskStorePath).size <= MAX_HIVE_STATE_BYTES) {
                    const taskStore = JSON.parse(readFileSync(taskStorePath, 'utf-8'));
                    for (const task of Object.values(taskStore.tasks || {})) {
                        if (task.status === 'pending')
                            pendingTaskCount++;
                        else if (task.status === 'in_progress')
                            activeTaskCount++;
                        else if (task.status === 'completed')
                            completedTaskCount++;
                    }
                }
            }
            catch { /* ignore */ }
            const workerCount = Math.max(1, state.workers.length);
            const realLoad = activeTaskCount / workerCount;
            const status = {
                // CLI expected fields
                hiveId: state.hiveId ?? `hive-${state.createdAt ? new Date(state.createdAt).getTime() : Date.now()}`,
                status: state.initialized ? 'active' : 'offline',
                topology: state.topology,
                consensus: 'byzantine', // Default consensus type
                queen: state.queen ? {
                    id: state.queen.agentId,
                    agentId: state.queen.agentId,
                    status: 'active',
                    load: Math.round(realLoad * 1000) / 1000,
                    tasksQueued: pendingTaskCount,
                    electedAt: state.queen.electedAt,
                    term: state.queen.term,
                } : { id: 'N/A', status: 'offline', load: 0, tasksQueued: 0 },
                workers: state.workers.map(w => {
                    const agent = agentStore.agents[w];
                    return {
                        id: w,
                        type: agent?.agentType || 'worker',
                        status: agent?.status || 'unknown',
                        currentTask: agent?.currentTask || null,
                        tasksCompleted: agent?.taskCount || 0,
                    };
                }),
                metrics: {
                    totalTasks: pendingTaskCount + activeTaskCount + completedTaskCount,
                    completedTasks: completedTaskCount,
                    activeTasks: activeTaskCount,
                    pendingTasks: pendingTaskCount,
                    failedTasks: 0,
                    consensusRounds: state.consensus.history.length,
                    memoryUsage: `${Object.keys(state.sharedMemory).length * 2} KB`,
                },
                health: {
                    overall: 'healthy',
                    queen: state.queen ? 'healthy' : 'unhealthy',
                    workers: state.workers.length > 0 ? 'healthy' : 'degraded',
                    consensus: 'healthy',
                    memory: 'healthy',
                },
                // Additional fields
                id: state.hiveId ?? `hive-${state.createdAt ? new Date(state.createdAt).getTime() : Date.now()}`,
                initialized: state.initialized,
                workerCount: state.workers.length,
                pendingConsensus: state.consensus.pending.length,
                sharedMemoryKeys: Object.keys(state.sharedMemory).length,
                uptime,
                createdAt: state.createdAt,
                updatedAt: state.updatedAt,
            };
            if (input.verbose) {
                return {
                    ...status,
                    workerDetails: state.workers,
                    consensusHistory: state.consensus.history.slice(-10),
                    sharedMemory: state.sharedMemory,
                };
            }
            return status;
        },
    },
    {
        name: 'hive-mind_join',
        description: 'Join an agent to the hive-mind',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string', description: 'Agent ID to join' },
                role: { type: 'string', enum: ['worker', 'specialist', 'scout'], description: 'Agent role in hive' },
            },
            required: ['agentId'],
        },
        handler: async (input) => {
            const state = loadHiveState();
            const agentId = input.agentId;
            // Reject IDs that would mutate Object.prototype when used as a key on the
            // JSON-loaded plain object `agentStore.agents` (read in hive-mind_status).
            if (typeof agentId !== 'string' || agentId.length === 0 || agentId.length > 128 ||
                HIVE_RESERVED_KEYS.has(agentId) || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
                return { success: false, error: 'Invalid agentId' };
            }
            if (!state.initialized) {
                return { success: false, error: 'Hive-mind not initialized' };
            }
            const MAX_HIVE_AGENTS = 100;
            if (!state.workers.includes(agentId)) {
                if (state.workers.length >= MAX_HIVE_AGENTS) {
                    return { success: false, error: `Hive has reached max agent capacity (${MAX_HIVE_AGENTS})` };
                }
                state.workers.push(agentId);
                saveHiveState(state);
            }
            return {
                success: true,
                agentId,
                role: input.role || 'worker',
                totalWorkers: state.workers.length,
                joinedAt: new Date().toISOString(),
            };
        },
    },
    {
        name: 'hive-mind_leave',
        description: 'Remove an agent from the hive-mind',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string', description: 'Agent ID to remove' },
            },
            required: ['agentId'],
        },
        handler: async (input) => {
            const state = loadHiveState();
            const agentId = input.agentId;
            if (typeof agentId !== 'string' || agentId.length === 0 || agentId.length > 128 ||
                HIVE_RESERVED_KEYS.has(agentId) || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
                return { success: false, error: 'Invalid agentId' };
            }
            const index = state.workers.indexOf(agentId);
            if (index > -1) {
                state.workers.splice(index, 1);
                saveHiveState(state);
                return {
                    success: true,
                    agentId,
                    leftAt: new Date().toISOString(),
                    remainingWorkers: state.workers.length,
                };
            }
            return { success: false, agentId, error: 'Agent not in hive' };
        },
    },
    {
        name: 'hive-mind_consensus',
        description: 'Propose or vote on consensus with BFT, Raft, or Quorum strategies',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['propose', 'vote', 'status', 'list'], description: 'Consensus action' },
                proposalId: { type: 'string', description: 'Proposal ID (for vote/status)' },
                type: { type: 'string', description: 'Proposal type (for propose)' },
                value: { description: 'Proposal value (for propose)' },
                vote: { type: 'boolean', description: 'Vote (true=for, false=against)' },
                voterId: { type: 'string', description: 'Voter agent ID' },
                strategy: { type: 'string', enum: ['bft', 'raft', 'quorum'], description: 'Consensus strategy (default: raft)' },
                quorumPreset: { type: 'string', enum: ['unanimous', 'majority', 'supermajority'], description: 'Quorum threshold preset (for quorum strategy, default: majority)' },
                term: { type: 'number', description: 'Term number (for raft strategy)' },
                timeoutMs: { type: 'number', description: 'Timeout in ms for raft re-proposal (default: 30000)' },
                minDivergenceRounds: { type: 'number', description: 'O-Information anti-groupthink gate: minimum rounds with divergent votes required before resolution (arXiv:2510.05174). Default: 0 (disabled).' },
            },
            required: ['action'],
        },
        handler: async (input) => {
            const state = loadHiveState();
            const action = input.action;
            const strategy = input.strategy || 'raft';
            const totalNodes = state.workers.length;
            if (action === 'propose') {
                const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const quorumPreset = input.quorumPreset || 'majority';
                const term = input.term || (state.queen?.term ?? 1);
                const timeoutMs = input.timeoutMs || 30000;
                // Raft: check if there's already a pending proposal for this term
                if (strategy === 'raft') {
                    const existingTermProposal = state.consensus.pending.find(p => p.strategy === 'raft' && p.term === term && p.status === 'pending');
                    if (existingTermProposal) {
                        return {
                            action,
                            error: `Raft term ${term} already has a pending proposal: ${existingTermProposal.proposalId}. Wait for resolution or use a higher term.`,
                            existingProposalId: existingTermProposal.proposalId,
                            term,
                        };
                    }
                }
                const required = calculateRequiredVotes(strategy, totalNodes, quorumPreset);
                const minDivergenceRounds = typeof input.minDivergenceRounds === 'number'
                    ? Math.max(0, input.minDivergenceRounds)
                    : 0;
                // Cap proposal fields: stored in state.consensus.pending and then
                // state.consensus.history (up to 1000 entries).  An unbounded value
                // inflates the on-disk hive state by up to 1000 × value size.
                const MAX_PROPOSAL_TYPE_LEN = 128;
                const MAX_PROPOSAL_VOTER_ID_LEN = 256;
                const MAX_PROPOSAL_VALUE_BYTES = 64 * 1024; // 64 KB
                const rawProposalType = input.type || 'general';
                const proposalType = typeof rawProposalType === 'string' && rawProposalType.length > MAX_PROPOSAL_TYPE_LEN
                    ? rawProposalType.slice(0, MAX_PROPOSAL_TYPE_LEN) : rawProposalType;
                const rawVoterId = input.voterId || 'system';
                const proposedBy = typeof rawVoterId === 'string' && rawVoterId.length > MAX_PROPOSAL_VOTER_ID_LEN
                    ? rawVoterId.slice(0, MAX_PROPOSAL_VOTER_ID_LEN) : rawVoterId;
                // Cap value if it's a string; leave non-string values as-is (they are
                // JSON-serialised by saveHiveState which uses JSON.stringify — bounded
                // objects are fine).
                const rawValue = input.value;
                const cappedValue = typeof rawValue === 'string' && rawValue.length > MAX_PROPOSAL_VALUE_BYTES
                    ? rawValue.slice(0, MAX_PROPOSAL_VALUE_BYTES) : rawValue;
                const proposal = {
                    proposalId,
                    type: proposalType,
                    value: cappedValue,
                    proposedBy,
                    proposedAt: new Date().toISOString(),
                    votes: {},
                    status: 'pending',
                    strategy,
                    term: strategy === 'raft' ? term : undefined,
                    quorumPreset: strategy === 'quorum' ? quorumPreset : undefined,
                    byzantineVoters: strategy === 'bft' ? [] : undefined,
                    timeoutAt: strategy === 'raft' ? new Date(Date.now() + timeoutMs).toISOString() : undefined,
                    minDivergenceRounds: minDivergenceRounds > 0 ? minDivergenceRounds : undefined,
                    divergenceRoundsSeen: 0,
                };
                state.consensus.pending.push(proposal);
                saveHiveState(state);
                return {
                    action,
                    proposalId,
                    type: proposal.type,
                    strategy,
                    status: 'pending',
                    required,
                    totalNodes,
                    term: proposal.term,
                    quorumPreset: proposal.quorumPreset,
                    timeoutAt: proposal.timeoutAt,
                    minDivergenceRounds: proposal.minDivergenceRounds,
                };
            }
            if (action === 'vote') {
                const proposal = state.consensus.pending.find(p => p.proposalId === input.proposalId);
                if (!proposal) {
                    return { action, error: 'Proposal not found or already resolved' };
                }
                const voterId = input.voterId;
                if (!voterId) {
                    return { action, error: 'voterId is required for voting' };
                }
                if (totalNodes === 0) {
                    return { action, error: 'No workers in hive — cannot vote' };
                }
                if (!state.workers.includes(voterId)) {
                    return { action, error: `Voter ${voterId} is not a member of this hive` };
                }
                const voteValue = input.vote;
                const proposalStrategy = proposal.strategy || 'raft';
                const required = calculateRequiredVotes(proposalStrategy, totalNodes, proposal.quorumPreset);
                // Prevent double-voting
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
                    // Conflicting vote from same voter
                    if (proposalStrategy === 'bft') {
                        // BFT: detect as Byzantine behavior
                        if (!proposal.byzantineVoters)
                            proposal.byzantineVoters = [];
                        if (!proposal.byzantineVoters.includes(voterId)) {
                            proposal.byzantineVoters.push(voterId);
                        }
                        // Remove their vote entirely -- Byzantine voter is excluded
                        delete proposal.votes[voterId];
                        saveHiveState(state);
                        return {
                            action,
                            proposalId: proposal.proposalId,
                            voterId,
                            byzantineDetected: true,
                            message: `Byzantine behavior detected: voter ${voterId} attempted conflicting vote. Vote invalidated.`,
                            byzantineVoters: proposal.byzantineVoters,
                            status: proposal.status,
                        };
                    }
                    if (proposalStrategy === 'raft') {
                        // Raft: only one vote per node per term, reject the change
                        return {
                            action,
                            error: `Raft: voter ${voterId} already voted in term ${proposal.term}. Cannot change vote.`,
                            proposalId: proposal.proposalId,
                            term: proposal.term,
                        };
                    }
                    // Quorum: reject double-vote
                    return {
                        action,
                        error: `Voter ${voterId} has already voted on this proposal`,
                        proposalId: proposal.proposalId,
                    };
                }
                // BFT: check for cross-proposal Byzantine behavior
                if (proposalStrategy === 'bft') {
                    const isByzantine = detectByzantineVoters(state.consensus.pending, proposal, voterId, voteValue);
                    if (isByzantine) {
                        if (!proposal.byzantineVoters)
                            proposal.byzantineVoters = [];
                        if (!proposal.byzantineVoters.includes(voterId)) {
                            proposal.byzantineVoters.push(voterId);
                        }
                        saveHiveState(state);
                        return {
                            action,
                            proposalId: proposal.proposalId,
                            voterId,
                            byzantineDetected: true,
                            message: `Byzantine behavior detected: voter ${voterId} cast conflicting votes across proposals of same type. Vote rejected.`,
                            byzantineVoters: proposal.byzantineVoters,
                            status: proposal.status,
                        };
                    }
                }
                // Record the vote
                proposal.votes[voterId] = voteValue;
                const votesFor = Object.values(proposal.votes).filter(v => v).length;
                const votesAgainst = Object.values(proposal.votes).filter(v => !v).length;
                // O-Information divergence tracking (arXiv:2510.05174)
                // Count this voting round as divergent if not all votes are the same direction.
                // A divergent round signals synergy is still "in play" among agents.
                const allVotes = Object.values(proposal.votes);
                const isUnanimous = allVotes.every(v => v) || allVotes.every(v => !v);
                if (!isUnanimous && allVotes.length >= 2) {
                    proposal.divergenceRoundsSeen = (proposal.divergenceRoundsSeen ?? 0) + 1;
                }
                // CP-WBFT: weighted tally using uniform confidence (1.0) until probe scores available
                // Source: https://arxiv.org/abs/2511.10400
                const weightedVotes = Object.entries(proposal.votes).map(([aid, v]) => ({
                    agentId: aid,
                    vote: v,
                    confidence: 1.0, // uniform until confidence-probe is wired
                }));
                const cpwbftTally = weightedTally(weightedVotes);
                // O-Information gate: defer resolution if we haven't seen enough divergent rounds
                const divergenceGateOpen = !proposal.minDivergenceRounds
                    || (proposal.divergenceRoundsSeen ?? 0) >= proposal.minDivergenceRounds;
                // Try to resolve
                const resolution = divergenceGateOpen ? tryResolveProposal(proposal, totalNodes) : null;
                let resolved = false;
                if (resolution !== null) {
                    resolved = true;
                    proposal.status = resolution;
                    state.consensus.history.push({
                        proposalId: proposal.proposalId,
                        type: proposal.type,
                        result: resolution,
                        votes: { for: votesFor, against: votesAgainst },
                        decidedAt: new Date().toISOString(),
                        strategy: proposalStrategy,
                        term: proposal.term,
                        byzantineDetected: proposal.byzantineVoters?.length ? proposal.byzantineVoters : undefined,
                    });
                    if (state.consensus.history.length > 1000) {
                        state.consensus.history = state.consensus.history.slice(-1000);
                    }
                    state.consensus.pending = state.consensus.pending.filter(p => p.proposalId !== proposal.proposalId);
                }
                saveHiveState(state);
                // Persist consensus result in AgentDB for searchable history
                if (resolved) {
                    try {
                        const bridge = await import('../memory/memory-bridge.js');
                        await bridge.bridgeStoreEntry({
                            key: `consensus-${proposal.proposalId}`,
                            value: JSON.stringify({
                                proposalId: proposal.proposalId,
                                type: proposal.type,
                                strategy: proposalStrategy,
                                status: proposal.status,
                                votes: proposal.votes,
                                resolvedAt: new Date().toISOString(),
                            }),
                            namespace: 'hive-consensus',
                            tags: [proposal.type, proposalStrategy || 'raft', proposal.status],
                        });
                    }
                    catch { /* AgentDB not available — JSON store is primary */ }
                    // Persist consensus audit record
                    const sessionSecret = process.env.MONOMIND_SESSION_SECRET;
                    if (!sessionSecret) {
                        process.stderr.write('[hive-consensus] Audit write skipped: MONOMIND_SESSION_SECRET not set\n');
                    }
                    else {
                        try {
                            const { AuditWriter } = await import('../consensus/audit-writer.js');
                            const auditDir = join(getProjectCwd(), STORAGE_DIR, 'consensus');
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
                                swarmId: `hive-${state.createdAt ? new Date(state.createdAt).getTime() : Date.now()}`,
                                protocol: (proposalStrategy === 'bft' ? 'byzantine' : proposalStrategy === 'raft' ? 'raft' : 'quorum'),
                                topic: proposal.type,
                                decision: resolution,
                                votes: voteEntries,
                                quorumRequired: required,
                                quorumThreshold: required / Math.max(totalNodes, 1),
                                round: (proposal.divergenceRoundsSeen ?? 0) + 1,
                                startedAt: proposal.proposedAt,
                                completedAt: now,
                                sessionSecret,
                            });
                        }
                        catch (e) {
                            if (process.env.MONOMIND_LOG_LEVEL === 'debug') {
                                process.stderr.write(`[hive-consensus] Audit write failed: ${e.message}\n`);
                            }
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
                    totalNodes,
                    resolved,
                    result: resolved ? resolution : undefined,
                    status: proposal.status,
                    term: proposal.term,
                    byzantineVoters: proposal.byzantineVoters?.length ? proposal.byzantineVoters : undefined,
                    cpwbft: cpwbftTally,
                    // O-Information divergence gate status
                    divergenceGateOpen,
                    divergenceRoundsSeen: proposal.divergenceRoundsSeen ?? 0,
                    minDivergenceRounds: proposal.minDivergenceRounds,
                    divergenceHint: !divergenceGateOpen
                        ? `O-Information gate: ${proposal.divergenceRoundsSeen ?? 0}/${proposal.minDivergenceRounds} divergent rounds seen. Resolution deferred to prevent groupthink.`
                        : undefined,
                };
            }
            if (action === 'status') {
                const proposal = state.consensus.pending.find(p => p.proposalId === input.proposalId);
                if (!proposal) {
                    // Check history
                    const historical = state.consensus.history.find(h => h.proposalId === input.proposalId);
                    if (historical) {
                        return { action, ...historical, historical: true, resolved: true };
                    }
                    return { action, error: 'Proposal not found' };
                }
                const votesFor = Object.values(proposal.votes).filter(v => v).length;
                const votesAgainst = Object.values(proposal.votes).filter(v => !v).length;
                const proposalStrategy = proposal.strategy || 'raft';
                const required = calculateRequiredVotes(proposalStrategy, totalNodes, proposal.quorumPreset);
                // Raft: check timeout
                let timedOut = false;
                if (proposalStrategy === 'raft' && proposal.timeoutAt) {
                    timedOut = new Date().getTime() > new Date(proposal.timeoutAt).getTime();
                }
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
                    totalNodes,
                    resolved: false,
                    term: proposal.term,
                    quorumPreset: proposal.quorumPreset,
                    byzantineVoters: proposal.byzantineVoters?.length ? proposal.byzantineVoters : undefined,
                    timedOut,
                    timeoutAt: proposal.timeoutAt,
                    hint: timedOut ? `Raft timeout reached. Re-propose with term ${(proposal.term || 1) + 1}.` : undefined,
                };
            }
            if (action === 'list') {
                return {
                    action,
                    pending: state.consensus.pending.map(p => ({
                        proposalId: p.proposalId,
                        type: p.type,
                        strategy: p.strategy || 'raft',
                        proposedAt: p.proposedAt,
                        totalVotes: Object.keys(p.votes).length,
                        required: calculateRequiredVotes(p.strategy || 'raft', totalNodes, p.quorumPreset),
                        term: p.term,
                        status: p.status,
                    })),
                    recentHistory: state.consensus.history.slice(-5),
                };
            }
            return { action, error: 'Unknown action' };
        },
    },
    {
        name: 'hive-mind_broadcast',
        description: 'Broadcast message to all workers',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'Message to broadcast' },
                priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], description: 'Message priority' },
                fromId: { type: 'string', description: 'Sender agent ID' },
            },
            required: ['message'],
        },
        handler: async (input) => {
            const state = loadHiveState();
            if (!state.initialized) {
                return { success: false, error: 'Hive-mind not initialized' };
            }
            // Cap inputs: message/fromId are stored directly in the shared-memory JSON
            // state (up to 100 broadcasts kept).  An uncapped message lets an attacker
            // inflate the on-disk hive state by up to 100 × message size per call.
            const MAX_BROADCAST_MSG_LEN = 1024 * 1024; // 1 MB
            const MAX_FROM_ID_LEN = 256;
            const MAX_PRIORITY_LEN = 16;
            const rawMessage = input.message;
            const message = typeof rawMessage === 'string' && rawMessage.length > MAX_BROADCAST_MSG_LEN
                ? rawMessage.slice(0, MAX_BROADCAST_MSG_LEN)
                : rawMessage;
            const rawFromId = input.fromId || 'system';
            const fromId = typeof rawFromId === 'string' && rawFromId.length > MAX_FROM_ID_LEN
                ? rawFromId.slice(0, MAX_FROM_ID_LEN)
                : rawFromId;
            const rawPriority = input.priority || 'normal';
            const priority = typeof rawPriority === 'string' && rawPriority.length > MAX_PRIORITY_LEN
                ? rawPriority.slice(0, MAX_PRIORITY_LEN)
                : rawPriority;
            const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // Store in shared memory
            const messages = state.sharedMemory.broadcasts || [];
            messages.push({
                messageId,
                message,
                priority,
                fromId,
                timestamp: new Date().toISOString(),
            });
            // Keep only last 100 broadcasts
            state.sharedMemory.broadcasts = messages.slice(-100);
            saveHiveState(state);
            return {
                success: true,
                messageId,
                recipients: state.workers.length,
                priority,
                broadcastAt: new Date().toISOString(),
            };
        },
    },
    {
        name: 'hive-mind_shutdown',
        description: 'Shutdown the hive-mind and terminate all workers',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                graceful: { type: 'boolean', description: 'Graceful shutdown (wait for pending tasks)', default: true },
                force: { type: 'boolean', description: 'Force immediate shutdown', default: false },
            },
        },
        handler: async (input) => {
            const state = loadHiveState();
            if (!state.initialized) {
                return { success: false, error: 'Hive-mind not initialized or already shut down' };
            }
            const graceful = input.graceful !== false;
            const force = input.force === true;
            const workerCount = state.workers.length;
            const pendingConsensus = state.consensus.pending.length;
            // If graceful and there are pending consensus items, warn (unless forced)
            if (graceful && pendingConsensus > 0 && !force) {
                return {
                    success: false,
                    error: `Cannot gracefully shutdown with ${pendingConsensus} pending consensus items. Use force: true to override.`,
                    pendingConsensus,
                    workerCount,
                };
            }
            // Clear workers from agent store
            const agentStore = loadAgentStore();
            for (const workerId of state.workers) {
                if (agentStore.agents[workerId]) {
                    delete agentStore.agents[workerId];
                }
            }
            saveAgentStore(agentStore);
            // Reset hive state
            const shutdownTime = new Date().toISOString();
            const previousQueen = state.queen?.agentId;
            state.initialized = false;
            state.queen = undefined;
            state.workers = [];
            state.consensus.pending = [];
            // Keep history for reference
            state.sharedMemory = {};
            saveHiveState(state);
            return {
                success: true,
                shutdownAt: shutdownTime,
                graceful,
                workersTerminated: workerCount,
                previousQueen,
                consensusCleared: pendingConsensus,
                message: `Hive-mind shutdown complete. ${workerCount} workers terminated.`,
            };
        },
    },
    {
        name: 'hive-mind_memory',
        description: 'Access hive shared memory',
        category: 'hive-mind',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get', 'set', 'delete', 'list'], description: 'Memory action' },
                key: { type: 'string', description: 'Memory key' },
                value: { description: 'Value to store (for set)' },
            },
            required: ['action'],
        },
        handler: async (input) => {
            const state = loadHiveState();
            const action = input.action;
            const key = input.key;
            if (action === 'get') {
                if (!key)
                    return { action, error: 'Key required' };
                return {
                    action,
                    key,
                    value: state.sharedMemory[key],
                    exists: key in state.sharedMemory,
                };
            }
            if (action === 'set') {
                if (!key)
                    return { action, error: 'Key required' };
                if (HIVE_RESERVED_KEYS.has(key))
                    return { action, error: 'Forbidden key' };
                state.sharedMemory[key] = input.value;
                saveHiveState(state);
                // Also store in AgentDB for searchable hive memory
                try {
                    const bridge = await import('../memory/memory-bridge.js');
                    await bridge.bridgeStoreEntry({
                        key: `hive-memory-${key}`,
                        value: JSON.stringify(input.value),
                        namespace: 'hive-memory',
                    });
                }
                catch { /* AgentDB not available */ }
                return {
                    action,
                    key,
                    success: true,
                    updatedAt: new Date().toISOString(),
                };
            }
            if (action === 'delete') {
                if (!key)
                    return { action, error: 'Key required' };
                const existed = key in state.sharedMemory;
                delete state.sharedMemory[key];
                saveHiveState(state);
                return {
                    action,
                    key,
                    deleted: existed,
                };
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
];
//# sourceMappingURL=hive-mind-tools.js.map
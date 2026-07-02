/**
 * Hive Mind shared types, constants, and format helpers
 */
import { output } from '../output.js';
// Input length caps
export const MAX_OBJECTIVE_LEN = 2_000;
export const MAX_TASK_DESC_LEN = 4_000;
export const MAX_MESSAGE_LEN = 2_000;
export const MAX_KEY_LEN = 256;
export const MAX_VALUE_LEN = 65_536;
export const MAX_AGENT_ID_LEN = 128;
export const TOPOLOGIES = [
    { value: 'hierarchical', label: 'Hierarchical', hint: 'Queen-led with worker agents' },
    { value: 'mesh', label: 'Mesh', hint: 'Peer-to-peer coordination' },
    { value: 'hierarchical-mesh', label: 'Hierarchical Mesh', hint: 'Queen + peer communication (recommended)' },
    { value: 'adaptive', label: 'Adaptive', hint: 'Dynamic topology based on task' }
];
export const CONSENSUS_STRATEGIES = [
    { value: 'byzantine', label: 'Byzantine Fault Tolerant', hint: '2/3 majority, handles malicious actors' },
    { value: 'raft', label: 'Raft', hint: 'Leader-based consensus' },
    { value: 'gossip', label: 'Gossip', hint: 'Eventually consistent, scalable' },
    { value: 'crdt', label: 'CRDT', hint: 'Conflict-free replicated data' },
    { value: 'quorum', label: 'Quorum', hint: 'Simple majority voting' }
];
export function groupWorkersByType(workers) {
    const groups = {};
    for (const worker of workers) {
        const type = worker.type || worker.role || 'worker';
        if (!groups[type]) {
            groups[type] = [];
        }
        groups[type].push(worker);
    }
    return groups;
}
export function generateHiveMindPrompt(swarmId, swarmName, objective, workers, workerGroups, flags) {
    const currentTime = new Date().toISOString();
    const workerTypes = Object.keys(workerGroups);
    const queenType = flags.queenType || 'strategic';
    const consensusAlgorithm = flags.consensus || 'byzantine';
    const topology = flags.topology || 'hierarchical-mesh';
    return `🧠 HIVE MIND COLLECTIVE INTELLIGENCE SYSTEM
═══════════════════════════════════════════════

You are the Queen coordinator of a Hive Mind swarm with collective intelligence capabilities.

HIVE MIND CONFIGURATION:
📌 Swarm ID: ${swarmId}
📌 Swarm Name: ${swarmName}
🎯 Objective: ${objective}
👑 Queen Type: ${queenType}
🐝 Worker Count: ${workers.length}
🔗 Topology: ${topology}
🤝 Consensus Algorithm: ${consensusAlgorithm}
⏰ Initialized: ${currentTime}

WORKER DISTRIBUTION:
${workerTypes.map(type => `• ${type}: ${workerGroups[type].length} agents`).join('\n')}

🔧 AVAILABLE MCP TOOLS FOR HIVE MIND COORDINATION:

1️⃣ **COLLECTIVE INTELLIGENCE**
   mcp__monomind__hive-mind_consensus    - Democratic decision making
   mcp__monomind__hive-mind_memory       - Share knowledge across the hive
   mcp__monomind__hive-mind_broadcast    - Broadcast to all workers
   mcp__monomind__neural_patterns        - Neural pattern recognition

2️⃣ **QUEEN COORDINATION**
   mcp__monomind__hive-mind_status       - Monitor swarm health
   mcp__monomind__task_create            - Create and delegate tasks
   mcp__monomind__coordination_orchestrate - Orchestrate task distribution
   mcp__monomind__agent_spawn            - Spawn additional workers

3️⃣ **WORKER MANAGEMENT**
   mcp__monomind__agent_list             - List all active agents
   mcp__monomind__agent_status           - Check agent status
   mcp__monomind__agent_health           - Check worker health
   mcp__monomind__hive-mind_join         - Add agent to hive
   mcp__monomind__hive-mind_leave        - Remove agent from hive

4️⃣ **TASK ORCHESTRATION**
   mcp__monomind__task_assign            - Assign tasks to workers
   mcp__monomind__task_status            - Track task progress
   mcp__monomind__task_complete          - Mark tasks complete
   mcp__monomind__workflow_create        - Create workflows

5️⃣ **MEMORY & LEARNING**
   mcp__monomind__memory_store           - Store collective knowledge
   mcp__monomind__memory_retrieve        - Access shared memory
   mcp__monomind__memory_search          - Search memory patterns
   mcp__monomind__neural_train           - Learn from experiences
   mcp__monomind__hooks_intelligence_pattern-store - Store patterns

📋 HIVE MIND EXECUTION PROTOCOL:

1. **INITIALIZATION PHASE**
   - Verify all workers are online and responsive
   - Establish communication channels
   - Load previous session state if available
   - Initialize shared memory space

2. **TASK DISTRIBUTION PHASE**
   - Analyze the objective and decompose into subtasks
   - Assign tasks based on worker specializations
   - Set up task dependencies and ordering
   - Monitor parallel execution

3. **COORDINATION PHASE**
   - Use consensus for critical decisions
   - Aggregate results from workers
   - Resolve conflicts using ${consensusAlgorithm} consensus
   - Share learnings across the hive

4. **COMPLETION PHASE**
   - Verify all subtasks are complete
   - Consolidate results
   - Store learnings in collective memory
   - Report final status

🎯 YOUR OBJECTIVE:
${objective}

⚠️ CRITICAL — TOOL PREFERENCE RULES (#1422):
• You MUST use Monomind MCP tools (mcp__monomind__*) for ALL orchestration tasks
• Do NOT use Claude native Task/Agent tools for swarm coordination — use mcp__monomind__agent_spawn, mcp__monomind__task_assign, etc.
• Native Claude tools (Read, Write, Edit, Bash, Grep, Glob) should ONLY be used for file operations and shell commands
• All agent spawning, task assignment, memory, and coordination MUST go through mcp__monomind__* tools
• If a Monomind MCP tool exists for an operation, always prefer it over any native equivalent

💡 COORDINATION TIPS:
• Use mcp__monomind__hive-mind_broadcast for swarm-wide announcements
• Check worker status regularly with mcp__monomind__hive-mind_status
• Store important decisions in shared memory for persistence
• Use consensus for any decisions affecting multiple workers
• Use mcp__monomind__task_assign to assign tasks to workers, then mcp__monomind__task_complete when done

🚀 BEGIN HIVE MIND COORDINATION NOW!
Start by checking the current hive status and then proceed with the objective.
`;
}
export function formatAgentStatus(status) {
    const statusStr = String(status);
    switch (statusStr) {
        case 'active':
        case 'ready':
        case 'running':
            return output.success(statusStr);
        case 'idle':
        case 'waiting':
            return output.dim(statusStr);
        case 'busy':
            return output.highlight(statusStr);
        case 'error':
        case 'failed':
            return output.error(statusStr);
        default:
            return statusStr;
    }
}
export function formatHiveStatus(status) {
    switch (status) {
        case 'active':
            return output.success(status);
        case 'idle':
            return output.dim(status);
        case 'degraded':
            return output.warning(status);
        case 'offline':
            return output.error(status);
        default:
            return status;
    }
}
export function formatHealth(health) {
    switch (health) {
        case 'healthy':
        case 'good':
            return output.success(health);
        case 'warning':
        case 'degraded':
            return output.warning(health);
        case 'critical':
        case 'unhealthy':
            return output.error(health);
        default:
            return health;
    }
}
export function formatPriority(priority) {
    switch (priority) {
        case 'critical':
            return output.error(priority.toUpperCase());
        case 'high':
            return output.warning(priority);
        case 'normal':
            return priority;
        case 'low':
            return output.dim(priority);
        default:
            return priority;
    }
}
//# sourceMappingURL=hive-mind-helpers.js.map
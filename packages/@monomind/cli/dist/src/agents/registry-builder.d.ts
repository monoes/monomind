type TriggerPattern = {
    pattern: string;
    mode: 'glob' | 'regex' | 'exact';
};
type AgentRegistryEntry = {
    slug: string;
    name: string;
    version: string;
    category: string;
    description: string;
    capabilities: string[];
    taskTypes: string[];
    tools: string[];
    triggers: TriggerPattern[];
    deprecated: boolean;
    deprecatedBy?: string;
    dependencies: string[];
    filePath: string;
    registeredAt: string;
    lastUpdated: string;
};
type AgentRegistry = {
    version: string;
    generatedAt: string;
    totalAgents: number;
    agents: AgentRegistryEntry[];
};
/**
 * Build the agent registry by scanning `.md` files under `agentsRoot`.
 *
 * @param agentsRoot - Root directory (or array of directories) to scan.
 * @param outputPath - Optional path to write the registry JSON file.
 * @returns The built AgentRegistry object.
 */
export declare function buildRegistry(agentsRoot: string, outputPath?: string): AgentRegistry;
/**
 * Compute the ordered list of agent-definition roots for `cwd`: extras
 * (canonical, from MONOMIND_EXTRA_AGENT_PATHS or a sibling `agency-agents`
 * dir) first, then the project's `.claude/agents`. Shared by CLI startup
 * and `monomind doctor` so both build the registry the same way.
 */
export declare function computeAgentRoots(cwd: string): string[];
/**
 * Build a unified agent registry from multiple root directories, deduplicating
 * by slug. When the same slug appears in more than one root, the entry from the
 * **first** root in the array wins (earlier roots are considered canonical).
 *
 * Typical usage — extras (agency-agents) listed first so they take precedence
 * over any locally duplicated copies in `.claude/agents/`:
 *
 * ```ts
 * buildUnifiedRegistry([
 *   '/path/to/agency-agents',   // canonical source — wins on conflict
 *   '.claude/agents',           // dev copies — used only for unique slugs
 * ], '.monomind/registry.json');
 * ```
 *
 * @param roots      - Ordered list of directories to scan (first-wins on slug conflict).
 * @param outputPath - Optional path to write the merged registry JSON file.
 * @returns The deduplicated AgentRegistry.
 */
export declare function buildUnifiedRegistry(roots: string[], outputPath?: string): AgentRegistry;
export {};
//# sourceMappingURL=registry-builder.d.ts.map
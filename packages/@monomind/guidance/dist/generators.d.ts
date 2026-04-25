/**
 * CLAUDE.md Generator
 *
 * Generates a structured CLAUDE.md file optimized for the Guidance Control Plane.
 * The output is designed so that when compiled by GuidanceCompiler, it produces
 * a clean constitution (always-loaded invariants) and well-tagged shards
 * (task-scoped rules retrievable by intent).
 *
 * Structure conventions:
 * - Lines 1-60: Constitution (always loaded into every task)
 * - Remaining: Tagged shards (retrieved by intent classification)
 * - Headings map to shard boundaries
 * - Keywords in headings drive intent tagging: "test", "build", "security", etc.
 *
 * @module @monobrain/guidance/generators
 */
export interface ProjectProfile {
    /** Project name */
    name: string;
    /** Short description */
    description?: string;
    /** Primary language(s) */
    languages: string[];
    /** Frameworks in use */
    frameworks?: string[];
    /** Package manager */
    packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
    /** Monorepo? */
    monorepo?: boolean;
    /** Build command */
    buildCommand?: string;
    /** Test command */
    testCommand?: string;
    /** Lint command */
    lintCommand?: string;
    /** Source directory */
    srcDir?: string;
    /** Test directory */
    testDir?: string;
    /** Domain-specific rules */
    domainRules?: string[];
    /** Architecture notes */
    architecture?: string;
    /** Team conventions */
    conventions?: string[];
    /** Forbidden patterns */
    forbidden?: string[];
    /** Required patterns */
    required?: string[];
    /** Import paths for personal instructions */
    imports?: string[];
    /** Enable guidance control plane integration */
    guidanceControlPlane?: boolean;
    /** Enable WASM kernel for hot paths */
    wasmKernel?: boolean;
    /** Agent swarm configuration */
    swarm?: {
        topology?: 'hierarchical' | 'mesh' | 'adaptive';
        maxAgents?: number;
        strategy?: 'specialized' | 'balanced';
    };
}
export interface LocalProfile {
    /** Developer name or identifier */
    developer?: string;
    /** Local API URLs */
    localUrls?: Record<string, string>;
    /** Local database connection strings */
    databases?: Record<string, string>;
    /** Personal preferences */
    preferences?: string[];
    /** Machine-specific notes */
    machineNotes?: string[];
    /** Editor / IDE */
    editor?: string;
    /** OS */
    os?: string;
    /** Custom environment variables */
    envVars?: Record<string, string>;
    /** Debug settings */
    debug?: string[];
}
export interface SkillDefinition {
    /** Skill name (kebab-case) */
    name: string;
    /** Version */
    version?: string;
    /** Description */
    description: string;
    /** Category */
    category: 'core' | 'github' | 'testing' | 'security' | 'deployment' | 'analysis' | 'custom';
    /** Tags */
    tags?: string[];
    /** Required tools */
    requires?: string[];
    /** Capabilities list */
    capabilities?: string[];
    /** Skill instructions (markdown body) */
    instructions: string;
}
export interface AgentDefinition {
    /** Agent name (kebab-case) */
    name: string;
    /** Agent type */
    type: 'coordinator' | 'developer' | 'tester' | 'reviewer' | 'security-specialist' | 'researcher' | 'architect' | 'devops' | 'custom';
    /** Description */
    description: string;
    /** Category subdirectory */
    category?: string;
    /** Color for UI */
    color?: string;
    /** Capabilities */
    capabilities?: string[];
    /** Focus areas */
    focus?: string[];
    /** Temperature (0.0-1.0) */
    temperature?: number;
    /** Priority */
    priority?: 'high' | 'medium' | 'low';
    /** System prompt */
    systemPrompt?: string;
    /** Pre-execution hook */
    preHook?: string;
    /** Post-execution hook */
    postHook?: string;
    /** Detailed instructions (markdown body) */
    instructions?: string;
}
export declare function generateClaudeMd(profile: ProjectProfile): string;
export declare function generateClaudeLocalMd(local: LocalProfile): string;
export declare function generateSkillMd(skill: SkillDefinition): string;
export declare function generateAgentMd(agent: AgentDefinition): string;
export declare function generateAgentIndex(agents: AgentDefinition[]): string;
export interface ScaffoldOptions {
    /** Project profile for CLAUDE.md */
    project: ProjectProfile;
    /** Local profile for CLAUDE.local.md (optional) */
    local?: LocalProfile;
    /** Skills to generate */
    skills?: SkillDefinition[];
    /** Agents to generate */
    agents?: AgentDefinition[];
    /** Include default agents based on project profile */
    includeDefaultAgents?: boolean;
    /** Include default skills based on project profile */
    includeDefaultSkills?: boolean;
}
export interface ScaffoldResult {
    /** Map of relative file path → content */
    files: Map<string, string>;
}
export declare function scaffold(options: ScaffoldOptions): ScaffoldResult;
//# sourceMappingURL=generators.d.ts.map
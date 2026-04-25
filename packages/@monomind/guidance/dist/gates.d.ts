/**
 * Hook-based Enforcement Gates
 *
 * Uses Monobrain hooks to enforce non-negotiable rules.
 * The model can forget. The hook does not.
 *
 * Gates:
 * 1. Destructive ops gate - requires confirmation + rollback plan
 * 2. Tool allowlist gate - blocks non-allowlisted tools
 * 3. Diff size gate - requires plan + staged commits for large diffs
 * 4. Secrets gate - redacts and warns on secret patterns
 *
 * @module @monobrain/guidance/gates
 */
import type { GateConfig, GateResult, GateDecision, GuidanceRule } from './types.js';
export declare class EnforcementGates {
    private config;
    private activeRules;
    constructor(config?: Partial<GateConfig>);
    /**
     * Update active rules from retrieval
     */
    setActiveRules(rules: GuidanceRule[]): void;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<GateConfig>): void;
    /**
     * Evaluate all gates for a command
     */
    evaluateCommand(command: string): GateResult[];
    /**
     * Evaluate all gates for a tool use
     */
    evaluateToolUse(toolName: string, params: Record<string, unknown>): GateResult[];
    /**
     * Evaluate all gates for a file edit
     */
    evaluateEdit(filePath: string, content: string, diffLines: number): GateResult[];
    /**
     * Gate 1: Destructive Operations
     *
     * If command includes delete, drop, rm, force, migration,
     * require explicit confirmation and a rollback plan.
     */
    evaluateDestructiveOps(command: string): GateResult | null;
    /**
     * Gate 2: Tool Allowlist
     *
     * If tool not in allowlist, block and ask for permission.
     */
    evaluateToolAllowlist(toolName: string): GateResult | null;
    /**
     * Gate 3: Diff Size
     *
     * If patch exceeds threshold, require a plan and staged commits.
     */
    evaluateDiffSize(filePath: string, diffLines: number): GateResult | null;
    /**
     * Gate 4: Secrets Detection
     *
     * If output matches secret patterns, redact and warn.
     */
    evaluateSecrets(content: string): GateResult | null;
    /**
     * Get the most restrictive decision from multiple gate results
     */
    aggregateDecision(results: GateResult[]): GateDecision;
    /**
     * Get gate statistics
     */
    getActiveGateCount(): number;
    private findTriggeredRules;
}
/**
 * Create enforcement gates
 */
export declare function createGates(config?: Partial<GateConfig>): EnforcementGates;
//# sourceMappingURL=gates.d.ts.map
/**
 * tdd-cycle.ts - TDD red-green-refactor orchestration MCP tool handler
 *
 * Executes TDD cycles with 7 specialized subagents:
 * 1. requirement-analyzer - Analyzes requirements
 * 2. test-designer - Designs test cases
 * 3. red-phase-executor - Writes failing tests
 * 4. green-phase-implementer - Implements to pass tests
 * 5. refactor-advisor - Suggests refactoring improvements
 * 6. coverage-verifier - Verifies coverage targets
 * 7. cycle-coordinator - Orchestrates the cycle
 */
import { z } from 'zod';
export declare const TDDCycleInputSchema: z.ZodObject<{
    requirement: z.ZodString;
    targetPath: z.ZodString;
    style: z.ZodDefault<z.ZodEnum<{
        london: "london";
        chicago: "chicago";
    }>>;
    maxCycles: z.ZodDefault<z.ZodNumber>;
    framework: z.ZodDefault<z.ZodEnum<{
        vitest: "vitest";
        jest: "jest";
        mocha: "mocha";
        pytest: "pytest";
        junit: "junit";
    }>>;
    coverageTarget: z.ZodDefault<z.ZodNumber>;
    autoRefactor: z.ZodDefault<z.ZodBoolean>;
    stopOnGreen: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type TDDCycleInput = z.infer<typeof TDDCycleInputSchema>;
export type TDDPhase = 'red' | 'green' | 'refactor' | 'complete';
export interface TDDCycleOutput {
    success: boolean;
    cycles: TDDCycleResult[];
    finalCoverage: number;
    totalCycles: number;
    implementation: ImplementationSummary;
    agents: AgentContribution[];
    metadata: TDDMetadata;
}
export interface TDDCycleResult {
    cycleNumber: number;
    phase: TDDPhase;
    test: TestCase | null;
    implementation: string | null;
    refactoring: RefactoringSuggestion[];
    passed: boolean;
    coverage: number;
    durationMs: number;
}
export interface TestCase {
    name: string;
    description: string;
    code: string;
    assertions: string[];
}
export interface RefactoringSuggestion {
    type: 'extract-method' | 'rename' | 'simplify' | 'inline' | 'extract-class' | 'other';
    description: string;
    location: string;
    applied: boolean;
}
export interface ImplementationSummary {
    filesCreated: string[];
    filesModified: string[];
    linesOfCode: number;
    testCount: number;
    coverage: number;
}
export interface AgentContribution {
    agentId: string;
    agentType: string;
    tasksCompleted: number;
    contributions: string[];
}
export interface TDDMetadata {
    startedAt: string;
    completedAt: string;
    totalDurationMs: number;
    style: 'london' | 'chicago';
    framework: string;
    requirement: string;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for tdd-cycle
 */
export declare function handler(input: TDDCycleInput, context: ToolContext): Promise<{
    content: Array<{
        type: 'text';
        text: string;
    }>;
}>;
export declare const toolDefinition: {
    name: string;
    description: string;
    category: string;
    version: string;
    inputSchema: z.ZodObject<{
        requirement: z.ZodString;
        targetPath: z.ZodString;
        style: z.ZodDefault<z.ZodEnum<{
            london: "london";
            chicago: "chicago";
        }>>;
        maxCycles: z.ZodDefault<z.ZodNumber>;
        framework: z.ZodDefault<z.ZodEnum<{
            vitest: "vitest";
            jest: "jest";
            mocha: "mocha";
            pytest: "pytest";
            junit: "junit";
        }>>;
        coverageTarget: z.ZodDefault<z.ZodNumber>;
        autoRefactor: z.ZodDefault<z.ZodBoolean>;
        stopOnGreen: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=tdd-cycle.d.ts.map
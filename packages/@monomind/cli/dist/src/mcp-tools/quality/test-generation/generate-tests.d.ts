/**
 * generate-tests.ts - AI-powered test generation MCP tool handler
 *
 * Generates tests for code using AI-powered test generation with support
 * for multiple test types (unit, integration, E2E, property, mutation, fuzz)
 * and frameworks (vitest, jest, mocha, pytest, junit).
 */
import { z } from 'zod';
export declare const GenerateTestsInputSchema: z.ZodObject<{
    targetPath: z.ZodString;
    testType: z.ZodDefault<z.ZodEnum<{
        unit: "unit";
        integration: "integration";
        e2e: "e2e";
        property: "property";
        mutation: "mutation";
        fuzz: "fuzz";
    }>>;
    framework: z.ZodOptional<z.ZodEnum<{
        vitest: "vitest";
        jest: "jest";
        mocha: "mocha";
        pytest: "pytest";
        junit: "junit";
    }>>;
    coverage: z.ZodOptional<z.ZodObject<{
        target: z.ZodDefault<z.ZodNumber>;
        focusGaps: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    style: z.ZodDefault<z.ZodEnum<{
        "tdd-london": "tdd-london";
        "tdd-chicago": "tdd-chicago";
        bdd: "bdd";
        "example-based": "example-based";
    }>>;
    language: z.ZodOptional<z.ZodEnum<{
        typescript: "typescript";
        javascript: "javascript";
        python: "python";
        go: "go";
        rust: "rust";
        java: "java";
    }>>;
    includeEdgeCases: z.ZodDefault<z.ZodBoolean>;
    includeMocks: z.ZodDefault<z.ZodBoolean>;
    maxTests: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type GenerateTestsInput = z.infer<typeof GenerateTestsInputSchema>;
export interface GenerateTestsOutput {
    success: boolean;
    testFile: string;
    tests: GeneratedTest[];
    coverage: CoverageEstimate;
    metadata: TestGenerationMetadata;
}
export interface GeneratedTest {
    name: string;
    type: 'unit' | 'integration' | 'e2e' | 'property' | 'mutation' | 'fuzz';
    description: string;
    code: string;
    targetFunction?: string;
    targetClass?: string;
    edgeCase: boolean;
    assertions: number;
}
export interface CoverageEstimate {
    lineCoverage: number;
    branchCoverage: number;
    functionCoverage: number;
    uncoveredLines: number[];
    gaps: CoverageGap[];
}
export interface CoverageGap {
    type: 'line' | 'branch' | 'function';
    location: string;
    reason: string;
    priority: 'low' | 'medium' | 'high';
}
export interface TestGenerationMetadata {
    generatedAt: string;
    framework: string;
    style: string;
    totalTests: number;
    executionTimeMs: number;
    modelUsed: string;
    tokensUsed: number;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for generate-tests
 */
export declare function handler(input: GenerateTestsInput, context: ToolContext): Promise<{
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
        targetPath: z.ZodString;
        testType: z.ZodDefault<z.ZodEnum<{
            unit: "unit";
            integration: "integration";
            e2e: "e2e";
            property: "property";
            mutation: "mutation";
            fuzz: "fuzz";
        }>>;
        framework: z.ZodOptional<z.ZodEnum<{
            vitest: "vitest";
            jest: "jest";
            mocha: "mocha";
            pytest: "pytest";
            junit: "junit";
        }>>;
        coverage: z.ZodOptional<z.ZodObject<{
            target: z.ZodDefault<z.ZodNumber>;
            focusGaps: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
        style: z.ZodDefault<z.ZodEnum<{
            "tdd-london": "tdd-london";
            "tdd-chicago": "tdd-chicago";
            bdd: "bdd";
            "example-based": "example-based";
        }>>;
        language: z.ZodOptional<z.ZodEnum<{
            typescript: "typescript";
            javascript: "javascript";
            python: "python";
            go: "go";
            rust: "rust";
            java: "java";
        }>>;
        includeEdgeCases: z.ZodDefault<z.ZodBoolean>;
        includeMocks: z.ZodDefault<z.ZodBoolean>;
        maxTests: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=generate-tests.d.ts.map
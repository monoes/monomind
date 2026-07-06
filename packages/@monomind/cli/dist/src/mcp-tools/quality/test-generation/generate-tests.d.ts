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
    testType: z.ZodDefault<z.ZodEnum<["unit", "integration", "e2e", "property", "mutation", "fuzz"]>>;
    framework: z.ZodOptional<z.ZodEnum<["vitest", "jest", "mocha", "pytest", "junit"]>>;
    coverage: z.ZodOptional<z.ZodObject<{
        target: z.ZodDefault<z.ZodNumber>;
        focusGaps: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        target: number;
        focusGaps: boolean;
    }, {
        target?: number | undefined;
        focusGaps?: boolean | undefined;
    }>>;
    style: z.ZodDefault<z.ZodEnum<["tdd-london", "tdd-chicago", "bdd", "example-based"]>>;
    language: z.ZodOptional<z.ZodEnum<["typescript", "javascript", "python", "java", "go", "rust"]>>;
    includeEdgeCases: z.ZodDefault<z.ZodBoolean>;
    includeMocks: z.ZodDefault<z.ZodBoolean>;
    maxTests: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    style: "tdd-london" | "tdd-chicago" | "bdd" | "example-based";
    targetPath: string;
    testType: "unit" | "integration" | "e2e" | "property" | "mutation" | "fuzz";
    includeEdgeCases: boolean;
    includeMocks: boolean;
    maxTests: number;
    language?: "typescript" | "javascript" | "python" | "go" | "rust" | "java" | undefined;
    framework?: "vitest" | "jest" | "mocha" | "pytest" | "junit" | undefined;
    coverage?: {
        target: number;
        focusGaps: boolean;
    } | undefined;
}, {
    targetPath: string;
    language?: "typescript" | "javascript" | "python" | "go" | "rust" | "java" | undefined;
    framework?: "vitest" | "jest" | "mocha" | "pytest" | "junit" | undefined;
    coverage?: {
        target?: number | undefined;
        focusGaps?: boolean | undefined;
    } | undefined;
    style?: "tdd-london" | "tdd-chicago" | "bdd" | "example-based" | undefined;
    testType?: "unit" | "integration" | "e2e" | "property" | "mutation" | "fuzz" | undefined;
    includeEdgeCases?: boolean | undefined;
    includeMocks?: boolean | undefined;
    maxTests?: number | undefined;
}>;
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
        testType: z.ZodDefault<z.ZodEnum<["unit", "integration", "e2e", "property", "mutation", "fuzz"]>>;
        framework: z.ZodOptional<z.ZodEnum<["vitest", "jest", "mocha", "pytest", "junit"]>>;
        coverage: z.ZodOptional<z.ZodObject<{
            target: z.ZodDefault<z.ZodNumber>;
            focusGaps: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            target: number;
            focusGaps: boolean;
        }, {
            target?: number | undefined;
            focusGaps?: boolean | undefined;
        }>>;
        style: z.ZodDefault<z.ZodEnum<["tdd-london", "tdd-chicago", "bdd", "example-based"]>>;
        language: z.ZodOptional<z.ZodEnum<["typescript", "javascript", "python", "java", "go", "rust"]>>;
        includeEdgeCases: z.ZodDefault<z.ZodBoolean>;
        includeMocks: z.ZodDefault<z.ZodBoolean>;
        maxTests: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        style: "tdd-london" | "tdd-chicago" | "bdd" | "example-based";
        targetPath: string;
        testType: "unit" | "integration" | "e2e" | "property" | "mutation" | "fuzz";
        includeEdgeCases: boolean;
        includeMocks: boolean;
        maxTests: number;
        language?: "typescript" | "javascript" | "python" | "go" | "rust" | "java" | undefined;
        framework?: "vitest" | "jest" | "mocha" | "pytest" | "junit" | undefined;
        coverage?: {
            target: number;
            focusGaps: boolean;
        } | undefined;
    }, {
        targetPath: string;
        language?: "typescript" | "javascript" | "python" | "go" | "rust" | "java" | undefined;
        framework?: "vitest" | "jest" | "mocha" | "pytest" | "junit" | undefined;
        coverage?: {
            target?: number | undefined;
            focusGaps?: boolean | undefined;
        } | undefined;
        style?: "tdd-london" | "tdd-chicago" | "bdd" | "example-based" | undefined;
        testType?: "unit" | "integration" | "e2e" | "property" | "mutation" | "fuzz" | undefined;
        includeEdgeCases?: boolean | undefined;
        includeMocks?: boolean | undefined;
        maxTests?: number | undefined;
    }>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=generate-tests.d.ts.map
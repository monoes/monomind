/**
 * Prime Radiant MCP Tool Types
 *
 * Type definitions for Prime Radiant mathematical AI tools.
 */
import { z } from 'zod';
export interface MCPToolInputSchema {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
}
export interface MCPToolResult {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: MCPToolInputSchema;
    category?: string;
    tags?: string[];
    version?: string;
    cacheable?: boolean;
    cacheTTL?: number;
    handler: (input: Record<string, unknown>, context?: ToolContext) => Promise<MCPToolResult>;
}
export interface ToolContext {
    bridge?: PrimeRadiantBridge;
    config?: PrimeRadiantConfig;
    logger?: Logger;
}
export interface Logger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}
export interface PrimeRadiantConfig {
    coherence: {
        warnThreshold: number;
        rejectThreshold: number;
        cacheEnabled: boolean;
        cacheTTL: number;
    };
    spectral: {
        stabilityThreshold: number;
        maxMatrixSize: number;
    };
    causal: {
        maxBackdoorPaths: number;
        confidenceThreshold: number;
    };
}
export interface PrimeRadiantBridge {
    initialized: boolean;
    initialize(): Promise<void>;
    dispose(): Promise<void>;
    checkCoherence(vectors: Float32Array[]): Promise<CoherenceResult>;
    analyzeSpectral(adjacencyMatrix: Float32Array, size: number): Promise<SpectralResult>;
    inferCausal(graph: CausalGraph, intervention: string, outcome: string): Promise<CausalResult>;
    computeTopology(complex: SimplicialComplex): Promise<TopologyResult>;
}
export declare const CoherenceInputSchema: z.ZodObject<{
    vectors: z.ZodArray<z.ZodArray<z.ZodNumber, "many">, "many">;
    threshold: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    threshold: number;
    vectors: number[][];
}, {
    vectors: number[][];
    threshold?: number | undefined;
}>;
export type CoherenceInput = z.infer<typeof CoherenceInputSchema>;
export interface CoherenceResult {
    coherent: boolean;
    energy: number;
    violations: string[];
    confidence: number;
}
export interface CoherenceOutput {
    energy: number;
    isCoherent: boolean;
    details: {
        violations: string[];
        confidence: number;
        interpretation: string;
        vectorCount: number;
        threshold: number;
    };
}
export declare const SpectralInputSchema: z.ZodObject<{
    matrix: z.ZodArray<z.ZodArray<z.ZodNumber, "many">, "many">;
    analyzeType: z.ZodDefault<z.ZodEnum<["stability", "clustering", "connectivity"]>>;
}, "strip", z.ZodTypeAny, {
    matrix: number[][];
    analyzeType: "stability" | "clustering" | "connectivity";
}, {
    matrix: number[][];
    analyzeType?: "stability" | "clustering" | "connectivity" | undefined;
}>;
export type SpectralInput = z.infer<typeof SpectralInputSchema>;
export interface SpectralResult {
    stable: boolean;
    eigenvalues: number[];
    spectralGap: number;
    stabilityIndex: number;
}
export interface SpectralOutput {
    spectralGap: number;
    eigenvalues: number[];
    stable: boolean;
    details: {
        stabilityIndex: number;
        interpretation: string;
        matrixSize: number;
        analyzeType: string;
    };
}
export declare const CausalGraphSchema: z.ZodObject<{
    nodes: z.ZodArray<z.ZodString, "many">;
    edges: z.ZodArray<z.ZodTuple<[z.ZodString, z.ZodString], null>, "many">;
}, "strip", z.ZodTypeAny, {
    nodes: string[];
    edges: [string, string][];
}, {
    nodes: string[];
    edges: [string, string][];
}>;
export type CausalGraph = z.infer<typeof CausalGraphSchema>;
export declare const CausalInputSchema: z.ZodObject<{
    graph: z.ZodObject<{
        nodes: z.ZodArray<z.ZodString, "many">;
        edges: z.ZodArray<z.ZodTuple<[z.ZodString, z.ZodString], null>, "many">;
    }, "strip", z.ZodTypeAny, {
        nodes: string[];
        edges: [string, string][];
    }, {
        nodes: string[];
        edges: [string, string][];
    }>;
    intervention: z.ZodString;
    outcome: z.ZodString;
}, "strip", z.ZodTypeAny, {
    graph: {
        nodes: string[];
        edges: [string, string][];
    };
    outcome: string;
    intervention: string;
}, {
    graph: {
        nodes: string[];
        edges: [string, string][];
    };
    outcome: string;
    intervention: string;
}>;
export type CausalInput = z.infer<typeof CausalInputSchema>;
export interface CausalResult {
    confounders: string[];
    interventionValid: boolean;
    backdoorPaths: string[][];
}
export interface CausalOutput {
    identifiability: number;
    backdoorPaths: string[];
    details: {
        confounders: string[];
        interventionValid: boolean;
        interpretation: string;
        nodeCount: number;
        edgeCount: number;
    };
}
export declare const AgentStateSchema: z.ZodObject<{
    agentId: z.ZodString;
    embedding: z.ZodArray<z.ZodNumber, "many">;
    vote: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    agentId: string;
    embedding: number[];
    metadata?: Record<string, unknown> | undefined;
    vote?: string | undefined;
}, {
    agentId: string;
    embedding: number[];
    metadata?: Record<string, unknown> | undefined;
    vote?: string | undefined;
}>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export declare const ConsensusInputSchema: z.ZodObject<{
    agentStates: z.ZodArray<z.ZodObject<{
        agentId: z.ZodString;
        embedding: z.ZodArray<z.ZodNumber, "many">;
        vote: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        agentId: string;
        embedding: number[];
        metadata?: Record<string, unknown> | undefined;
        vote?: string | undefined;
    }, {
        agentId: string;
        embedding: number[];
        metadata?: Record<string, unknown> | undefined;
        vote?: string | undefined;
    }>, "many">;
    threshold: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    threshold: number;
    agentStates: {
        agentId: string;
        embedding: number[];
        metadata?: Record<string, unknown> | undefined;
        vote?: string | undefined;
    }[];
}, {
    agentStates: {
        agentId: string;
        embedding: number[];
        metadata?: Record<string, unknown> | undefined;
        vote?: string | undefined;
    }[];
    threshold?: number | undefined;
}>;
export type ConsensusInput = z.infer<typeof ConsensusInputSchema>;
export interface ConsensusOutput {
    verified: boolean;
    coherenceScore: number;
    divergentAgents: string[];
    details: {
        agreementRatio: number;
        coherenceEnergy: number;
        connectivityStable: boolean;
        degreeRatio: number;
        interpretation: string;
        agentCount: number;
    };
}
export declare const SimplexSchema: z.ZodObject<{
    vertices: z.ZodArray<z.ZodNumber, "many">;
    dimension: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    dimension: number;
    vertices: number[];
}, {
    dimension: number;
    vertices: number[];
}>;
export type Simplex = z.infer<typeof SimplexSchema>;
export declare const SimplicialComplexSchema: z.ZodObject<{
    vertices: z.ZodArray<z.ZodArray<z.ZodNumber, "many">, "many">;
    simplices: z.ZodOptional<z.ZodArray<z.ZodObject<{
        vertices: z.ZodArray<z.ZodNumber, "many">;
        dimension: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        dimension: number;
        vertices: number[];
    }, {
        dimension: number;
        vertices: number[];
    }>, "many">>;
    maxDimension: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    vertices: number[][];
    maxDimension: number;
    simplices?: {
        dimension: number;
        vertices: number[];
    }[] | undefined;
}, {
    vertices: number[][];
    simplices?: {
        dimension: number;
        vertices: number[];
    }[] | undefined;
    maxDimension?: number | undefined;
}>;
export type SimplicialComplex = z.infer<typeof SimplicialComplexSchema>;
export declare const TopologyInputSchema: z.ZodObject<{
    complex: z.ZodObject<{
        vertices: z.ZodArray<z.ZodArray<z.ZodNumber, "many">, "many">;
        simplices: z.ZodOptional<z.ZodArray<z.ZodObject<{
            vertices: z.ZodArray<z.ZodNumber, "many">;
            dimension: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            dimension: number;
            vertices: number[];
        }, {
            dimension: number;
            vertices: number[];
        }>, "many">>;
        maxDimension: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        vertices: number[][];
        maxDimension: number;
        simplices?: {
            dimension: number;
            vertices: number[];
        }[] | undefined;
    }, {
        vertices: number[][];
        simplices?: {
            dimension: number;
            vertices: number[];
        }[] | undefined;
        maxDimension?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    complex: {
        vertices: number[][];
        maxDimension: number;
        simplices?: {
            dimension: number;
            vertices: number[];
        }[] | undefined;
    };
}, {
    complex: {
        vertices: number[][];
        simplices?: {
            dimension: number;
            vertices: number[];
        }[] | undefined;
        maxDimension?: number | undefined;
    };
}>;
export type TopologyInput = z.infer<typeof TopologyInputSchema>;
export interface TopologyResult {
    bettiNumbers: number[];
    persistenceDiagram: [number, number][];
    homologyClasses: number;
}
export interface TopologyOutput {
    bettiNumbers: number[];
    persistenceDiagram: {
        birth: number;
        death: number;
        dimension: number;
    }[];
    details: {
        homologyClasses: number;
        interpretation: {
            b0: string;
            b1: string;
        };
        vertexCount: number;
        maxDimension: number;
    };
}
export declare const MemoryGateInputSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodUnknown;
    existingVectors: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodNumber, "many">, "many">>;
    thresholds: z.ZodOptional<z.ZodObject<{
        reject: z.ZodDefault<z.ZodNumber>;
        warn: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        warn: number;
        reject: number;
    }, {
        warn?: number | undefined;
        reject?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    key: string;
    value?: unknown;
    existingVectors?: number[][] | undefined;
    thresholds?: {
        warn: number;
        reject: number;
    } | undefined;
}, {
    key: string;
    value?: unknown;
    existingVectors?: number[][] | undefined;
    thresholds?: {
        warn?: number | undefined;
        reject?: number | undefined;
    } | undefined;
}>;
export type MemoryGateInput = z.infer<typeof MemoryGateInputSchema>;
export interface MemoryGateOutput {
    allowed: boolean;
    coherenceEnergy: number;
    reason?: string;
    details: {
        action: 'allow' | 'warn' | 'reject';
        violations: string[];
        confidence: number;
        interpretation: string;
        contextSize: number;
    };
}
export interface PerformanceMetrics {
    operationName: string;
    startTime: number;
    endTime: number;
    duration: number;
    success: boolean;
    inputSize?: number;
    error?: string;
}
/**
 * Create a successful MCP tool result
 */
export declare function successResult(data: unknown): MCPToolResult;
/**
 * Create an error MCP tool result
 */
export declare function errorResult(error: Error | string): MCPToolResult;
/**
 * Track performance metrics
 */
export declare function trackPerformance<T>(operationName: string, operation: () => T | Promise<T>): Promise<{
    result: T;
    metrics: PerformanceMetrics;
}>;
/**
 * Cosine similarity — re-exported from shared utility.
 * Callers that already import from this module continue to work unchanged.
 */
export { cosineSimilarity } from '../../utils/cosine-similarity.js';
//# sourceMappingURL=types.d.ts.map
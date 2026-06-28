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
    vectors: z.ZodArray<z.ZodArray<z.ZodNumber>>;
    threshold: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
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
    matrix: z.ZodArray<z.ZodArray<z.ZodNumber>>;
    analyzeType: z.ZodDefault<z.ZodEnum<{
        stability: "stability";
        clustering: "clustering";
        connectivity: "connectivity";
    }>>;
}, z.core.$strip>;
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
    nodes: z.ZodArray<z.ZodString>;
    edges: z.ZodArray<z.ZodTuple<[z.ZodString, z.ZodString], null>>;
}, z.core.$strip>;
export type CausalGraph = z.infer<typeof CausalGraphSchema>;
export declare const CausalInputSchema: z.ZodObject<{
    graph: z.ZodObject<{
        nodes: z.ZodArray<z.ZodString>;
        edges: z.ZodArray<z.ZodTuple<[z.ZodString, z.ZodString], null>>;
    }, z.core.$strip>;
    intervention: z.ZodString;
    outcome: z.ZodString;
}, z.core.$strip>;
export type CausalInput = z.infer<typeof CausalInputSchema>;
export interface CausalResult {
    effect: number;
    confounders: string[];
    interventionValid: boolean;
    backdoorPaths: string[][];
    confidence: number;
}
export interface CausalOutput {
    effect: number;
    confidence: number;
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
    embedding: z.ZodArray<z.ZodNumber>;
    vote: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export declare const ConsensusInputSchema: z.ZodObject<{
    agentStates: z.ZodArray<z.ZodObject<{
        agentId: z.ZodString;
        embedding: z.ZodArray<z.ZodNumber>;
        vote: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    threshold: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type ConsensusInput = z.infer<typeof ConsensusInputSchema>;
export interface ConsensusOutput {
    verified: boolean;
    coherenceScore: number;
    divergentAgents: string[];
    details: {
        agreementRatio: number;
        coherenceEnergy: number;
        spectralStability: boolean;
        spectralGap: number;
        interpretation: string;
        agentCount: number;
    };
}
export declare const SimplexSchema: z.ZodObject<{
    vertices: z.ZodArray<z.ZodNumber>;
    dimension: z.ZodNumber;
}, z.core.$strip>;
export type Simplex = z.infer<typeof SimplexSchema>;
export declare const SimplicialComplexSchema: z.ZodObject<{
    vertices: z.ZodArray<z.ZodArray<z.ZodNumber>>;
    simplices: z.ZodOptional<z.ZodArray<z.ZodObject<{
        vertices: z.ZodArray<z.ZodNumber>;
        dimension: z.ZodNumber;
    }, z.core.$strip>>>;
    maxDimension: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type SimplicialComplex = z.infer<typeof SimplicialComplexSchema>;
export declare const TopologyInputSchema: z.ZodObject<{
    complex: z.ZodObject<{
        vertices: z.ZodArray<z.ZodArray<z.ZodNumber>>;
        simplices: z.ZodOptional<z.ZodArray<z.ZodObject<{
            vertices: z.ZodArray<z.ZodNumber>;
            dimension: z.ZodNumber;
        }, z.core.$strip>>>;
        maxDimension: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
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
            b2: string;
        };
        vertexCount: number;
        maxDimension: number;
    };
}
export declare const MemoryGateInputSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodUnknown;
    existingVectors: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodNumber>>>;
    thresholds: z.ZodOptional<z.ZodObject<{
        reject: z.ZodDefault<z.ZodNumber>;
        warn: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
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
 * Calculate cosine similarity between two vectors
 */
export declare function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number;
//# sourceMappingURL=types.d.ts.map
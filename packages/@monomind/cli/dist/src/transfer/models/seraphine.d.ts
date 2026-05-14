/**
 * Seraphine Genesis Model
 * The first Monomind pattern model - "Hello World" for pattern sharing
 *
 * Seraphine represents the foundational patterns for intelligent agent coordination.
 * Named after the Greek "Seraphim" (burning ones), symbolizing the spark of knowledge
 * that ignites collaborative AI intelligence.
 */
import type { CFPFormat, PatternCollection, RoutingPattern, ComplexityPattern, CoveragePattern, TrajectoryPattern, CustomPattern } from '../types.js';
/**
 * Seraphine model version
 */
export declare const SERAPHINE_VERSION = "1.0.0";
/**
 * Seraphine model metadata
 */
export declare const SERAPHINE_METADATA: {
    name: string;
    displayName: string;
    description: string;
    author: {
        id: string;
        displayName: string;
    };
    license: string;
    tags: string[];
    language: string;
    framework: string;
};
/**
 * Core routing patterns for Seraphine
 * These define how tasks are routed to appropriate agents
 */
export declare const SERAPHINE_ROUTING_PATTERNS: RoutingPattern[];
/**
 * Complexity heuristics for Seraphine
 * These help estimate task complexity for resource allocation
 */
export declare const SERAPHINE_COMPLEXITY_PATTERNS: ComplexityPattern[];
/**
 * Coverage patterns for Seraphine
 * These track knowledge domain coverage
 */
export declare const SERAPHINE_COVERAGE_PATTERNS: CoveragePattern[];
/**
 * Trajectory patterns for Seraphine
 * These capture successful task execution paths
 */
export declare const SERAPHINE_TRAJECTORY_PATTERNS: TrajectoryPattern[];
/**
 * Custom patterns for Seraphine
 * These are specialized patterns unique to Seraphine
 */
export declare const SERAPHINE_CUSTOM_PATTERNS: CustomPattern[];
/**
 * Create the complete Seraphine pattern collection
 */
export declare function createSeraphinePatterns(): PatternCollection;
/**
 * Create the Seraphine Genesis CFP document
 */
export declare function createSeraphineGenesis(): CFPFormat;
/**
 * Get Seraphine model info
 */
export declare function getSeraphineInfo(): {
    name: string;
    version: string;
    description: string;
    patternCounts: Record<string, number>;
};
//# sourceMappingURL=seraphine.d.ts.map
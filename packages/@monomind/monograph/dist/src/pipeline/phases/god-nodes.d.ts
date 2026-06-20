import type { PipelinePhase } from '../types.js';
import type { GodNode } from '../../types.js';
export type GodNodeCategory = 'HIGH_CENTRALITY' | 'BRIDGE_NODE' | 'ISOLATED_CLUSTER' | 'CHURN_HOTSPOT' | 'CIRCULAR_IMPORT' | 'UNREACHABLE';
export interface ContributingFactor {
    metric: string;
    value: number;
    threshold: number;
}
export interface GodNodesThresholds {
    p75FanIn: number;
    p90FanIn: number;
    p95FanIn: number;
    p75FanOut: number;
    p90FanOut: number;
}
export interface GodNodesOutput {
    godNodes: (GodNode & {
        category: GodNodeCategory;
        contributingFactors: ContributingFactor[];
    })[];
    thresholds: GodNodesThresholds;
}
export declare const godNodesPhase: PipelinePhase<GodNodesOutput>;
/**
 * Format god-node results as structured text with file:line hints for LLM navigation.
 */
export declare function formatGodNodes(output: GodNodesOutput): string;
//# sourceMappingURL=god-nodes.d.ts.map
/**
 * chaos-inject.ts - Chaos failure injection MCP tool handler
 *
 * Injects controlled failures for resilience testing including network
 * latency, process termination, resource exhaustion, and more.
 * Includes dryRun safety mode.
 */
import { z } from 'zod';
export declare const ChaosInjectInputSchema: z.ZodObject<{
    target: z.ZodString;
    failureType: z.ZodEnum<{
        "network-latency": "network-latency";
        "network-partition": "network-partition";
        "cpu-stress": "cpu-stress";
        "memory-pressure": "memory-pressure";
        "disk-failure": "disk-failure";
        "process-kill": "process-kill";
        "dns-failure": "dns-failure";
        "dependency-failure": "dependency-failure";
        "clock-skew": "clock-skew";
        "packet-loss": "packet-loss";
    }>;
    duration: z.ZodDefault<z.ZodNumber>;
    intensity: z.ZodDefault<z.ZodNumber>;
    dryRun: z.ZodDefault<z.ZodBoolean>;
    rollbackOnFailure: z.ZodDefault<z.ZodBoolean>;
    monitorMetrics: z.ZodDefault<z.ZodBoolean>;
    notifyChannels: z.ZodDefault<z.ZodArray<z.ZodString>>;
    parameters: z.ZodOptional<z.ZodObject<{
        latencyMs: z.ZodOptional<z.ZodNumber>;
        packetLossPercent: z.ZodOptional<z.ZodNumber>;
        cpuCores: z.ZodOptional<z.ZodNumber>;
        memoryPercent: z.ZodOptional<z.ZodNumber>;
        targetProcesses: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ChaosInjectInput = z.infer<typeof ChaosInjectInputSchema>;
export interface ChaosInjectOutput {
    success: boolean;
    experimentId: string;
    status: ExperimentStatus;
    injection: InjectionDetails;
    impact: ImpactAssessment;
    metrics: ChaosMetrics;
    timeline: TimelineEvent[];
    recommendations: ChaosRecommendation[];
    metadata: ChaosMetadata;
}
export interface ExperimentStatus {
    state: 'planned' | 'running' | 'completed' | 'aborted' | 'dry-run';
    progress: number;
    startTime: string | null;
    endTime: string | null;
    rollbackRequired: boolean;
    rollbackCompleted: boolean;
}
export interface InjectionDetails {
    type: string;
    target: string;
    intensity: number;
    duration: number;
    parameters: Record<string, unknown>;
    affectedComponents: string[];
}
export interface ImpactAssessment {
    severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
    systemsAffected: string[];
    usersAffected: number;
    recoveryTime: number;
    dataLoss: boolean;
    serviceDisruption: ServiceDisruption;
}
export interface ServiceDisruption {
    totalRequests: number;
    failedRequests: number;
    errorRate: number;
    avgLatency: number;
    p99Latency: number;
}
export interface ChaosMetrics {
    baseline: MetricSnapshot;
    duringChaos: MetricSnapshot;
    afterChaos: MetricSnapshot;
    degradation: number;
    recoveryTime: number;
}
export interface MetricSnapshot {
    timestamp: string;
    cpu: number;
    memory: number;
    networkLatency: number;
    errorRate: number;
    requestsPerSecond: number;
}
export interface TimelineEvent {
    timestamp: string;
    event: string;
    type: 'info' | 'warning' | 'error' | 'recovery';
    details: string;
}
export interface ChaosRecommendation {
    category: 'resilience' | 'recovery' | 'monitoring' | 'configuration';
    priority: 'high' | 'medium' | 'low';
    finding: string;
    recommendation: string;
    evidence: string;
}
export interface ChaosMetadata {
    experimentId: string;
    createdAt: string;
    completedAt: string | null;
    dryRun: boolean;
    version: string;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for chaos-inject
 */
export declare function handler(input: ChaosInjectInput, context: ToolContext): Promise<{
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
        target: z.ZodString;
        failureType: z.ZodEnum<{
            "network-latency": "network-latency";
            "network-partition": "network-partition";
            "cpu-stress": "cpu-stress";
            "memory-pressure": "memory-pressure";
            "disk-failure": "disk-failure";
            "process-kill": "process-kill";
            "dns-failure": "dns-failure";
            "dependency-failure": "dependency-failure";
            "clock-skew": "clock-skew";
            "packet-loss": "packet-loss";
        }>;
        duration: z.ZodDefault<z.ZodNumber>;
        intensity: z.ZodDefault<z.ZodNumber>;
        dryRun: z.ZodDefault<z.ZodBoolean>;
        rollbackOnFailure: z.ZodDefault<z.ZodBoolean>;
        monitorMetrics: z.ZodDefault<z.ZodBoolean>;
        notifyChannels: z.ZodDefault<z.ZodArray<z.ZodString>>;
        parameters: z.ZodOptional<z.ZodObject<{
            latencyMs: z.ZodOptional<z.ZodNumber>;
            packetLossPercent: z.ZodOptional<z.ZodNumber>;
            cpuCores: z.ZodOptional<z.ZodNumber>;
            memoryPercent: z.ZodOptional<z.ZodNumber>;
            targetProcesses: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=chaos-inject.d.ts.map
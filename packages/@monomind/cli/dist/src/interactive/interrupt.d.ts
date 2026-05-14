export type InterruptDecision = 'approved' | 'rejected' | 'edited';
export interface InterruptPromptResult {
    decision: InterruptDecision;
    editedTask?: string;
}
export interface InterruptConfig {
    interruptBefore: string[];
    confidenceThreshold?: number;
    autoApprove?: boolean;
}
export declare class InterruptRegistry {
    private config;
    load(config: InterruptConfig): void;
    shouldInterrupt(agentSlug: string, confidence?: number): boolean;
    getConfig(): InterruptConfig;
}
export declare const interruptRegistry: InterruptRegistry;
export declare class InterruptController {
    prompt(agentSlug: string, taskDescription: string, checkpointId: string): Promise<InterruptPromptResult>;
}
export declare const interruptController: InterruptController;
//# sourceMappingURL=interrupt.d.ts.map
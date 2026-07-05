/**
 * V1 Guidance Provider
 *
 * Generates Claude-visible guidance output from ReasoningBank patterns.
 * Outputs plain text (exit 0) or JSON with additionalContext.
 *
 * @module @monomind/hooks/reasoningbank/guidance-provider
 */
import { ReasoningBank } from './index.js';
/**
 * Official Claude hook output format
 */
export interface ClaudeHookOutput {
    decision?: 'approve' | 'block' | 'allow' | 'deny';
    reason?: string;
    hookSpecificOutput?: {
        hookEventName: string;
        additionalContext?: string;
        permissionDecision?: 'allow' | 'deny' | 'ask';
        permissionDecisionReason?: string;
        updatedInput?: Record<string, unknown>;
    };
}
/**
 * Guidance Provider class
 *
 * Converts ReasoningBank patterns into Claude-visible guidance.
 */
export declare class GuidanceProvider {
    private reasoningBank;
    constructor(reasoningBank?: ReasoningBank);
    /**
     * Initialize the provider
     */
    initialize(): Promise<void>;
    /**
     * Generate session start context
     * Returns plain text that Claude will see
     */
    generateSessionContext(): Promise<string>;
    /**
     * Generate user prompt context
     * Returns plain text guidance based on prompt analysis
     */
    generatePromptContext(prompt: string): Promise<string>;
    /**
     * Generate pre-edit guidance
     * Returns JSON for Claude hook system
     */
    generatePreEditGuidance(filePath: string): Promise<ClaudeHookOutput>;
    /**
     * Generate post-edit feedback
     * Returns JSON with quality feedback
     */
    generatePostEditFeedback(filePath: string, fileContent?: string): Promise<ClaudeHookOutput>;
    /**
     * Generate pre-command guidance
     * Returns JSON with risk assessment
     */
    generatePreCommandGuidance(command: string): Promise<ClaudeHookOutput>;
    /**
     * Generate task routing guidance
     * Returns plain text with agent recommendation
     */
    generateRoutingGuidance(task: string): Promise<string>;
    /**
     * Generate stop check
     * Returns exit code 2 + stderr if work incomplete
     */
    generateStopCheck(): Promise<{
        shouldStop: boolean;
        reason?: string;
    }>;
    private detectDomains;
    private capitalize;
}
export declare const guidanceProvider: GuidanceProvider;
//# sourceMappingURL=guidance-provider.d.ts.map
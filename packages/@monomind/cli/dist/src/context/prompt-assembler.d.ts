/**
 * PromptAssembler — collects context sections from multiple providers,
 * prioritises them within a token budget, and concatenates the result
 * with the base prompt.
 */
import type { ContextProvider, RunContext } from './context-provider.js';
export interface AssemblyConfig {
    maxTotalTokens?: number;
    basePromptTokens: number;
    providers: ContextProvider[];
}
export interface AssembledPrompt {
    content: string;
    sectionsIncluded: string[];
    sectionsTruncated: string[];
    sectionsDropped: string[];
    totalTokenEstimate: number;
}
export declare class PromptAssembler {
    private readonly maxTotalTokens;
    private readonly basePromptTokens;
    private readonly providers;
    constructor(config: AssemblyConfig);
    assemble(basePrompt: string, ctx: RunContext): Promise<AssembledPrompt>;
}
//# sourceMappingURL=prompt-assembler.d.ts.map
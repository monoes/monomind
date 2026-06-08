export interface CommunityContext {
    communityId: string;
    label: string;
    topSymbols: {
        name: string;
        label: string;
        filePath: string | null;
    }[];
    incomingCount: number;
    outgoingCount: number;
}
/**
 * Build an LLM prompt for generating a wiki page about a code community.
 */
export declare function buildWikiPrompt(context: CommunityContext): string;
//# sourceMappingURL=prompt-builder.d.ts.map
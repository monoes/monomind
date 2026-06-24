import type { ActionDef } from './types.js';
export declare function buildPrompt(task: string, domSnapshot: string): string;
export declare function parseActionResponse(response: string): ActionDef;
export declare function analyzeAndBuild(options: {
    url: string;
    task: string;
    client: import('@monoes/monobrowse').CdpClient;
    sessionId: string;
    outputDir: string;
}): Promise<ActionDef>;
//# sourceMappingURL=analyzer.d.ts.map
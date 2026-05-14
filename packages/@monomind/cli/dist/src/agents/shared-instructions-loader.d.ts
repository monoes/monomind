export declare class SharedInstructionsLoader {
    private cache;
    private filePath;
    constructor(filePath?: string);
    load(basePath?: string): string;
    getSharedInstructions(basePath?: string): string;
    reload(basePath?: string): string;
    isLoaded(): boolean;
    /** Prepend shared instructions to an agent prompt with separator */
    prependToPrompt(agentPrompt: string, basePath?: string): string;
}
export declare const sharedInstructionsLoader: SharedInstructionsLoader;
//# sourceMappingURL=shared-instructions-loader.d.ts.map
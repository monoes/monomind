export interface ScriptCommand {
    binary: string;
    args: string[];
    sourceScript: string;
}
export interface ScriptAnalysis {
    entryPatterns: string[];
    commands: ScriptCommand[];
    binToPackage: Map<string, string>;
}
export interface CiAnalysis {
    entryPatterns: string[];
    detectedRunners: string[];
}
export declare function splitShellOperators(script: string): string[];
export declare function skipInitialWrappers(parts: string[]): string[];
export declare function parseScriptCommand(raw: string): ScriptCommand | null;
export declare function filterProductionScripts(scripts: Record<string, string>): Record<string, string>;
export declare function analyzeScripts(scripts: Record<string, string>, _root?: string): ScriptAnalysis;
export declare function buildBinToPackageMap(packageJson: Record<string, unknown>): Map<string, string>;
export declare function analyzeCiFiles(_root: string): CiAnalysis;
//# sourceMappingURL=scripts.d.ts.map
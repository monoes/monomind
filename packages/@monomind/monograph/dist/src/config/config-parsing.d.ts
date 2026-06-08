export type ConfigFormat = 'json' | 'jsonc' | 'toml';
export declare const CONFIG_NAMES: readonly [".monographrc.json", ".monographrc.jsonc", "monograph.toml", ".monograph.toml", "monograph.json", "monograph.config.json"];
export declare function detectConfigFormat(filePath: string): ConfigFormat;
export declare function findConfigFile(startDir: string): string | undefined;
export declare function detectSourceRoot(projectRoot: string): string;
export declare function parseConfigFile(filePath: string): Record<string, unknown>;
export declare function loadConfigFromDir(dir: string): {
    config: Record<string, unknown>;
    configPath: string;
} | undefined;
//# sourceMappingURL=config-parsing.d.ts.map
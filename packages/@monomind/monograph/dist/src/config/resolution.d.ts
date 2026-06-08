export type ExtendsSource = {
    kind: 'file';
    path: string;
} | {
    kind: 'npm';
    packageName: string;
} | {
    kind: 'url';
    url: string;
};
export interface ResolvedInheritance {
    source: ExtendsSource;
    config: Record<string, unknown>;
}
export declare function parseExtendsValue(raw: string): ExtendsSource;
export declare function resolveFileExtends(configPath: string, extendsPath: string): Record<string, unknown> | null;
export declare function resolveNpmExtends(root: string, packageName: string): Record<string, unknown> | null;
export declare function mergeConfigs(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown>;
export declare function resolveConfigExtends(config: Record<string, unknown>, configPath: string, root: string, depth?: number): Promise<Record<string, unknown>>;
//# sourceMappingURL=resolution.d.ts.map
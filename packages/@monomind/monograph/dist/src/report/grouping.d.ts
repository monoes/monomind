export type GroupByMode = 'owner' | 'directory' | 'package' | 'section';
export interface GroupEntry<T> {
    label: string;
    items: T[];
}
export interface AttributedInstance {
    filePath: string;
    startLine: number;
    endLine: number;
    owner: string;
}
export interface AttributedCloneGroup {
    id: number;
    instances: AttributedInstance[];
    primaryOwner: string;
    duplicatedLines: number;
}
export interface PackageResolver {
    packages: Array<{
        root: string;
        name: string;
    }>;
    resolve(filePath: string): string;
}
export declare function createPackageResolver(packages: Array<{
    root: string;
    name: string;
}>): PackageResolver;
export declare function resolveDirectoryGroup(filePath: string, depth?: number): string;
export declare function groupItemsByFile<T extends {
    filePath: string;
}>(items: T[], resolve: (filePath: string) => string): GroupEntry<T>[];
/** Attribution: most instances wins, alphabetical tiebreak. */
export declare function largestOwner(instances: Array<{
    filePath: string;
}>, resolveOwner: (filePath: string) => string): string;
export declare function attributeCloneGroup(group: {
    id: number;
    duplicatedLines: number;
    instances: Array<{
        filePath: string;
        startLine: number;
        endLine: number;
    }>;
}, resolveOwner: (filePath: string) => string): AttributedCloneGroup;
export type OwnershipResolverKind = 'owner' | 'directory' | 'package' | 'section';
export interface ResultGroup<T = unknown> {
    key: string;
    owners?: string[];
    results: T[];
    fileCount: number;
}
export declare function groupResultsByOwner<T extends {
    filePath?: string;
    path?: string;
}>(items: T[], resolver: (filePath: string) => string): Map<string, T[]>;
export declare function partitionByOwner<T extends {
    filePath?: string;
    path?: string;
}>(items: T[], resolver: (filePath: string) => string): ResultGroup<T>[];
export declare function resolveWithPattern(filePath: string, ownerMap: Map<string, string>): {
    owner: string;
    pattern: string | null;
};
//# sourceMappingURL=grouping.d.ts.map
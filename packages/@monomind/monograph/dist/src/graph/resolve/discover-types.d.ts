export type FileId = number & {
    readonly __brand: 'FileId';
};
export declare function fileId(n: number): FileId;
export type EntryPointSource = {
    kind: 'package-json-main';
} | {
    kind: 'package-json-module';
} | {
    kind: 'package-json-exports';
} | {
    kind: 'package-json-bin';
} | {
    kind: 'package-json-script';
} | {
    kind: 'plugin';
    name: string;
} | {
    kind: 'test-file';
} | {
    kind: 'default-index';
} | {
    kind: 'manual-entry';
} | {
    kind: 'infrastructure-config';
} | {
    kind: 'dynamically-loaded';
};
export interface FallowEntryPoint {
    path: string;
    source: EntryPointSource;
}
export declare function formatEntryPointSource(source: EntryPointSource): string;
export interface FallowDiscoveredFile {
    id: FileId;
    path: string;
    sizeBytes: number;
}
//# sourceMappingURL=discover-types.d.ts.map
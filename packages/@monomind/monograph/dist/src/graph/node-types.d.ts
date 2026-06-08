export type ReferenceKind = 'Value' | 'Type' | 'Namespace' | 'Unknown';
export interface ExportSymbol {
    name: string;
    isType: boolean;
    isReExport: boolean;
    line?: number;
}
export interface ReExportEdge {
    fromFile: string;
    toFile: string;
    symbol?: string;
    isNamespace: boolean;
}
export interface SymbolReference {
    name: string;
    kind: ReferenceKind;
    fromFile: string;
    line?: number;
}
export declare const ModuleNodeFlags: {
    readonly ENTRY_POINT: 1;
    readonly REACHABLE: 2;
    readonly RUNTIME_REACHABLE: 4;
    readonly TEST_REACHABLE: 8;
    readonly CJS_EXPORTS: 16;
};
export interface ModuleNode {
    fileId: number;
    filePath: string;
    flags: number;
    exports: ExportSymbol[];
    reExports: ReExportEdge[];
    references: SymbolReference[];
}
export declare function isEntryPoint(node: ModuleNode): boolean;
export declare function isReachable(node: ModuleNode): boolean;
export declare function isRuntimeReachable(node: ModuleNode): boolean;
export declare function isTestReachable(node: ModuleNode): boolean;
export declare function hasCjsExports(node: ModuleNode): boolean;
export declare function setFlag(node: ModuleNode, flag: number): void;
export declare function clearFlag(node: ModuleNode, flag: number): void;
//# sourceMappingURL=node-types.d.ts.map
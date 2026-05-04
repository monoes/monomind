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

export const ModuleNodeFlags = {
  ENTRY_POINT: 1,
  REACHABLE: 2,
  RUNTIME_REACHABLE: 4,
  TEST_REACHABLE: 8,
  CJS_EXPORTS: 16,
} as const;

export interface ModuleNode {
  fileId: number;
  filePath: string;
  flags: number;
  exports: ExportSymbol[];
  reExports: ReExportEdge[];
  references: SymbolReference[];
}

export function isEntryPoint(node: ModuleNode): boolean {
  return (node.flags & ModuleNodeFlags.ENTRY_POINT) !== 0;
}

export function isReachable(node: ModuleNode): boolean {
  return (node.flags & ModuleNodeFlags.REACHABLE) !== 0;
}

export function isRuntimeReachable(node: ModuleNode): boolean {
  return (node.flags & ModuleNodeFlags.RUNTIME_REACHABLE) !== 0;
}

export function isTestReachable(node: ModuleNode): boolean {
  return (node.flags & ModuleNodeFlags.TEST_REACHABLE) !== 0;
}

export function hasCjsExports(node: ModuleNode): boolean {
  return (node.flags & ModuleNodeFlags.CJS_EXPORTS) !== 0;
}

export function setFlag(node: ModuleNode, flag: number): void {
  node.flags |= flag;
}

export function clearFlag(node: ModuleNode, flag: number): void {
  node.flags &= ~flag;
}

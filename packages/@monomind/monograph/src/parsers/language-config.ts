export type ImportExtractor = (
  sourceText: string,
  importNode: import('web-tree-sitter').Node,
) => string | null;

export type ExportDetector = (node: import('web-tree-sitter').Node, sourceText: string) => boolean;

export type LabelRefiner = (
  node: import('web-tree-sitter').Node,
  defaultLabel: string,
) => import('../types.js').NodeLabel;

/**
 * Optional per-language correction of the extracted symbol name. Receives the
 * node and the name produced by the standard nameField/text fallback; return
 * the improved name. Used by grammars whose identifier field is not 'name'
 * (e.g. C's function_declarator uses a nested 'declarator' field).
 */
export type NameRefiner = (node: import('web-tree-sitter').Node, fallbackName: string) => string;

export interface LanguageConfig {
  name: string;
  extensions: string[];
  /** Source grammar package, kept for diagnostics/traceability. */
  treeSitterModule: string;
  /**
   * Vendored WASM grammar filename under wasm/ (copied into dist/wasm at
   * build time). Regenerate with scripts/refresh-wasm.mjs.
   */
  wasm: string;
  classNodeTypes: Set<string>;
  structNodeTypes: Set<string>;
  enumNodeTypes: Set<string>;
  functionNodeTypes: Set<string>;
  methodNodeTypes: Set<string>;
  constructorNodeTypes: Set<string>;
  interfaceNodeTypes: Set<string>;
  importNodeTypes: Set<string>;
  callNodeTypes: Set<string>;
  decoratorNodeTypes: Set<string>;
  nameField: string;
  packageScopeType?: string;
  importExtractor?: ImportExtractor;
  exportDetector?: ExportDetector;
  labelRefiner?: LabelRefiner;
  nameRefiner?: NameRefiner;
}

/**
 * Helper for nameRefiner implementations: return the text of the first named
 * child whose type is in `types`, or null. Useful for older grammars that
 * declare no field names (e.g. kotlin 0.3.8, ruby 0.23), where
 * childForFieldName() always returns null.
 */
export function firstChildText(
  node: import('web-tree-sitter').Node,
  types: string[],
): string | null {
  for (const type of types) {
    const hit = node.namedChildren.find((c) => c.type === type);
    if (hit) return hit.text;
  }
  return null;
}

export type ImportExtractor = (
  sourceText: string,
  importNode: import('tree-sitter').SyntaxNode,
) => string | null;

export type ExportDetector = (
  node: import('tree-sitter').SyntaxNode,
  sourceText: string,
) => boolean;

export type LabelRefiner = (
  node: import('tree-sitter').SyntaxNode,
  defaultLabel: string,
) => import('../types.js').NodeLabel;

export interface LanguageConfig {
  name: string;
  extensions: string[];
  treeSitterModule: string;
  getLanguage: () => import('tree-sitter').Language;
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
}

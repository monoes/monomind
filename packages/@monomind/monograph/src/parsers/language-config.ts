export interface ImportExtractor {
  (sourceText: string, importNode: import('tree-sitter').SyntaxNode): string | null;
}

export interface ExportDetector {
  (node: import('tree-sitter').SyntaxNode, sourceText: string): boolean;
}

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
}

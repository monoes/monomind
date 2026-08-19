import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

// MEM-2: tree-sitter-c-sharp@0.23.5+ ships an ESM module with top-level await,
// which cannot be loaded via require() — that pinned us to a prebuilds-path
// workaround. Pinned to 0.23.1 (see package.json), which is a plain CJS
// module require() handles directly.
function getLanguage(): import('tree-sitter').Language {
  return require('tree-sitter-c-sharp').language as import('tree-sitter').Language;
}

export const csharpConfig: LanguageConfig = {
  name: 'csharp',
  extensions: ['.cs'],
  treeSitterModule: 'tree-sitter-c-sharp',
  getLanguage,
  classNodeTypes: new Set(['class_declaration']),
  structNodeTypes: new Set(['struct_declaration']),
  enumNodeTypes: new Set(['enum_declaration']),
  functionNodeTypes: new Set(['local_function_statement']),
  methodNodeTypes: new Set(['method_declaration']),
  constructorNodeTypes: new Set(['constructor_declaration']),
  interfaceNodeTypes: new Set(['interface_declaration']),
  importNodeTypes: new Set(['using_directive']),
  callNodeTypes: new Set(['invocation_expression', 'object_creation_expression']),
  decoratorNodeTypes: new Set(['attribute']),
  nameField: 'name',
  importExtractor: (_source, node) => {
    // using System.IO; → "System.IO"
    const last = node.child(node.childCount - 2);
    return last?.text ?? null;
  },
  exportDetector: (_node, _source) => true,
};

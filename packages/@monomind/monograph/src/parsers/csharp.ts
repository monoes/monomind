import type { LanguageConfig } from './language-config.js';

export const csharpConfig: LanguageConfig = {
  name: 'csharp',
  extensions: ['.cs'],
  treeSitterModule: 'tree-sitter-c-sharp',
  wasm: 'tree-sitter-c_sharp.wasm',
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

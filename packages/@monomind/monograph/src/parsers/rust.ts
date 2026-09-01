import type { LanguageConfig } from './language-config.js';

export const rustConfig: LanguageConfig = {
  name: 'rust',
  extensions: ['.rs'],
  treeSitterModule: 'tree-sitter-rust',
  wasm: 'tree-sitter-rust.wasm',
  classNodeTypes: new Set([]),
  structNodeTypes: new Set(['struct_item']),
  enumNodeTypes: new Set(['enum_item']),
  functionNodeTypes: new Set(['function_item']),
  methodNodeTypes: new Set(['function_item']),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set(['trait_item']),
  importNodeTypes: new Set(['use_declaration']),
  callNodeTypes: new Set(['call_expression', 'method_call_expression']),
  decoratorNodeTypes: new Set(['attribute_item']),
  nameField: 'name',
  importExtractor: (_source, node) => {
    return node.text
      .replace(/^use\s+/, '')
      .replace(/;$/, '')
      .trim();
  },
  exportDetector: (node, _source) => {
    // Rust exports items with a `pub` visibility modifier.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === 'visibility_modifier') {
        return child.text.startsWith('pub');
      }
    }
    return false;
  },
};

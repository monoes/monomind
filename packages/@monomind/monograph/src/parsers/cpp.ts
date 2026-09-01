import type { LanguageConfig } from './language-config.js';

export const cppConfig: LanguageConfig = {
  name: 'cpp',
  extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'],
  treeSitterModule: 'tree-sitter-cpp',
  wasm: 'tree-sitter-cpp.wasm',
  classNodeTypes: new Set(['class_specifier']),
  structNodeTypes: new Set(['struct_specifier']),
  enumNodeTypes: new Set(['enum_specifier']),
  // function_declarator is nested inside function_definition and carries the real
  // function name in ITS OWN 'declarator' field (plain identifier, possibly wrapped
  // in pointer/reference/parenthesized declarators) — nameRefiner unwraps those.
  functionNodeTypes: new Set(['function_declarator']),
  methodNodeTypes: new Set([]),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set([]),
  importNodeTypes: new Set(['preproc_include']),
  callNodeTypes: new Set(['call_expression']),
  decoratorNodeTypes: new Set([]),
  nameField: 'name',
  nameRefiner: (node, fallback) => {
    if (node.type !== 'function_declarator') return fallback;
    let declarator = node.childForFieldName('declarator');
    while (declarator && declarator.childForFieldName('declarator')) {
      declarator = declarator.childForFieldName('declarator');
    }
    return declarator?.text ?? fallback;
  },
  importExtractor: (_source, node) => {
    const pathNode = node.childForFieldName('path') ?? node.child(1);
    return pathNode?.text.replace(/[<>"]/g, '') ?? null;
  },
  exportDetector: (_node, _source) => false,
};

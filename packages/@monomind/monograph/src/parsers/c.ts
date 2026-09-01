import type { LanguageConfig } from './language-config.js';

export const cConfig: LanguageConfig = {
  name: 'c',
  extensions: ['.c', '.h'],
  treeSitterModule: 'tree-sitter-c',
  wasm: 'tree-sitter-c.wasm',
  // struct_specifier and enum_specifier expose a 'name' field with the type name.
  // function_declarator (nested in function_definition) has no 'name' field — its
  // identifier sits in a nested 'declarator' field (plain identifier, or wrapped
  // in pointer/parenthesized declarators). nameRefiner descends to that identifier
  // so function names come out as 'add', not 'add(int a, int b)'.
  classNodeTypes: new Set([]),
  structNodeTypes: new Set(['struct_specifier']),
  enumNodeTypes: new Set(['enum_specifier']),
  // function_declarator is nested inside function_definition and carries the real function name
  functionNodeTypes: new Set(['function_declarator']),
  methodNodeTypes: new Set([]),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set(['type_definition']),
  importNodeTypes: new Set(['preproc_include']),
  callNodeTypes: new Set(['call_expression']),
  decoratorNodeTypes: new Set([]),
  nameField: 'name',
  nameRefiner: (node, fallback) => {
    let declarator =
      node.type === 'function_declarator' || node.type === 'type_definition'
        ? node.childForFieldName('declarator')
        : null;
    // Unwrap pointer_declarator / parenthesized_declarator layers.
    while (declarator && declarator.childForFieldName('declarator')) {
      declarator = declarator.childForFieldName('declarator');
    }
    return declarator?.text ?? fallback;
  },
  importExtractor: (_source, node) => {
    const pathNode = node.childForFieldName('path') ?? node.child(1);
    return pathNode?.text.replace(/[<>"]/g, '') ?? null;
  },
  exportDetector: (node, _source) => {
    // C: non-static top-level functions/variables are exported (external linkage).
    // function_declarator lives inside function_definition; check parent for 'static'.
    const defNode = node.parent?.type === 'function_definition' ? node.parent : node;
    for (let i = 0; i < defNode.childCount; i++) {
      const child = defNode.child(i)!;
      if (child.type === 'storage_class_specifier' && child.text === 'static') {
        return false;
      }
    }
    return true;
  },
};

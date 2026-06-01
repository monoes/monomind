import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const cConfig: LanguageConfig = {
  name: 'c',
  extensions: ['.c', '.h'],
  treeSitterModule: 'tree-sitter-c',
  getLanguage: () => require('tree-sitter-c').language as import('tree-sitter').Language,
  // struct_specifier and enum_specifier expose a 'name' field with the type name.
  // function_declarator (nested in function_definition) has a 'declarator' field for the
  // function identifier, but no 'name' field. Using nameField 'name' produces clean names
  // for structs/enums and falls back to node text for functions (acceptable).
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
  importExtractor: (_source, node) => {
    const pathNode = node.childForFieldName('path') ?? node.child(1);
    return pathNode?.text.replace(/[<>"]/g, '') ?? null;
  },
};

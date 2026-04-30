import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const cppConfig: LanguageConfig = {
  name: 'cpp',
  extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.h'],
  treeSitterModule: 'tree-sitter-cpp',
  getLanguage: () => require('tree-sitter-cpp').language as import('tree-sitter').Language,
  classNodeTypes: new Set(['class_specifier']),
  structNodeTypes: new Set(['struct_specifier']),
  enumNodeTypes: new Set(['enum_specifier']),
  // function_declarator is nested inside function_definition and carries the real function name.
  // Using nameField 'declarator' extracts the identifier directly.
  functionNodeTypes: new Set(['function_declarator']),
  methodNodeTypes: new Set([]),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set([]),
  importNodeTypes: new Set(['preproc_include']),
  callNodeTypes: new Set(['call_expression']),
  decoratorNodeTypes: new Set([]),
  nameField: 'name',
  importExtractor: (_source, node) => {
    const pathNode = node.childForFieldName('path') ?? node.child(1);
    return pathNode?.text.replace(/[<>"]/g, '') ?? null;
  },
  exportDetector: (_node, _source) => false,
};

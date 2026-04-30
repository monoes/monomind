import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const rustConfig: LanguageConfig = {
  name: 'rust',
  extensions: ['.rs'],
  treeSitterModule: 'tree-sitter-rust',
  getLanguage: () => require('tree-sitter-rust'),
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
    return node.text.replace(/^use\s+/, '').replace(/;$/, '').trim();
  },
};

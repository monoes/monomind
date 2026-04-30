import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const javaConfig: LanguageConfig = {
  name: 'java',
  extensions: ['.java'],
  treeSitterModule: 'tree-sitter-java',
  getLanguage: () => require('tree-sitter-java'),
  classNodeTypes: new Set(['class_declaration']),
  structNodeTypes: new Set(['record_declaration']),
  enumNodeTypes: new Set(['enum_declaration']),
  functionNodeTypes: new Set([]),
  methodNodeTypes: new Set(['method_declaration']),
  constructorNodeTypes: new Set(['constructor_declaration']),
  interfaceNodeTypes: new Set(['interface_declaration', 'annotation_type_declaration']),
  importNodeTypes: new Set(['import_declaration']),
  callNodeTypes: new Set(['method_invocation', 'object_creation_expression']),
  decoratorNodeTypes: new Set(['annotation']),
  nameField: 'name',
  importExtractor: (_source, node) => {
    const path = node.text.replace(/^import\s+(static\s+)?/, '').replace(/;$/, '').trim();
    return path || null;
  },
  exportDetector: (_node, _source) => true,
};

import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const typescriptConfig: LanguageConfig = {
  name: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  treeSitterModule: 'tree-sitter-typescript',
  getLanguage: () => {
    const ts = require('tree-sitter-typescript');
    return ts.typescript;
  },
  classNodeTypes: new Set(['class_declaration', 'class']),
  structNodeTypes: new Set([]),
  enumNodeTypes: new Set(['enum_declaration']),
  functionNodeTypes: new Set([
    'function_declaration', 'function', 'arrow_function',
    'generator_function_declaration', 'generator_function',
  ]),
  methodNodeTypes: new Set(['method_definition', 'method_signature']),
  constructorNodeTypes: new Set(['constructor']),
  interfaceNodeTypes: new Set(['interface_declaration', 'type_alias_declaration']),
  importNodeTypes: new Set(['import_statement', 'import_declaration']),
  callNodeTypes: new Set(['call_expression', 'new_expression']),
  decoratorNodeTypes: new Set(['decorator']),
  nameField: 'name',
  importExtractor: (_source, node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === 'string') {
        return child.text.replace(/['"]/g, '');
      }
    }
    return null;
  },
  exportDetector: (node, _source) => {
    const parent = node.parent;
    return parent?.type === 'export_statement' || parent?.type === 'export_default_declaration';
  },
};

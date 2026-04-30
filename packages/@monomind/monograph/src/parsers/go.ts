import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const goConfig: LanguageConfig = {
  name: 'go',
  extensions: ['.go'],
  treeSitterModule: 'tree-sitter-go',
  getLanguage: () => require('tree-sitter-go'),
  classNodeTypes: new Set([]),
  structNodeTypes: new Set(['type_spec']),
  enumNodeTypes: new Set([]),
  functionNodeTypes: new Set(['function_declaration']),
  methodNodeTypes: new Set(['method_declaration']),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set(['interface_type']),
  importNodeTypes: new Set(['import_declaration', 'import_spec']),
  callNodeTypes: new Set(['call_expression']),
  decoratorNodeTypes: new Set([]),
  nameField: 'name',
  packageScopeType: 'package_clause',
  importExtractor: (_source, node) => {
    const pathNode = node.childForFieldName('path') ?? node.child(1);
    return pathNode?.text.replace(/['"]/g, '') ?? null;
  },
};

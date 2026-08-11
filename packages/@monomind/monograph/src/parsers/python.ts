import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const pythonConfig: LanguageConfig = {
  name: 'python',
  extensions: ['.py'],
  treeSitterModule: 'tree-sitter-python',
  getLanguage: () => require('tree-sitter-python'),
  classNodeTypes: new Set(['class_definition']),
  structNodeTypes: new Set([]),
  enumNodeTypes: new Set([]),
  functionNodeTypes: new Set(['function_definition']),
  methodNodeTypes: new Set(['function_definition']),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set([]),
  importNodeTypes: new Set(['import_statement', 'import_from_statement']),
  callNodeTypes: new Set(['call']),
  decoratorNodeTypes: new Set(['decorator']),
  nameField: 'name',
  importExtractor: (_source, node) => {
    const moduleNode = node.childForFieldName('module_name') ?? node.child(1);
    return moduleNode?.text ?? null;
  },
  exportDetector: (node, _source) => {
    // Python convention: names starting with '_' are private.
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text ?? '';
    return name.length > 0 && !name.startsWith('_');
  },
};

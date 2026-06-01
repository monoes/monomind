import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const rubyConfig: LanguageConfig = {
  name: 'ruby',
  extensions: ['.rb'],
  treeSitterModule: 'tree-sitter-ruby',
  getLanguage: () => require('tree-sitter-ruby').language as import('tree-sitter').Language,
  classNodeTypes: new Set(['class']),
  structNodeTypes: new Set([]),
  enumNodeTypes: new Set([]),
  functionNodeTypes: new Set(['method']),
  methodNodeTypes: new Set(['method']),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set(['module']),
  // Ruby imports: require 'json' is a call expression at the top level
  importNodeTypes: new Set(['call']),
  callNodeTypes: new Set(['call']),
  decoratorNodeTypes: new Set([]),
  nameField: 'name',
  importExtractor: (_source, node) => {
    // Only extract 'require' and 'require_relative' calls
    const receiver = node.child(0);
    if (receiver?.text !== 'require' && receiver?.text !== 'require_relative') return null;
    const args = node.childForFieldName('arguments') ?? node.child(1);
    if (!args) return null;
    // First argument is a string node
    for (let i = 0; i < args.childCount; i++) {
      const c = args.child(i)!;
      if (c.type === 'string') {
        return c.text.replace(/['"]/g, '');
      }
    }
    return null;
  },
  exportDetector: (_node, _source) => true,
};

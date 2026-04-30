import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const kotlinConfig: LanguageConfig = {
  name: 'kotlin',
  extensions: ['.kt', '.kts'],
  treeSitterModule: 'tree-sitter-kotlin',
  getLanguage: () => {
    const mod = require('tree-sitter-kotlin');
    return (mod.language ?? mod) as import('tree-sitter').Language;
  },
  classNodeTypes: new Set(['class_declaration']),
  structNodeTypes: new Set([]),
  enumNodeTypes: new Set(['enum_class_body']),
  functionNodeTypes: new Set(['function_declaration']),
  methodNodeTypes: new Set(['function_declaration']),
  constructorNodeTypes: new Set(['primary_constructor', 'secondary_constructor']),
  interfaceNodeTypes: new Set(['class_declaration']),
  importNodeTypes: new Set(['import_header']),
  callNodeTypes: new Set(['call_expression']),
  decoratorNodeTypes: new Set(['annotation']),
  nameField: 'name',
  importExtractor: (_source, node) => {
    // import com.example.Foo → extract the qualified identifier
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)!;
      if (c.type === 'identifier' || c.type === 'dot_qualified_expression') {
        return c.text ?? null;
      }
    }
    return null;
  },
  exportDetector: (_node, _source) => true,
};

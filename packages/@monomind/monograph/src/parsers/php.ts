import type { LanguageConfig } from './language-config.js';

export const phpConfig: LanguageConfig = {
  name: 'php',
  extensions: ['.php'],
  treeSitterModule: 'tree-sitter-php',
  // Full PHP grammar (not php_only) — vendored wasm is tree-sitter-php.wasm.
  wasm: 'tree-sitter-php.wasm',
  classNodeTypes: new Set(['class_declaration']),
  structNodeTypes: new Set([]),
  enumNodeTypes: new Set(['enum_declaration']),
  functionNodeTypes: new Set(['function_definition']),
  methodNodeTypes: new Set(['method_declaration']),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set(['interface_declaration']),
  importNodeTypes: new Set(['namespace_use_declaration']),
  callNodeTypes: new Set(['function_call_expression', 'member_call_expression']),
  decoratorNodeTypes: new Set([]),
  nameField: 'name',
  importExtractor: (_source, node) => {
    // use App\Models\User; → extract qualified name
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)!;
      if (c.type === 'namespace_use_clause') {
        return c.text.trim() || null;
      }
    }
    return null;
  },
  exportDetector: (_node, _source) => true,
};

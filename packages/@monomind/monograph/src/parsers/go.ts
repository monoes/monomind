import type { LanguageConfig } from './language-config.js';

export const goConfig: LanguageConfig = {
  name: 'go',
  extensions: ['.go'],
  treeSitterModule: 'tree-sitter-go',
  wasm: 'tree-sitter-go.wasm',
  classNodeTypes: new Set([]),
  structNodeTypes: new Set(['type_spec']),
  enumNodeTypes: new Set([]),
  functionNodeTypes: new Set(['function_declaration']),
  methodNodeTypes: new Set(['method_declaration']),
  constructorNodeTypes: new Set([]),
  interfaceNodeTypes: new Set([]),
  importNodeTypes: new Set(['import_declaration', 'import_spec']),
  callNodeTypes: new Set(['call_expression']),
  decoratorNodeTypes: new Set([]),
  nameField: 'name',
  packageScopeType: 'package_clause',
  importExtractor: (_source, node) => {
    const pathNode = node.childForFieldName('path') ?? node.child(1);
    return pathNode?.text.replace(/['"]/g, '') ?? null;
  },
  exportDetector: (node, _source) => {
    // Go exports identifiers that start with an uppercase letter.
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text ?? '';
    return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z';
  },
  labelRefiner: (node, defaultLabel): import('../types.js').NodeLabel => {
    if (node.type !== 'type_spec') return defaultLabel as import('../types.js').NodeLabel;
    const typeChild = node.childForFieldName('type');
    if (!typeChild) return defaultLabel as import('../types.js').NodeLabel;
    if (typeChild.type === 'struct_type') return 'Struct';
    if (typeChild.type === 'interface_type') return 'Interface';
    return 'TypeAlias';
  },
};

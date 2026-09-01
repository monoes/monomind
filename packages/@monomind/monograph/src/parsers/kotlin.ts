import { firstChildText, type LanguageConfig } from './language-config.js';

export const kotlinConfig: LanguageConfig = {
  name: 'kotlin',
  extensions: ['.kt', '.kts'],
  treeSitterModule: 'tree-sitter-kotlin',
  wasm: 'tree-sitter-kotlin.wasm',
  // kotlin 0.3.8 declares no field names — names come from the first
  // type_identifier (classes/interfaces/enums) or simple_identifier (functions).
  nameRefiner: (node, fallback) =>
    firstChildText(node, ['type_identifier', 'simple_identifier']) ?? fallback,
  classNodeTypes: new Set(['class_declaration']),
  structNodeTypes: new Set([]),
  enumNodeTypes: new Set(['enum_class_declaration']),
  functionNodeTypes: new Set(['function_declaration']),
  methodNodeTypes: new Set(['function_declaration']),
  constructorNodeTypes: new Set(['primary_constructor', 'secondary_constructor']),
  interfaceNodeTypes: new Set(['interface_declaration']),
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

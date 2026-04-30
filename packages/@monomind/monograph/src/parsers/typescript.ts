import { createRequire } from 'module';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

export const typescriptConfig: LanguageConfig = {
  name: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  treeSitterModule: 'tree-sitter-typescript',
  getLanguage: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tsGrammar = require('tree-sitter-typescript');
    return tsGrammar.typescript;
  },
  classNodeTypes: new Set(['class_declaration', 'abstract_class_declaration']),
  structNodeTypes: new Set(),
  enumNodeTypes: new Set(['enum_declaration']),
  functionNodeTypes: new Set(['function_declaration', 'arrow_function', 'function_expression']),
  methodNodeTypes: new Set(['method_definition', 'public_field_definition']),
  constructorNodeTypes: new Set(['constructor_definition']),
  interfaceNodeTypes: new Set(['interface_declaration', 'type_alias_declaration']),
  importNodeTypes: new Set(['import_statement', 'import_clause']),
  callNodeTypes: new Set(['call_expression', 'new_expression']),
  decoratorNodeTypes: new Set(['decorator']),
  nameField: 'name',
};

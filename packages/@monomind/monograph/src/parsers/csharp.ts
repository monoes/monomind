import { createRequire } from 'module';
import { dirname, join } from 'path';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

function getLanguage(): import('tree-sitter').Language {
  // tree-sitter-c-sharp@0.23+ uses an ESM module with top-level await, which
  // cannot be loaded via require(). Load the prebuilt native binding directly.
  try {
    const pkgPath = require.resolve('tree-sitter-c-sharp/package.json');
    const pkgDir = dirname(pkgPath);
    const binPath = join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'tree-sitter-c-sharp.node');
    const mod = require(binPath);
    return mod.language as import('tree-sitter').Language;
  } catch (err) {
    throw new Error(`tree-sitter-c-sharp unavailable: ${err}`);
  }
}

export const csharpConfig: LanguageConfig = {
  name: 'csharp',
  extensions: ['.cs'],
  treeSitterModule: 'tree-sitter-c-sharp',
  getLanguage,
  classNodeTypes: new Set(['class_declaration']),
  structNodeTypes: new Set(['struct_declaration']),
  enumNodeTypes: new Set(['enum_declaration']),
  functionNodeTypes: new Set(['local_function_statement']),
  methodNodeTypes: new Set(['method_declaration']),
  constructorNodeTypes: new Set(['constructor_declaration']),
  interfaceNodeTypes: new Set(['interface_declaration']),
  importNodeTypes: new Set(['using_directive']),
  callNodeTypes: new Set(['invocation_expression', 'object_creation_expression']),
  decoratorNodeTypes: new Set(['attribute']),
  nameField: 'name',
  importExtractor: (_source, node) => {
    // using System.IO; → "System.IO"
    const last = node.child(node.childCount - 2);
    return last?.text ?? null;
  },
  exportDetector: (_node, _source) => true,
};

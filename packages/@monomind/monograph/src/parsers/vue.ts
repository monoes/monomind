import type { LanguageConfig } from './language-config.js';

/**
 * Vue SFC handling.
 *
 * Historically this module tried tree-sitter-vue first and fell back to
 * <script>-block extraction when the native grammar was ABI-incompatible
 * (which was often — tree-sitter-vue fails to build on many platforms).
 *
 * Under web-tree-sitter (WASM) the native grammar is gone entirely:
 * tree-sitter-vue's external scanner requires emscripten to build for wasm,
 * which tree-sitter-cli's built-in wasm backend does not support. So .vue
 * files always take the previously-fallback path: extract the <script> block
 * and parse it with the TypeScript grammar. The node-type sets below remain
 * TypeScript-compatible, and the language label stays 'vue'.
 */

export const vueConfig: LanguageConfig = {
  name: 'vue',
  extensions: ['.vue'],
  treeSitterModule: 'tree-sitter-typescript',
  wasm: 'tree-sitter-typescript.wasm',
  classNodeTypes: new Set(['class_declaration', 'class']),
  structNodeTypes: new Set([]),
  enumNodeTypes: new Set(['enum_declaration']),
  functionNodeTypes: new Set([
    'function_declaration',
    'function',
    'arrow_function',
    'generator_function_declaration',
    'generator_function',
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

/**
 * Extracts the <script> block content from a Vue SFC source string.
 * Returns the inner content (stripping the <script> tags) and whether it is TypeScript.
 */
export function extractVueScriptContent(source: string): {
  content: string;
  isTypeScript: boolean;
} {
  // Match <script lang="ts"> or <script setup lang="ts"> or just <script>
  const tsMatch = source.match(/<script(?:\s+setup)?\s+lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/i);
  if (tsMatch) return { content: tsMatch[1], isTypeScript: true };

  const jsMatch = source.match(/<script(?:\s+setup)?[^>]*>([\s\S]*?)<\/script>/i);
  if (jsMatch) return { content: jsMatch[1], isTypeScript: false };

  return { content: '', isTypeScript: false };
}

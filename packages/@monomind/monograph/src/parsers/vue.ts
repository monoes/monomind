import { createRequire } from 'node:module';
import Parser from 'tree-sitter';
import type { LanguageConfig } from './language-config.js';

/**
 * Vue SFC parser.
 *
 * tree-sitter-vue (v0.2.1) fails to build on many platforms due to native compilation
 * issues. This module provides a regex-based fallback that strips <template> and <style>
 * blocks then delegates <script lang="ts"> content to the TypeScript node-type sets.
 *
 * The LanguageConfig below is configured to match TypeScript/JavaScript symbol types
 * so the extractor correctly labels Classes, Functions, and Methods when fed the
 * extracted script content.
 */

const require = createRequire(import.meta.url);

// MEM-2: tree-sitter-vue can `require()` successfully while still returning an
// ABI-incompatible Language object (e.g. a mismatched native binding) — the
// require() call itself never throws in that case, so a bare try/catch around
// require() alone does not detect the failure. Validate the loaded Language by
// attempting to bind it to a scratch Parser instance; only a successful bind
// proves the grammar is actually usable.
function isUsableLanguage(lang: unknown): lang is import('tree-sitter').Language {
  if (!lang) return false;
  try {
    new Parser().setLanguage(lang as import('tree-sitter').Language);
    return true;
  } catch {
    return false;
  }
}

// Exported so callers (loader.ts) can decide whether to feed the raw .vue
// source or the extracted <script> block to the parser, without duplicating
// the require()-succeeds-but-ABI-is-broken detection logic below.
export function isVueGrammarUsable(): boolean {
  try {
    const mod = require('tree-sitter-vue');
    const lang = (mod.default ?? mod) as import('tree-sitter').Language;
    return isUsableLanguage(lang);
  } catch {
    return false;
  }
}

function getLanguage(): import('tree-sitter').Language {
  // Try tree-sitter-vue first; fall through to TypeScript grammar if unavailable
  // or if it loads an ABI-incompatible Language object.
  try {
    const mod = require('tree-sitter-vue');
    const lang = (mod.default ?? mod) as import('tree-sitter').Language;
    if (isUsableLanguage(lang)) return lang;
  } catch {
    // require() itself failed — fall through to the TypeScript grammar below.
  }
  // Fall back to TypeScript grammar for script block parsing.
  const ts = require('tree-sitter-typescript');
  return ts.typescript as import('tree-sitter').Language;
}

export const vueConfig: LanguageConfig = {
  name: 'vue',
  extensions: ['.vue'],
  treeSitterModule: 'tree-sitter-vue',
  getLanguage,
  // Use TypeScript-compatible node types since we parse the extracted script block
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

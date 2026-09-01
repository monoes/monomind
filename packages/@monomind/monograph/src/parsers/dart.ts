import type { LanguageConfig } from './language-config.js';

export const dartConfig: LanguageConfig = {
  name: 'dart',
  extensions: ['.dart'],
  treeSitterModule: 'tree-sitter-dart',
  wasm: 'tree-sitter-dart.wasm',
  // tree-sitter-dart signature/declaration nodes carry the identifier as an
  // 'identifier' child or a 'name' field — but method_signature only wraps
  // function_signature, which holds the name one level down.
  nameRefiner: (node, fallback) => {
    const direct =
      node.childForFieldName('name') ??
      node.namedChildren.find((c) => c.type === 'identifier') ??
      null;
    if (direct) return direct.text;
    for (const child of node.namedChildren) {
      const nested =
        child.childForFieldName('name') ??
        child.namedChildren.find((c) => c.type === 'identifier') ??
        null;
      if (nested) return nested.text;
    }
    return fallback;
  },
  classNodeTypes: new Set(['class_definition']),
  structNodeTypes: new Set([]),
  enumNodeTypes: new Set(['enum_declaration']),
  functionNodeTypes: new Set(['function_signature', 'function_declaration']),
  methodNodeTypes: new Set(['method_signature', 'method_declaration']),
  constructorNodeTypes: new Set(['constructor_signature']),
  interfaceNodeTypes: new Set([]),
  importNodeTypes: new Set(['import_or_export']),
  callNodeTypes: new Set(['invocation_expression']),
  decoratorNodeTypes: new Set(['metadata']),
  nameField: 'name',
  importExtractor: (_source, node) => {
    // import 'package:flutter/material.dart'; → extract string content
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)!;
      if (c.type === 'uri') {
        return c.text.replace(/['"]/g, '') ?? null;
      }
      if (c.type === 'string_literal' || c.type === 'string') {
        return c.text.replace(/['"]/g, '') ?? null;
      }
    }
    return null;
  },
  exportDetector: (_node, _source) => true,
};

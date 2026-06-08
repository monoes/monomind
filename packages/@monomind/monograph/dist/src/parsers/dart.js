import { createRequire } from 'module';
const require = createRequire(import.meta.url);
export const dartConfig = {
    name: 'dart',
    extensions: ['.dart'],
    treeSitterModule: 'tree-sitter-dart',
    getLanguage: () => {
        const mod = require('tree-sitter-dart');
        return (mod.default ?? mod);
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
            const c = node.child(i);
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
//# sourceMappingURL=dart.js.map
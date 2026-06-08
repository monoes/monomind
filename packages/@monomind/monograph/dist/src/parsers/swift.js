import { createRequire } from 'module';
const require = createRequire(import.meta.url);
export const swiftConfig = {
    name: 'swift',
    extensions: ['.swift'],
    treeSitterModule: 'tree-sitter-swift',
    getLanguage: () => require('tree-sitter-swift').language,
    classNodeTypes: new Set(['class_declaration']),
    structNodeTypes: new Set(['struct_declaration']),
    enumNodeTypes: new Set(['enum_declaration']),
    functionNodeTypes: new Set(['function_declaration']),
    methodNodeTypes: new Set(['function_declaration']),
    constructorNodeTypes: new Set(['init_declaration']),
    interfaceNodeTypes: new Set(['protocol_declaration']),
    importNodeTypes: new Set(['import_declaration']),
    callNodeTypes: new Set(['call_expression']),
    decoratorNodeTypes: new Set(['attribute']),
    nameField: 'name',
    importExtractor: (_source, node) => {
        // import Foundation → last child is identifier
        const last = node.child(node.childCount - 1);
        return last?.text ?? null;
    },
    exportDetector: (_node, _source) => true,
};
//# sourceMappingURL=swift.js.map
import { basename } from 'path';
import { tryLoadParser, walk, } from '../tree-sitter-runner.js';
// ---- helpers ----
function nodeName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode?.text ?? '';
}
function loc(node) {
    return `L${node.startPosition.row + 1}`;
}
// ---- tree-sitter extraction ----
function extractWithTreeSitter(filePath, content) {
    const nodes = [];
    const edges = [];
    const errors = [];
    const parser = tryLoadParser('go');
    if (!parser) {
        return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
    }
    let tree;
    try {
        tree = parser.parse(content);
    }
    catch (err) {
        errors.push(`tree-sitter parse error in ${filePath}: ${String(err)}`);
        return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
    }
    walk(tree.rootNode, (n) => {
        // ---- function declarations ----
        if (n.type === 'function_declaration' || n.type === 'method_declaration') {
            const name = nodeName(n);
            if (name) {
                // For methods, qualify with receiver type
                let qualifiedName = name;
                if (n.type === 'method_declaration') {
                    const receiver = n.childForFieldName('receiver');
                    if (receiver) {
                        // receiver text looks like "(r *MyType)" — extract type name
                        const receiverType = receiver.text.replace(/^\(|\)$/g, '').trim().replace(/^\w+\s+\*?/, '');
                        if (receiverType)
                            qualifiedName = `${receiverType}.${name}`;
                    }
                }
                nodes.push({
                    id: qualifiedName,
                    label: qualifiedName,
                    fileType: 'code',
                    sourceFile: filePath,
                    sourceLocation: loc(n),
                });
            }
            return;
        }
        // ---- type declarations (struct, interface) ----
        if (n.type === 'type_declaration') {
            for (const child of n.children) {
                if (child.type === 'type_spec') {
                    const nameNode = child.childForFieldName('name');
                    const typeNode = child.childForFieldName('type');
                    const typeName = nameNode?.text ?? '';
                    if (!typeName)
                        continue;
                    const typeKind = typeNode?.type === 'struct_type' ? 'struct'
                        : typeNode?.type === 'interface_type' ? 'interface'
                            : 'type';
                    nodes.push({
                        id: typeName,
                        label: typeName,
                        fileType: 'code',
                        sourceFile: filePath,
                        sourceLocation: loc(child),
                        nodeKind: typeKind,
                    });
                }
            }
            return;
        }
        // ---- import declarations ----
        if (n.type === 'import_declaration') {
            for (const child of n.children) {
                if (child.type === 'import_spec_list') {
                    for (const spec of child.children) {
                        if (spec.type === 'import_spec') {
                            const pathNode = spec.childForFieldName('path');
                            if (pathNode) {
                                const importPath = pathNode.text.replace(/^"|"$/g, '');
                                edges.push({
                                    source: basename(filePath),
                                    target: importPath,
                                    relation: 'imports',
                                    confidence: 'EXTRACTED',
                                    sourceFile: filePath,
                                    sourceLocation: loc(spec),
                                });
                            }
                        }
                    }
                }
                if (child.type === 'import_spec') {
                    const pathNode = child.childForFieldName('path');
                    if (pathNode) {
                        const importPath = pathNode.text.replace(/^"|"$/g, '');
                        edges.push({
                            source: basename(filePath),
                            target: importPath,
                            relation: 'imports',
                            confidence: 'EXTRACTED',
                            sourceFile: filePath,
                            sourceLocation: loc(child),
                        });
                    }
                }
            }
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
}
// ---- regex fallback ----
function extractWithRegex(filePath, content) {
    const nodes = [];
    const edges = [];
    const lines = content.split('\n');
    let inImportBlock = false;
    lines.forEach((line, idx) => {
        const location = `L${idx + 1}`;
        const trimmed = line.trim();
        // Detect import blocks
        if (trimmed === 'import (') {
            inImportBlock = true;
            return;
        }
        if (inImportBlock && trimmed === ')') {
            inImportBlock = false;
            return;
        }
        if (inImportBlock) {
            const importPathMatch = trimmed.match(/"([^"]+)"/);
            if (importPathMatch) {
                edges.push({ source: basename(filePath), target: importPathMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            }
            return;
        }
        // Single-line import: import "pkg"
        const singleImportMatch = trimmed.match(/^import\s+"([^"]+)"/);
        if (singleImportMatch) {
            edges.push({ source: basename(filePath), target: singleImportMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
        }
        // Function: func (r *Recv) MethodName(...) or func FuncName(...)
        const funcMatch = trimmed.match(/^func\s+(?:\(\w+\s+\*?(\w+)\)\s+)?(\w+)/);
        if (funcMatch) {
            const receiver = funcMatch[1];
            const name = funcMatch[2];
            const qualifiedName = receiver ? `${receiver}.${name}` : name;
            nodes.push({ id: qualifiedName, label: qualifiedName, fileType: 'code', sourceFile: filePath, sourceLocation: location });
        }
        // Struct: type Name struct
        const structMatch = trimmed.match(/^type\s+(\w+)\s+struct/);
        if (structMatch) {
            nodes.push({ id: structMatch[1], label: structMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'struct' });
        }
        // Interface: type Name interface
        const ifaceMatch = trimmed.match(/^type\s+(\w+)\s+interface/);
        if (ifaceMatch) {
            nodes.push({ id: ifaceMatch[1], label: ifaceMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'interface' });
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}
// ---- extractor implementation ----
export const goExtractor = {
    language: 'go',
    extensions: ['.go'],
    extract(filePath, content) {
        const tsResult = extractWithTreeSitter(filePath, content);
        if (tsResult.nodes.length > 0 || tsResult.edges.length > 0 || tsResult.errors.length > 0) {
            return tsResult;
        }
        return extractWithRegex(filePath, content);
    },
};
//# sourceMappingURL=go.js.map
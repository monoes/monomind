import { basename } from 'path';
import { tryLoadParser, walk } from '../tree-sitter-runner.js';
function loc(node) {
    return `L${node.startPosition.row + 1}`;
}
function extractWithTreeSitter(filePath, content) {
    const nodes = [];
    const edges = [];
    const errors = [];
    const parser = tryLoadParser('c');
    if (!parser)
        return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
    let tree;
    try {
        tree = parser.parse(content);
    }
    catch (err) {
        errors.push(`tree-sitter parse error in ${filePath}: ${String(err)}`);
        return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
    }
    walk(tree.rootNode, (n) => {
        if (n.type === 'function_definition') {
            const declarator = n.childForFieldName('declarator');
            const nameNode = declarator?.childForFieldName('declarator') ?? declarator;
            const name = nameNode?.type === 'identifier' ? nameNode.text : (nameNode?.childForFieldName('name')?.text ?? '');
            if (name)
                nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
            return;
        }
        if (n.type === 'struct_specifier' || n.type === 'union_specifier' || n.type === 'enum_specifier') {
            const nameNode = n.childForFieldName('name');
            if (nameNode?.text) {
                nodes.push({ id: nameNode.text, label: nameNode.text, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n), nodeKind: n.type.replace('_specifier', '') });
            }
            return;
        }
        if (n.type === 'preproc_include') {
            const pathNode = n.childForFieldName('path');
            if (pathNode) {
                const importPath = pathNode.text.replace(/^["<]|[">]$/g, '');
                edges.push({ source: basename(filePath), target: importPath, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
            }
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
}
function extractWithRegex(filePath, content) {
    const nodes = [];
    const edges = [];
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
        const location = `L${idx + 1}`;
        const trimmed = line.trim();
        // #include
        const includeMatch = trimmed.match(/^#include\s+["<]([^">]+)[">]/);
        if (includeMatch) {
            edges.push({ source: basename(filePath), target: includeMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            return;
        }
        // struct / union / enum
        const structMatch = trimmed.match(/^(?:typedef\s+)?(?:struct|union|enum)\s+(\w+)/);
        if (structMatch) {
            nodes.push({ id: structMatch[1], label: structMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location });
            return;
        }
        // function definition: return_type func_name(
        // Heuristic: line not starting with # or //, contains word followed by ( at reasonable position
        if (!trimmed.startsWith('#') && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
            const funcMatch = trimmed.match(/^(?:[\w*\s]+\s)?(\w+)\s*\((?!\s*\))/);
            if (funcMatch && funcMatch[1] && !['if', 'while', 'for', 'switch', 'return', 'sizeof', 'typeof'].includes(funcMatch[1])) {
                // Only emit if previous non-empty line doesn't end with = or , (avoid call expressions)
                nodes.push({ id: funcMatch[1], label: funcMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location });
            }
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}
export const cExtractor = {
    language: 'c',
    extensions: ['.c', '.h'],
    extract(filePath, content) {
        const ts = extractWithTreeSitter(filePath, content);
        if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0)
            return ts;
        return extractWithRegex(filePath, content);
    },
};
//# sourceMappingURL=c.js.map
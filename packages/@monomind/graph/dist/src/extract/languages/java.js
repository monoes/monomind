import { basename } from 'path';
import { tryLoadParser, walk } from '../tree-sitter-runner.js';
function nodeName(node) {
    return node.childForFieldName('name')?.text ?? '';
}
function loc(node) {
    return `L${node.startPosition.row + 1}`;
}
function extractWithTreeSitter(filePath, content) {
    const nodes = [];
    const edges = [];
    const errors = [];
    const parser = tryLoadParser('java');
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
    const classStack = [];
    walk(tree.rootNode, (n) => {
        if (n.type === 'class_declaration' || n.type === 'interface_declaration' || n.type === 'enum_declaration') {
            const name = nodeName(n);
            if (!name)
                return;
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
            classStack.push(name);
            // Superclass / interfaces
            const superclass = n.childForFieldName('superclass');
            if (superclass) {
                edges.push({ source: name, target: superclass.text.replace(/^extends\s+/, '').trim(), relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
            }
            const interfaces = n.childForFieldName('interfaces');
            if (interfaces) {
                for (const child of interfaces.children) {
                    if (child.type === 'type_identifier' || child.type === 'identifier') {
                        edges.push({ source: name, target: child.text, relation: 'implements', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(interfaces) });
                    }
                }
            }
            return;
        }
        if (n.type === 'method_declaration') {
            const name = nodeName(n);
            if (!name)
                return;
            const qualified = classStack.length > 0 ? `${classStack[classStack.length - 1]}.${name}` : name;
            nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
            return;
        }
        if (n.type === 'import_declaration') {
            const path = n.children.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
            if (path) {
                edges.push({ source: basename(filePath), target: path.text, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
            }
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
}
function extractWithRegex(filePath, content) {
    const nodes = [];
    const edges = [];
    const lines = content.split('\n');
    let currentClass = '';
    lines.forEach((line, idx) => {
        const location = `L${idx + 1}`;
        const trimmed = line.trim();
        // class / interface / enum
        const classMatch = trimmed.match(/^(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+|static\s+)*(?:class|interface|enum)\s+(\w+)/);
        if (classMatch) {
            const name = classMatch[1];
            currentClass = name;
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
            const extendsMatch = trimmed.match(/\bextends\s+(\w+)/);
            if (extendsMatch)
                edges.push({ source: name, target: extendsMatch[1], relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            const implMatch = trimmed.match(/\bimplements\s+([\w,\s]+?)(?:\{|$)/);
            if (implMatch) {
                for (const iface of implMatch[1].split(',')) {
                    const n = iface.trim();
                    if (n)
                        edges.push({ source: name, target: n, relation: 'implements', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
                }
            }
            return;
        }
        // method declarations
        const methodMatch = trimmed.match(/^(?:public|private|protected|static|final|abstract|synchronized|native|strictfp|\s)*(?:[\w<>\[\]]+)\s+(\w+)\s*\(/);
        if (methodMatch && currentClass && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
            const name = `${currentClass}.${methodMatch[1]}`;
            if (!['if', 'while', 'for', 'switch', 'catch'].includes(methodMatch[1])) {
                nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
            }
        }
        // imports
        const importMatch = trimmed.match(/^import\s+(?:static\s+)?([\w.]+(?:\.\*)?);/);
        if (importMatch) {
            edges.push({ source: basename(filePath), target: importMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}
export const javaExtractor = {
    language: 'java',
    extensions: ['.java'],
    extract(filePath, content) {
        const ts = extractWithTreeSitter(filePath, content);
        if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0)
            return ts;
        return extractWithRegex(filePath, content);
    },
};
//# sourceMappingURL=java.js.map
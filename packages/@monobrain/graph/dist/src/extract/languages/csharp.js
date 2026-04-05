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
    const parser = tryLoadParser('csharp');
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
        if (n.type === 'class_declaration' || n.type === 'interface_declaration' || n.type === 'struct_declaration' || n.type === 'enum_declaration' || n.type === 'record_declaration') {
            const name = nodeName(n);
            if (!name)
                return;
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
            classStack.push(name);
            // base_list: : Base, IFoo, IBar
            const baseList = n.childForFieldName('bases');
            if (baseList) {
                for (const child of baseList.children) {
                    if (child.type === 'identifier' || child.type === 'qualified_name') {
                        edges.push({ source: name, target: child.text, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(baseList) });
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
        if (n.type === 'using_directive') {
            const ns = n.children.find((c) => c.type === 'identifier' || c.type === 'qualified_name');
            if (ns) {
                edges.push({ source: basename(filePath), target: ns.text, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
            }
        }
        if (n.type === 'namespace_declaration') {
            const name = nodeName(n);
            if (name)
                nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n), nodeKind: 'namespace' });
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
        // using
        const usingMatch = trimmed.match(/^using\s+([\w.]+);/);
        if (usingMatch) {
            edges.push({ source: basename(filePath), target: usingMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            return;
        }
        // namespace
        const nsMatch = trimmed.match(/^namespace\s+([\w.]+)/);
        if (nsMatch) {
            nodes.push({ id: nsMatch[1], label: nsMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'namespace' });
            return;
        }
        // class / interface / struct / enum / record
        const classMatch = trimmed.match(/^(?:public|private|protected|internal|abstract|sealed|static|partial|\s)*(?:class|interface|struct|enum|record)\s+(\w+)/);
        if (classMatch) {
            const name = classMatch[1];
            currentClass = name;
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
            // inheritance / interfaces
            const baseMatch = trimmed.match(/:\s*([\w,\s<>]+?)(?:\{|where|$)/);
            if (baseMatch) {
                for (const base of baseMatch[1].split(',')) {
                    const b = base.trim().split('<')[0];
                    if (b)
                        edges.push({ source: name, target: b, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
                }
            }
            return;
        }
        // method: access? modifier? returnType MethodName(
        const methodMatch = trimmed.match(/^(?:public|private|protected|internal|static|virtual|override|abstract|async|\s)+[\w<>\[\]?]+\s+(\w+)\s*(?:<[^>]*>)?\s*\(/);
        if (methodMatch && currentClass && !['if', 'while', 'for', 'switch', 'catch', 'foreach', 'using'].includes(methodMatch[1])) {
            const name = `${currentClass}.${methodMatch[1]}`;
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}
export const csharpExtractor = {
    language: 'csharp',
    extensions: ['.cs'],
    extract(filePath, content) {
        const ts = extractWithTreeSitter(filePath, content);
        if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0)
            return ts;
        return extractWithRegex(filePath, content);
    },
};
//# sourceMappingURL=csharp.js.map
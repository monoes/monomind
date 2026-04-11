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
    const parser = tryLoadParser('scala');
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
        if (['class_definition', 'object_definition', 'trait_definition', 'case_class_definition'].includes(n.type)) {
            const name = nodeName(n);
            if (!name)
                return;
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
            classStack.push(name);
            // extends_clause / with_clause
            for (const child of n.children) {
                if (child.type === 'extends_clause' || child.type === 'with_clause') {
                    for (const sub of child.children) {
                        if (sub.type === 'type_identifier' || sub.type === 'identifier') {
                            const relation = child.type === 'with_clause' ? 'implements' : 'extends';
                            edges.push({ source: name, target: sub.text, relation, confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(child) });
                        }
                    }
                }
            }
            return;
        }
        if (n.type === 'function_definition') {
            const name = nodeName(n);
            if (!name)
                return;
            const qualified = classStack.length > 0 ? `${classStack[classStack.length - 1]}.${name}` : name;
            nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
            return;
        }
        if (n.type === 'import_declaration') {
            const expr = n.children.find((c) => c.type !== 'import');
            if (expr)
                edges.push({ source: basename(filePath), target: expr.text.replace(/\._$/, '._'), relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
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
        // import
        const importMatch = trimmed.match(/^import\s+([\w.]+(?:\._|,)?)/);
        if (importMatch) {
            edges.push({ source: basename(filePath), target: importMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            return;
        }
        // class / object / trait / case class
        const classMatch = trimmed.match(/^(?:abstract\s+|sealed\s+|final\s+|case\s+|implicit\s+)*(?:class|object|trait)\s+(\w+)/);
        if (classMatch) {
            const name = classMatch[1];
            currentClass = name;
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
            const extendsMatch = trimmed.match(/\bextends\s+([\w.[\]]+)/);
            if (extendsMatch)
                edges.push({ source: name, target: extendsMatch[1], relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            const withMatches = [...trimmed.matchAll(/\bwith\s+(\w+)/g)];
            for (const m of withMatches) {
                edges.push({ source: name, target: m[1], relation: 'implements', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            }
            return;
        }
        // def
        const defMatch = trimmed.match(/^(?:override\s+|private\s+|protected\s+|abstract\s+|final\s+|implicit\s+)*def\s+(\w+)/);
        if (defMatch) {
            const name = defMatch[1];
            const qualified = currentClass ? `${currentClass}.${name}` : name;
            nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: location });
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}
export const scalaExtractor = {
    language: 'scala',
    extensions: ['.scala', '.sc'],
    extract(filePath, content) {
        const ts = extractWithTreeSitter(filePath, content);
        if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0)
            return ts;
        return extractWithRegex(filePath, content);
    },
};
//# sourceMappingURL=scala.js.map
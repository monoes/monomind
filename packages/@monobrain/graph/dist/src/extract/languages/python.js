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
    const parser = tryLoadParser('python');
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
    // Track method context for call attribution
    const functionStack = [];
    const classStack = [];
    walk(tree.rootNode, (n) => {
        // ---- class definitions ----
        if (n.type === 'class_definition') {
            const name = nodeName(n);
            if (name) {
                nodes.push({
                    id: name,
                    label: name,
                    fileType: 'code',
                    sourceFile: filePath,
                    sourceLocation: loc(n),
                });
                classStack.push(name);
                // Inheritance: class A(B, C):
                const argList = n.childForFieldName('superclasses');
                if (argList) {
                    for (const child of argList.children) {
                        if (child.type === 'identifier' || child.type === 'attribute') {
                            edges.push({
                                source: name,
                                target: child.text,
                                relation: 'extends',
                                confidence: 'EXTRACTED',
                                sourceFile: filePath,
                                sourceLocation: loc(argList),
                            });
                        }
                    }
                }
            }
            return;
        }
        // ---- function / async function definitions ----
        if (n.type === 'function_definition' || n.type === 'decorated_definition') {
            // For decorated_definition, descend to find the inner function_definition
            const funcNode = n.type === 'decorated_definition'
                ? (n.children.find((c) => c.type === 'function_definition') ?? n)
                : n;
            const name = nodeName(funcNode);
            if (name) {
                const qualifiedName = classStack.length > 0
                    ? `${classStack[classStack.length - 1]}.${name}`
                    : name;
                nodes.push({
                    id: qualifiedName,
                    label: qualifiedName,
                    fileType: 'code',
                    sourceFile: filePath,
                    sourceLocation: loc(funcNode),
                });
                functionStack.push(qualifiedName);
            }
            return;
        }
        // ---- import statements ----
        if (n.type === 'import_statement') {
            // import X, import X as Y
            for (const child of n.children) {
                if (child.type === 'dotted_name' || child.type === 'aliased_import') {
                    const importedName = child.type === 'aliased_import'
                        ? child.childForFieldName('name')?.text ?? child.text
                        : child.text;
                    if (importedName) {
                        edges.push({
                            source: basename(filePath),
                            target: importedName,
                            relation: 'imports',
                            confidence: 'EXTRACTED',
                            sourceFile: filePath,
                            sourceLocation: loc(n),
                        });
                    }
                }
            }
            return;
        }
        // ---- from X import Y ----
        if (n.type === 'import_from_statement') {
            const moduleNode = n.childForFieldName('module_name');
            const moduleName = moduleNode?.text ?? '';
            if (moduleName) {
                edges.push({
                    source: basename(filePath),
                    target: moduleName,
                    relation: 'imports',
                    confidence: 'EXTRACTED',
                    sourceFile: filePath,
                    sourceLocation: loc(n),
                });
            }
            // Also emit edges for individual imported names
            for (const child of n.children) {
                if (child.type === 'dotted_name' || child.type === 'identifier') {
                    // Skip the module_name we already handled
                    if (child === moduleNode)
                        continue;
                    edges.push({
                        source: filePath,
                        target: child.text,
                        relation: 'imports',
                        confidence: 'EXTRACTED',
                        sourceFile: filePath,
                        sourceLocation: loc(n),
                    });
                }
                if (child.type === 'aliased_import') {
                    const importedName = child.childForFieldName('name')?.text ?? child.text;
                    if (importedName) {
                        edges.push({
                            source: filePath,
                            target: importedName,
                            relation: 'imports',
                            confidence: 'EXTRACTED',
                            sourceFile: filePath,
                            sourceLocation: loc(n),
                        });
                    }
                }
            }
            return;
        }
        // ---- call expressions ----
        if (n.type === 'call') {
            const fnNode = n.childForFieldName('function');
            if (!fnNode)
                return;
            const calleeName = fnNode.text;
            const caller = functionStack[functionStack.length - 1] ??
                classStack[classStack.length - 1] ??
                basename(filePath);
            if (calleeName && caller && calleeName !== caller) {
                edges.push({
                    source: caller,
                    target: calleeName,
                    relation: 'calls',
                    confidence: 'INFERRED',
                    confidenceScore: 0.7,
                    sourceFile: filePath,
                    sourceLocation: loc(n),
                });
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
    lines.forEach((line, idx) => {
        const location = `L${idx + 1}`;
        // class
        const classMatch = line.match(/^class\s+(\w+)/);
        if (classMatch) {
            const name = classMatch[1];
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
            // inheritance: class A(B, C):
            const inheritMatch = line.match(/^class\s+\w+\(([^)]+)\)/);
            if (inheritMatch) {
                for (const base of inheritMatch[1].split(',')) {
                    const baseName = base.trim();
                    if (baseName && baseName !== 'object') {
                        edges.push({ source: name, target: baseName, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
                    }
                }
            }
        }
        // function
        const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
        if (funcMatch) {
            const name = funcMatch[1];
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
        }
        // import
        const importMatch = line.match(/^import\s+(\S+)/);
        if (importMatch) {
            edges.push({ source: basename(filePath), target: importMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
        }
        // from X import Y
        const fromImportMatch = line.match(/^from\s+(\S+)\s+import/);
        if (fromImportMatch) {
            edges.push({ source: basename(filePath), target: fromImportMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}
// ---- extractor implementation ----
export const pythonExtractor = {
    language: 'python',
    extensions: ['.py', '.pyw'],
    extract(filePath, content) {
        const tsResult = extractWithTreeSitter(filePath, content);
        if (tsResult.nodes.length > 0 || tsResult.edges.length > 0 || tsResult.errors.length > 0) {
            return tsResult;
        }
        return extractWithRegex(filePath, content);
    },
};
//# sourceMappingURL=python.js.map
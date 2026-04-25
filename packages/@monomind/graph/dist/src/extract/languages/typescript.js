import { basename } from 'path';
import { tryLoadParser, walk, } from '../tree-sitter-runner.js';
// ---- helpers ----
function nodeName(node) {
    // Most declaration nodes expose "name" as a named field
    const nameNode = node.childForFieldName('name');
    return nameNode?.text ?? '';
}
function loc(node) {
    return `L${node.startPosition.row + 1}`;
}
// ---- tree-sitter extraction ----
const CLASS_TYPES = new Set([
    'class_declaration',
    'abstract_class_declaration',
]);
const FUNCTION_TYPES = new Set([
    'function_declaration',
    'generator_function_declaration',
]);
function extractWithTreeSitter(filePath, content, language) {
    const nodes = [];
    const edges = [];
    const errors = [];
    const parser = tryLoadParser(language);
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
    // Track current class/method context for call-edge attribution
    const classStack = [];
    const methodStack = [];
    const addNode = (name, n) => {
        if (!name)
            return;
        nodes.push({
            id: name,
            label: name,
            fileType: 'code',
            sourceFile: filePath,
            sourceLocation: loc(n),
        });
    };
    walk(tree.rootNode, (n) => {
        // ---- classes ----
        if (CLASS_TYPES.has(n.type)) {
            const name = nodeName(n);
            addNode(name, n);
            if (name)
                classStack.push(name);
            // heritage: extends / implements
            for (const child of n.children) {
                if (child.type === 'class_heritage') {
                    for (const clause of child.children) {
                        if (clause.type !== 'extends_clause' && clause.type !== 'implements_clause')
                            continue;
                        const relation = clause.type === 'extends_clause' ? 'extends' : 'implements';
                        // Each type_identifier inside the clause is a target
                        for (const target of clause.children) {
                            if (target.type === 'type_identifier' ||
                                target.type === 'identifier') {
                                edges.push({
                                    source: name,
                                    target: target.text,
                                    relation,
                                    confidence: 'EXTRACTED',
                                    sourceFile: filePath,
                                    sourceLocation: loc(clause),
                                });
                            }
                        }
                    }
                }
            }
            return;
        }
        // ---- functions (top-level) ----
        if (FUNCTION_TYPES.has(n.type)) {
            const name = nodeName(n);
            addNode(name, n);
            if (name)
                methodStack.push(name);
            return;
        }
        // ---- method definitions (inside class body) ----
        if (n.type === 'method_definition' || n.type === 'public_field_definition') {
            const name = nodeName(n);
            // Qualify name with class if available
            const qualifiedName = classStack.length > 0 ? `${classStack[classStack.length - 1]}.${name}` : name;
            addNode(qualifiedName, n);
            if (qualifiedName)
                methodStack.push(qualifiedName);
            return;
        }
        // ---- interfaces ----
        if (n.type === 'interface_declaration') {
            const name = nodeName(n);
            addNode(name, n);
            // interface X extends Y
            for (const child of n.children) {
                if (child.type === 'extends_type_clause' || child.type === 'extends_clause') {
                    for (const target of child.children) {
                        if (target.type === 'type_identifier' || target.type === 'identifier') {
                            edges.push({
                                source: name,
                                target: target.text,
                                relation: 'extends',
                                confidence: 'EXTRACTED',
                                sourceFile: filePath,
                                sourceLocation: loc(child),
                            });
                        }
                    }
                }
            }
            return;
        }
        // ---- type aliases ----
        if (n.type === 'type_alias_declaration') {
            const name = nodeName(n);
            addNode(name, n);
            return;
        }
        // ---- import statements ----
        if (n.type === 'import_statement') {
            // Extract the module specifier
            const moduleSpecifier = n.childForFieldName('source');
            const moduleText = moduleSpecifier
                ? moduleSpecifier.text.replace(/^['"]|['"]$/g, '')
                : '';
            // Extract named specifiers: import { A, B } from '...'
            for (const child of n.children) {
                if (child.type === 'named_imports' || child.type === 'import_clause') {
                    for (const spec of child.children) {
                        if (spec.type === 'import_specifier') {
                            const importedName = spec.childForFieldName('name')?.text ?? spec.text;
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
                }
                // Default import: import X from '...'
                if (child.type === 'import_clause') {
                    const defaultId = child.childForFieldName('name') ?? (child.children.find(c => c.type === 'identifier') ?? null);
                    if (defaultId) {
                        edges.push({
                            source: filePath,
                            target: defaultId.text,
                            relation: 'imports',
                            confidence: 'EXTRACTED',
                            sourceFile: filePath,
                            sourceLocation: loc(n),
                        });
                    }
                }
            }
            // Always emit a file-level import edge to the module path
            if (moduleText) {
                edges.push({
                    source: basename(filePath),
                    target: moduleText,
                    relation: 'imports',
                    confidence: 'EXTRACTED',
                    sourceFile: filePath,
                    sourceLocation: loc(n),
                });
            }
            return;
        }
        // ---- call expressions ----
        if (n.type === 'call_expression') {
            const fnNode = n.childForFieldName('function');
            if (!fnNode)
                return;
            // Resolve callee name (may be `a.b()` or plain `foo()`)
            let calleeName;
            if (fnNode.type === 'member_expression') {
                calleeName = fnNode.text;
            }
            else {
                calleeName = fnNode.text;
            }
            // Attribute to deepest known method context
            const caller = methodStack[methodStack.length - 1] ??
                classStack[classStack.length - 1] ??
                basename(filePath);
            if (calleeName && caller && calleeName !== caller) {
                edges.push({
                    source: caller,
                    target: calleeName,
                    relation: 'calls',
                    confidence: 'INFERRED',
                    confidenceScore: 0.8,
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
        const classMatch = line.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)/);
        if (classMatch) {
            const name = classMatch[3];
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
            // extends
            const extendsMatch = line.match(/\bextends\s+(\w+)/);
            if (extendsMatch) {
                edges.push({ source: name, target: extendsMatch[1], relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            }
            // implements
            const implementsMatch = line.match(/\bimplements\s+([\w,\s]+)/);
            if (implementsMatch) {
                for (const impl of implementsMatch[1].split(',')) {
                    const implName = impl.trim().split(/\s/)[0];
                    if (implName) {
                        edges.push({ source: name, target: implName, relation: 'implements', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
                    }
                }
            }
        }
        // interface
        const ifaceMatch = line.match(/^(export\s+)?interface\s+(\w+)/);
        if (ifaceMatch) {
            const name = ifaceMatch[2];
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
        }
        // type alias
        const typeMatch = line.match(/^(export\s+)?type\s+(\w+)\s*=/);
        if (typeMatch) {
            const name = typeMatch[2];
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
        }
        // function
        const funcMatch = line.match(/^(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)/);
        if (funcMatch) {
            const name = funcMatch[4];
            nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
        }
        // import
        const importMatch = line.match(/^import\s+.*from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
            edges.push({ source: basename(filePath), target: importMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
            // Named specifiers
            const namedMatch = line.match(/\{([^}]+)\}/);
            if (namedMatch) {
                for (const spec of namedMatch[1].split(',')) {
                    const specName = spec.trim().split(/\s+as\s+/)[0].trim();
                    if (specName) {
                        edges.push({ source: filePath, target: specName, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
                    }
                }
            }
        }
    });
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}
// ---- extractor implementation ----
export const typescriptExtractor = {
    language: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    extract(filePath, content) {
        const lang = filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? 'tsx' : 'typescript';
        const tsResult = extractWithTreeSitter(filePath, content, lang);
        if (tsResult.nodes.length > 0 || tsResult.edges.length > 0 || tsResult.errors.length > 0) {
            return tsResult;
        }
        // tree-sitter not available or produced nothing — fall back to regex
        return extractWithRegex(filePath, content);
    },
};
//# sourceMappingURL=typescript.js.map
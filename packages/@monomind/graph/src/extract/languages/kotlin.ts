import { basename } from 'path';
import type { GraphNode, GraphEdge, ExtractionResult } from '../../types.js';
import type { LanguageExtractor } from '../types.js';
import { tryLoadParser, walk, type SyntaxNodeLike } from '../tree-sitter-runner.js';

function nodeName(node: SyntaxNodeLike): string {
  return node.childForFieldName('name')?.text ?? '';
}

function loc(node: SyntaxNodeLike): string {
  return `L${node.startPosition.row + 1}`;
}

function extractWithTreeSitter(filePath: string, content: string): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const errors: string[] = [];

  const parser = tryLoadParser('kotlin');
  if (!parser) return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };

  let tree: { rootNode: SyntaxNodeLike };
  try {
    tree = parser.parse(content);
  } catch (err) {
    errors.push(`tree-sitter parse error in ${filePath}: ${String(err)}`);
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
  }

  const classStack: string[] = [];

  walk(tree.rootNode, (n) => {
    if (n.type === 'class_declaration' || n.type === 'interface_declaration' || n.type === 'object_declaration') {
      const name = nodeName(n);
      if (!name) return;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      classStack.push(name);
      // delegation_specifiers (: Base, Foo)
      const delegation = n.children.find((c) => c.type === 'delegation_specifiers');
      if (delegation) {
        for (const spec of delegation.children) {
          if (spec.type === 'constructor_invocation' || spec.type === 'explicit_delegation') {
            const typeName = spec.childForFieldName('type')?.text ?? spec.children[0]?.text ?? '';
            if (typeName) edges.push({ source: name, target: typeName, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(delegation) });
          }
        }
      }
      return;
    }

    if (n.type === 'function_declaration') {
      const name = nodeName(n);
      if (!name) return;
      const qualified = classStack.length > 0 ? `${classStack[classStack.length - 1]}.${name}` : name;
      nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      return;
    }

    if (n.type === 'import_header') {
      const id = n.children.find((c) => c.type === 'identifier' || c.type === 'dot_qualified_expression');
      if (id) edges.push({ source: basename(filePath), target: id.text, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
}

function extractWithRegex(filePath: string, content: string): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const lines = content.split('\n');
  let currentClass = '';

  lines.forEach((line, idx) => {
    const location = `L${idx + 1}`;
    const trimmed = line.trim();

    // import
    const importMatch = trimmed.match(/^import\s+([\w.]+(?:\.\*)?)/);
    if (importMatch) {
      edges.push({ source: basename(filePath), target: importMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      return;
    }

    // class / interface / object / data class / sealed class
    const classMatch = trimmed.match(/^(?:data\s+|sealed\s+|abstract\s+|open\s+|inner\s+|enum\s+|annotation\s+)*(?:class|interface|object)\s+(\w+)/);
    if (classMatch) {
      const name = classMatch[1];
      currentClass = name;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
      // inheritance: class Foo : Bar(), Baz
      const inhMatch = trimmed.match(/:\s*([\w(),\s]+?)(?:\{|$)/);
      if (inhMatch) {
        for (const part of inhMatch[1].split(',')) {
          const b = part.trim().replace(/\(.*$/, '').trim();
          if (b) edges.push({ source: name, target: b, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
        }
      }
      return;
    }

    // fun
    const funMatch = trimmed.match(/^(?:private\s+|public\s+|protected\s+|internal\s+|override\s+|suspend\s+|inline\s+|operator\s+)*fun\s+(?:<[^>]+>\s+)?(\w+)/);
    if (funMatch) {
      const name = funMatch[1];
      const qualified = currentClass ? `${currentClass}.${name}` : name;
      nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: location });
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}

export const kotlinExtractor: LanguageExtractor = {
  language: 'kotlin',
  extensions: ['.kt', '.kts'],
  extract(filePath: string, content: string): ExtractionResult {
    const ts = extractWithTreeSitter(filePath, content);
    if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0) return ts;
    return extractWithRegex(filePath, content);
  },
};

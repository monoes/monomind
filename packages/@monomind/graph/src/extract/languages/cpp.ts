import { basename } from 'path';
import type { GraphNode, GraphEdge, ExtractionResult } from '../../types.js';
import type { LanguageExtractor } from '../types.js';
import { tryLoadParser, walk, type SyntaxNodeLike } from '../tree-sitter-runner.js';

function loc(node: SyntaxNodeLike): string {
  return `L${node.startPosition.row + 1}`;
}

function extractWithTreeSitter(filePath: string, content: string): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const errors: string[] = [];

  const parser = tryLoadParser('cpp');
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
    if (n.type === 'class_specifier' || n.type === 'struct_specifier') {
      const nameNode = n.childForFieldName('name');
      const name = nameNode?.text ?? '';
      if (!name) return;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      classStack.push(name);
      // base_class_clause
      const baseClause = n.children.find((c) => c.type === 'base_class_clause');
      if (baseClause) {
        for (const child of baseClause.children) {
          if (child.type === 'type_identifier' || child.type === 'identifier') {
            edges.push({ source: name, target: child.text, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(baseClause) });
          }
        }
      }
      return;
    }

    if (n.type === 'function_definition') {
      const declarator = n.childForFieldName('declarator');
      const nameNode = declarator?.childForFieldName('declarator') ?? declarator;
      const rawName = nameNode?.type === 'identifier' ? nameNode.text
        : nameNode?.type === 'qualified_identifier' ? nameNode.text
        : (nameNode?.childForFieldName('name')?.text ?? '');
      if (rawName) nodes.push({ id: rawName, label: rawName, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      return;
    }

    if (n.type === 'preproc_include') {
      const pathNode = n.childForFieldName('path');
      if (pathNode) {
        const importPath = pathNode.text.replace(/^["<]|[">]$/g, '');
        edges.push({ source: basename(filePath), target: importPath, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
      }
    }

    if (n.type === 'namespace_definition') {
      const nameNode = n.childForFieldName('name');
      if (nameNode?.text) {
        nodes.push({ id: nameNode.text, label: nameNode.text, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n), nodeKind: 'namespace' });
      }
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
}

function extractWithRegex(filePath: string, content: string): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

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

    // namespace
    const nsMatch = trimmed.match(/^namespace\s+(\w+)/);
    if (nsMatch) {
      nodes.push({ id: nsMatch[1], label: nsMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'namespace' });
      return;
    }

    // class / struct
    const classMatch = trimmed.match(/^(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+(\w+)/);
    if (classMatch) {
      const name = classMatch[1];
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
      // inheritance
      const inhMatch = trimmed.match(/:\s*(?:public|private|protected)?\s*([\w:]+)/);
      if (inhMatch) {
        edges.push({ source: name, target: inhMatch[1], relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      }
      return;
    }

    // method/function: ReturnType ClassName::methodName( or ReturnType funcName(
    const methodMatch = trimmed.match(/^[\w*:<>\s]+?\s+(?:(\w+)::)?(\w+)\s*\(/);
    if (methodMatch && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
      const receiver = methodMatch[1];
      const name = methodMatch[2];
      if (name && !['if', 'while', 'for', 'switch', 'return', 'catch'].includes(name)) {
        const qualified = receiver ? `${receiver}::${name}` : name;
        nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: location });
      }
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}

export const cppExtractor: LanguageExtractor = {
  language: 'cpp',
  extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'],
  extract(filePath: string, content: string): ExtractionResult {
    const ts = extractWithTreeSitter(filePath, content);
    if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0) return ts;
    return extractWithRegex(filePath, content);
  },
};

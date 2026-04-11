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

  const parser = tryLoadParser('php');
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
    if (n.type === 'class_declaration' || n.type === 'interface_declaration' || n.type === 'trait_declaration') {
      const name = nodeName(n);
      if (!name) return;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      classStack.push(name);
      // base_clause / class_implements
      const base = n.childForFieldName('base_clause');
      if (base) {
        const baseType = base.children.find((c) => c.type === 'named_type' || c.type === 'name');
        if (baseType) edges.push({ source: name, target: baseType.text, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(base) });
      }
      const impl = n.childForFieldName('class_implements');
      if (impl) {
        for (const child of impl.children) {
          if (child.type === 'named_type' || child.type === 'name') {
            edges.push({ source: name, target: child.text, relation: 'implements', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(impl) });
          }
        }
      }
      return;
    }

    if (n.type === 'method_declaration' || n.type === 'function_definition') {
      const name = nodeName(n);
      if (!name) return;
      const qualified = classStack.length > 0 && n.type === 'method_declaration' ? `${classStack[classStack.length - 1]}::${name}` : name;
      nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      return;
    }

    if (n.type === 'namespace_use_declaration') {
      for (const child of n.children) {
        if (child.type === 'namespace_use_clause' || child.type === 'qualified_name' || child.type === 'name') {
          const imported = child.childForFieldName('name')?.text ?? child.text;
          if (imported && imported !== 'use') {
            edges.push({ source: basename(filePath), target: imported, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
          }
        }
      }
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

    // use (namespace import)
    const useMatch = trimmed.match(/^use\s+([\w\\]+(?:\s+as\s+\w+)?);/);
    if (useMatch) {
      const target = useMatch[1].split(/\s+as\s+/)[0].trim();
      edges.push({ source: basename(filePath), target, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      return;
    }

    // require / include
    const requireMatch = trimmed.match(/^(?:require|include)(?:_once)?\s+['"]([^'"]+)['"]/);
    if (requireMatch) {
      edges.push({ source: basename(filePath), target: requireMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      return;
    }

    // class / interface / trait
    const classMatch = trimmed.match(/^(?:abstract\s+|final\s+)*(?:class|interface|trait)\s+(\w+)/);
    if (classMatch) {
      const name = classMatch[1];
      currentClass = name;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
      const extendsMatch = trimmed.match(/\bextends\s+(\w+)/);
      if (extendsMatch) edges.push({ source: name, target: extendsMatch[1], relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      const implMatch = trimmed.match(/\bimplements\s+([\w,\s]+?)(?:\{|$)/);
      if (implMatch) {
        for (const iface of implMatch[1].split(',')) {
          const n = iface.trim();
          if (n) edges.push({ source: name, target: n, relation: 'implements', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
        }
      }
      return;
    }

    // function
    const funcMatch = trimmed.match(/^(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*function\s+(\w+)/);
    if (funcMatch) {
      const name = funcMatch[1];
      const qualified = currentClass ? `${currentClass}::${name}` : name;
      nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: location });
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}

export const phpExtractor: LanguageExtractor = {
  language: 'php',
  extensions: ['.php', '.phtml'],
  extract(filePath: string, content: string): ExtractionResult {
    const ts = extractWithTreeSitter(filePath, content);
    if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0) return ts;
    return extractWithRegex(filePath, content);
  },
};

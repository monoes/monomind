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

  const parser = tryLoadParser('swift');
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
    if (['class_declaration', 'struct_declaration', 'protocol_declaration', 'enum_declaration', 'actor_declaration'].includes(n.type)) {
      const name = nodeName(n);
      if (!name) return;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      classStack.push(name);
      // type_inheritance_clause: : Foo, Bar
      const inherit = n.children.find((c) => c.type === 'type_inheritance_clause');
      if (inherit) {
        for (const child of inherit.children) {
          if (child.type === 'type_identifier' || child.type === 'user_type') {
            edges.push({ source: name, target: child.text, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(inherit) });
          }
        }
      }
      return;
    }

    if (n.type === 'extension_declaration') {
      const extType = n.childForFieldName('type')?.text ?? nodeName(n);
      if (extType) nodes.push({ id: `${extType} (ext)`, label: `${extType} (ext)`, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n), nodeKind: 'extension' });
      return;
    }

    if (n.type === 'function_declaration') {
      const name = nodeName(n);
      if (!name) return;
      const qualified = classStack.length > 0 ? `${classStack[classStack.length - 1]}.${name}` : name;
      nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      return;
    }

    if (n.type === 'import_declaration') {
      const path = n.children.filter((c) => c.type === 'identifier').map((c) => c.text).join('.');
      if (path) edges.push({ source: basename(filePath), target: path, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
}

function extractWithRegex(filePath: string, content: string): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const lines = content.split('\n');
  let currentType = '';

  lines.forEach((line, idx) => {
    const location = `L${idx + 1}`;
    const trimmed = line.trim();

    // import
    const importMatch = trimmed.match(/^import\s+([\w.]+)/);
    if (importMatch) {
      edges.push({ source: basename(filePath), target: importMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      return;
    }

    // class / struct / protocol / enum / actor
    const typeMatch = trimmed.match(/^(?:public\s+|private\s+|internal\s+|open\s+|final\s+)*(?:class|struct|protocol|enum|actor)\s+(\w+)/);
    if (typeMatch) {
      const name = typeMatch[1];
      currentType = name;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
      // : Foo, Bar
      const inhMatch = trimmed.match(/:\s*([\w,\s&]+?)(?:\{|where|$)/);
      if (inhMatch) {
        for (const part of inhMatch[1].split(',')) {
          const b = part.trim();
          if (b) edges.push({ source: name, target: b, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
        }
      }
      return;
    }

    // extension
    const extMatch = trimmed.match(/^extension\s+([\w.]+)/);
    if (extMatch) {
      nodes.push({ id: `${extMatch[1]} (ext)`, label: `${extMatch[1]} (ext)`, fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'extension' });
      return;
    }

    // func
    const funcMatch = trimmed.match(/^(?:public\s+|private\s+|internal\s+|open\s+|static\s+|class\s+|override\s+|mutating\s+)*func\s+(\w+)/);
    if (funcMatch) {
      const name = funcMatch[1];
      const qualified = currentType ? `${currentType}.${name}` : name;
      nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: location });
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}

export const swiftExtractor: LanguageExtractor = {
  language: 'swift',
  extensions: ['.swift'],
  extract(filePath: string, content: string): ExtractionResult {
    const ts = extractWithTreeSitter(filePath, content);
    if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0) return ts;
    return extractWithRegex(filePath, content);
  },
};

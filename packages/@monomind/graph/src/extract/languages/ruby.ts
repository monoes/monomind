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

  const parser = tryLoadParser('ruby');
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
    if (n.type === 'class') {
      const nameNode = n.childForFieldName('name');
      const name = nameNode?.text ?? '';
      if (!name) return;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      classStack.push(name);
      const superclass = n.childForFieldName('superclass');
      if (superclass) {
        const superName = superclass.text.replace(/^<\s*/, '').trim();
        edges.push({ source: name, target: superName, relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
      }
      return;
    }

    if (n.type === 'module') {
      const nameNode = n.childForFieldName('name');
      if (nameNode?.text) {
        nodes.push({ id: nameNode.text, label: nameNode.text, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n), nodeKind: 'module' });
        classStack.push(nameNode.text);
      }
      return;
    }

    if (n.type === 'method' || n.type === 'singleton_method') {
      const nameNode = n.childForFieldName('name');
      if (!nameNode?.text) return;
      const qualified = classStack.length > 0 ? `${classStack[classStack.length - 1]}#${nameNode.text}` : nameNode.text;
      nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: loc(n) });
      return;
    }

    if (n.type === 'call' && n.childForFieldName('method')?.text === 'require') {
      const args = n.childForFieldName('arguments');
      if (args) {
        const strNode = args.children.find((c) => c.type === 'string');
        if (strNode) {
          const importPath = strNode.text.replace(/^['"]|['"]$/g, '');
          edges.push({ source: basename(filePath), target: importPath, relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: loc(n) });
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

    // require / require_relative
    const requireMatch = trimmed.match(/^require(?:_relative)?\s+['"]([^'"]+)['"]/);
    if (requireMatch) {
      edges.push({ source: basename(filePath), target: requireMatch[1], relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      return;
    }

    // module
    const moduleMatch = trimmed.match(/^module\s+([\w:]+)/);
    if (moduleMatch) {
      nodes.push({ id: moduleMatch[1], label: moduleMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'module' });
      if (!currentClass) currentClass = moduleMatch[1];
      return;
    }

    // class
    const classMatch = trimmed.match(/^class\s+([\w:]+)/);
    if (classMatch) {
      const name = classMatch[1];
      currentClass = name;
      nodes.push({ id: name, label: name, fileType: 'code', sourceFile: filePath, sourceLocation: location });
      const superMatch = trimmed.match(/\s+<\s+([\w:]+)/);
      if (superMatch) {
        edges.push({ source: name, target: superMatch[1], relation: 'extends', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      }
      return;
    }

    // def
    const defMatch = trimmed.match(/^def\s+(self\.)?(\w+[?!]?)/);
    if (defMatch) {
      const name = defMatch[2];
      const qualified = currentClass ? `${currentClass}#${name}` : name;
      nodes.push({ id: qualified, label: qualified, fileType: 'code', sourceFile: filePath, sourceLocation: location });
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}

export const rubyExtractor: LanguageExtractor = {
  language: 'ruby',
  extensions: ['.rb', '.rake', '.gemspec'],
  extract(filePath: string, content: string): ExtractionResult {
    const ts = extractWithTreeSitter(filePath, content);
    if (ts.nodes.length > 0 || ts.edges.length > 0 || ts.errors.length > 0) return ts;
    return extractWithRegex(filePath, content);
  },
};

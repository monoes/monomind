import { basename } from 'path';
import type { GraphNode, GraphEdge, ExtractionResult } from '../../types.js';
import type { LanguageExtractor } from '../types.js';
import {
  tryLoadParser,
  walk,
  type SyntaxNodeLike,
} from '../tree-sitter-runner.js';

// ---- helpers ----

function nodeName(node: SyntaxNodeLike): string {
  const nameNode = node.childForFieldName('name');
  return nameNode?.text ?? '';
}

function loc(node: SyntaxNodeLike): string {
  return `L${node.startPosition.row + 1}`;
}

// ---- tree-sitter extraction ----

function extractWithTreeSitter(filePath: string, content: string): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const errors: string[] = [];

  const parser = tryLoadParser('rust');
  if (!parser) {
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
  }

  let tree: { rootNode: SyntaxNodeLike };
  try {
    tree = parser.parse(content);
  } catch (err) {
    errors.push(`tree-sitter parse error in ${filePath}: ${String(err)}`);
    return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
  }

  walk(tree.rootNode, (n) => {
    // ---- functions ----
    if (n.type === 'function_item') {
      const name = nodeName(n);
      if (name) {
        nodes.push({
          id: name,
          label: name,
          fileType: 'code',
          sourceFile: filePath,
          sourceLocation: loc(n),
          nodeKind: 'function',
        });
      }
      return;
    }

    // ---- structs ----
    if (n.type === 'struct_item') {
      const name = nodeName(n);
      if (name) {
        nodes.push({
          id: name,
          label: name,
          fileType: 'code',
          sourceFile: filePath,
          sourceLocation: loc(n),
          nodeKind: 'struct',
        });
      }
      return;
    }

    // ---- traits ----
    if (n.type === 'trait_item') {
      const name = nodeName(n);
      if (name) {
        nodes.push({
          id: name,
          label: name,
          fileType: 'code',
          sourceFile: filePath,
          sourceLocation: loc(n),
          nodeKind: 'trait',
        });
      }
      return;
    }

    // ---- impl blocks ----
    if (n.type === 'impl_item') {
      const typeNode = n.childForFieldName('type');
      const traitNode = n.childForFieldName('trait');
      const typeName = typeNode?.text ?? '';

      if (typeName) {
        nodes.push({
          id: typeName,
          label: typeName,
          fileType: 'code',
          sourceFile: filePath,
          sourceLocation: loc(n),
          nodeKind: 'impl',
        });

        // impl Trait for Type
        if (traitNode) {
          edges.push({
            source: typeName,
            target: traitNode.text,
            relation: 'implements',
            confidence: 'EXTRACTED',
            sourceFile: filePath,
            sourceLocation: loc(n),
          });
        }
      }
      return;
    }

    // ---- modules ----
    if (n.type === 'mod_item') {
      const name = nodeName(n);
      if (name) {
        nodes.push({
          id: name,
          label: name,
          fileType: 'code',
          sourceFile: filePath,
          sourceLocation: loc(n),
          nodeKind: 'module',
        });
      }
      return;
    }

    // ---- use declarations ----
    if (n.type === 'use_declaration') {
      const argNode = n.childForFieldName('argument');
      if (argNode) {
        // Flatten the use path to a string (handles use a::b::c and use a::b::{c, d})
        const usePath = argNode.text.replace(/\s+/g, '');
        edges.push({
          source: basename(filePath),
          target: usePath,
          relation: 'imports',
          confidence: 'EXTRACTED',
          sourceFile: filePath,
          sourceLocation: loc(n),
        });
      }
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors };
}

// ---- regex fallback ----

function extractWithRegex(filePath: string, content: string): ExtractionResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const location = `L${idx + 1}`;
    const trimmed = line.trim();

    // pub fn / fn
    const fnMatch = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (fnMatch) {
      nodes.push({ id: fnMatch[1], label: fnMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'function' });
    }

    // pub struct / struct
    const structMatch = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)/);
    if (structMatch) {
      nodes.push({ id: structMatch[1], label: structMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'struct' });
    }

    // pub trait / trait
    const traitMatch = trimmed.match(/^(?:pub\s+)?trait\s+(\w+)/);
    if (traitMatch) {
      nodes.push({ id: traitMatch[1], label: traitMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'trait' });
    }

    // impl Trait for Type
    const implForMatch = trimmed.match(/^impl(?:<[^>]+>)?\s+(\w+)\s+for\s+(\w+)/);
    if (implForMatch) {
      edges.push({ source: implForMatch[2], target: implForMatch[1], relation: 'implements', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
      nodes.push({ id: implForMatch[2], label: implForMatch[2], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'impl' });
    }

    // plain impl Type
    const implMatch = trimmed.match(/^impl(?:<[^>]+>)?\s+(\w+)\s*\{/);
    if (implMatch && !implForMatch) {
      nodes.push({ id: implMatch[1], label: implMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'impl' });
    }

    // use statements
    const useMatch = trimmed.match(/^use\s+([^;]+)/);
    if (useMatch) {
      edges.push({ source: basename(filePath), target: useMatch[1].trim(), relation: 'imports', confidence: 'EXTRACTED', sourceFile: filePath, sourceLocation: location });
    }

    // mod declarations
    const modMatch = trimmed.match(/^(?:pub\s+)?mod\s+(\w+)/);
    if (modMatch) {
      nodes.push({ id: modMatch[1], label: modMatch[1], fileType: 'code', sourceFile: filePath, sourceLocation: location, nodeKind: 'module' });
    }
  });

  return { nodes, edges, filesProcessed: 1, fromCache: 0, errors: [] };
}

// ---- extractor implementation ----

export const rustExtractor: LanguageExtractor = {
  language: 'rust',
  extensions: ['.rs'],

  extract(filePath: string, content: string): ExtractionResult {
    const tsResult = extractWithTreeSitter(filePath, content);
    if (tsResult.nodes.length > 0 || tsResult.edges.length > 0 || tsResult.errors.length > 0) {
      return tsResult;
    }
    return extractWithRegex(filePath, content);
  },
};

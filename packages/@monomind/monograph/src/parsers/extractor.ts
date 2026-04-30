import type Parser from 'tree-sitter';
import type { LanguageConfig } from './language-config.js';
import type { MonographNode, MonographEdge } from '../types.js';
import { makeId, toNormLabel, CONFIDENCE_SCORE } from '../types.js';
import type { ParseResult } from './loader.js';

export function extractSymbols(
  tree: Parser.Tree,
  source: string,
  repoPath: string,
  config: LanguageConfig,
  ext: string,
): ParseResult {
  const nodes: MonographNode[] = [];
  const edges: MonographEdge[] = [];
  const parseErrors: string[] = [];
  const language = config.name;

  function nodeId(name: string, filePath: string, extra?: string): string {
    return makeId(filePath.replace(/\//g, '_'), name, extra ?? '');
  }

  const fileNodeId = makeId(repoPath.replace(/\//g, '_'), 'file');
  nodes.push({
    id: fileNodeId,
    label: 'File',
    name: repoPath.split('/').pop() ?? repoPath,
    normLabel: toNormLabel(repoPath.split('/').pop() ?? repoPath),
    filePath: repoPath,
    isExported: false,
    language,
  });

  function walk(node: Parser.SyntaxNode, parentId?: string): void {
    const { type } = node;

    if (config.importNodeTypes.has(type)) {
      handleImport(node, fileNodeId, source, config, edges, repoPath);
      return;
    }

    const isClass = config.classNodeTypes.has(type);
    const isStruct = config.structNodeTypes.has(type);
    const isEnum = config.enumNodeTypes.has(type);
    const isFunction = config.functionNodeTypes.has(type);
    const isMethod = config.methodNodeTypes.has(type);
    const isInterface = config.interfaceNodeTypes.has(type);
    const isConstructor = config.constructorNodeTypes.has(type);

    if (isClass || isStruct || isEnum || isFunction || isMethod || isInterface || isConstructor) {
      const nameNode = node.childForFieldName(config.nameField);
      const name = nameNode?.text ?? node.text.split('\n')[0].slice(0, 40);
      // When a node type is in BOTH functionNodeTypes and methodNodeTypes (e.g. Python
      // `function_definition`), check parent chain to disambiguate: a function_definition
      // whose grandparent is a class_definition is a method, otherwise it's a function.
      const isBothFunctionAndMethod = isFunction && isMethod;
      const isActuallyMethod = isBothFunctionAndMethod
        ? config.classNodeTypes.has(node.parent?.parent?.type ?? '')
        : isMethod;
      const label = isClass ? 'Class' : isStruct ? 'Struct' : isEnum ? 'Enum' :
                    isInterface ? 'Interface' : isActuallyMethod ? 'Method' :
                    isConstructor ? 'Constructor' : 'Function';
      const id = nodeId(name, repoPath, label.toLowerCase());
      const isExported = config.exportDetector
        ? config.exportDetector(node, source)
        : isNodeExported(node, source);

      nodes.push({
        id, label, name,
        normLabel: toNormLabel(name),
        filePath: repoPath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExported, language,
      });

      const containerId = parentId ?? fileNodeId;
      edges.push({
        id: makeId(containerId, id, 'contains'),
        sourceId: containerId, targetId: id,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
      });

      handleInheritance(node, id, edges, repoPath, config, source);

      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!, id);
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i)!, parentId);
    }
  }

  walk(tree.rootNode);
  return { nodes, edges, parseErrors };
}

function isNodeExported(node: Parser.SyntaxNode, _source: string): boolean {
  const parent = node.parent;
  if (!parent) return false;
  return parent.type === 'export_statement' ||
    parent.type === 'export_default_declaration';
}

function handleImport(
  node: Parser.SyntaxNode,
  fileNodeId: string,
  source: string,
  config: LanguageConfig,
  edges: MonographEdge[],
  repoPath: string,
): void {
  const targetPath = config.importExtractor ? config.importExtractor(source, node) : null;
  const targetId = makeId('import', targetPath ?? node.text.slice(0, 60));
  edges.push({
    id: makeId(fileNodeId, targetId, 'imports'),
    sourceId: fileNodeId, targetId,
    relation: 'IMPORTS',
    confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
  });
}

function handleInheritance(
  node: Parser.SyntaxNode,
  nodeId: string,
  edges: MonographEdge[],
  _repoPath: string,
  _config: LanguageConfig,
  _source: string,
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === 'extends_clause') {
      const targetId = makeId('import', child.text.replace(/extends?\s+/, '').trim());
      edges.push({
        id: makeId(nodeId, targetId, 'extends'),
        sourceId: nodeId, targetId,
        relation: 'EXTENDS',
        confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
      });
    }
    if (child.type === 'implements_clause') {
      const targetId = makeId('import', child.text.replace(/implements\s+/, '').trim());
      edges.push({
        id: makeId(nodeId, targetId, 'implements'),
        sourceId: nodeId, targetId,
        relation: 'IMPLEMENTS',
        confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
      });
    }
    // class_heritage is the direct child; implements_clause is nested inside it
    if (child.type === 'class_heritage') {
      for (let j = 0; j < child.childCount; j++) {
        const grandChild = child.child(j)!;
        if (grandChild.type === 'extends_clause') {
          const targetId = makeId('import', grandChild.text.replace(/extends?\s+/, '').trim());
          edges.push({
            id: makeId(nodeId, targetId, 'extends'),
            sourceId: nodeId, targetId,
            relation: 'EXTENDS',
            confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
          });
        }
        if (grandChild.type === 'implements_clause') {
          const targetId = makeId('import', grandChild.text.replace(/implements\s+/, '').trim());
          edges.push({
            id: makeId(nodeId, targetId, 'implements'),
            sourceId: nodeId, targetId,
            relation: 'IMPLEMENTS',
            confidence: 'EXTRACTED', confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
          });
        }
      }
    }
  }
}

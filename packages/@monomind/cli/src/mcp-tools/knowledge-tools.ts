/**
 * MCP Knowledge Tools — Second Brain document ingest and search
 */

import type { MCPTool, MCPToolResult } from './types.js';

const knowledgeIngest: MCPTool = {
  name: 'knowledge_ingest',
  description: 'Ingest documents into the Second Brain knowledge base. Accepts a file or directory path. Extracts text, chunks, embeds, and stores in LanceDB for semantic search.',
  category: 'knowledge',
  tags: ['documents', 'ingest', 'second-brain'],
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory path to ingest' },
      scope: { type: 'string', description: 'Knowledge scope (default: shared)' },
    },
    required: ['path'],
  },
  handler: async (input): Promise<MCPToolResult> => {
    const { ingestDocument, ingestDirectory } = await import('../knowledge/document-pipeline.js');
    const fs = await import('node:fs');
    const pathMod = await import('node:path');

    const target = pathMod.resolve(String(input.path));
    const scope = String(input.scope || 'shared');

    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        const result = await ingestDirectory(target, scope);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              filesProcessed: result.filesProcessed,
              filesSkipped: result.filesSkipped,
              totalChunks: result.totalChunks,
              errors: result.errors,
            }),
          }],
        };
      } else {
        const result = await ingestDocument(target, scope);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: !result.error || result.skipped,
              filePath: result.filePath,
              chunksIndexed: result.chunksIndexed,
              skipped: result.skipped,
              error: result.error,
            }),
          }],
        };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: String(err) }) }],
        isError: true,
      };
    }
  },
};

const knowledgeSearch: MCPTool = {
  name: 'knowledge_search',
  description: 'Semantic search over the Second Brain knowledge base. Returns relevant document excerpts ranked by similarity.',
  category: 'knowledge',
  tags: ['documents', 'search', 'second-brain', 'rag'],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      scope: { type: 'string', description: 'Knowledge scope (default: shared)' },
      limit: { type: 'number', description: 'Max results (default: 10)' },
      minScore: { type: 'number', description: 'Minimum similarity threshold (default: 0.3)' },
    },
    required: ['query'],
  },
  handler: async (input): Promise<MCPToolResult> => {
    const { searchKnowledge } = await import('../knowledge/document-pipeline.js');

    try {
      const excerpts = await searchKnowledge(String(input.query), {
        scope: input.scope ? String(input.scope) : undefined,
        limit: input.limit ? Number(input.limit) : undefined,
        minScore: input.minScore ? Number(input.minScore) : undefined,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, count: excerpts.length, excerpts }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: String(err) }) }],
        isError: true,
      };
    }
  },
};

export const knowledgeTools: MCPTool[] = [knowledgeIngest, knowledgeSearch];

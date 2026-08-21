/**
 * Memory CRUD Commands
 * store, retrieve, search
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { input } from '../prompt.js';

// Store command
export const storeCommand: Command = {
  name: 'store',
  description: 'Store data in memory',
  options: [
    {
      name: 'key',
      short: 'k',
      description: 'Storage key/namespace',
      type: 'string',
      required: true
    },
    {
      name: 'value',
      // Note: No short flag - global -v is reserved for verbose
      description: 'Value to store (use --value)',
      type: 'string'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Memory namespace',
      type: 'string',
      default: 'default'
    },
    {
      name: 'ttl',
      description: 'Time to live in seconds',
      type: 'number'
    },
    {
      name: 'tags',
      description: 'Comma-separated tags',
      type: 'string'
    },
    {
      name: 'vector',
      description: 'Store as vector embedding',
      type: 'boolean',
      default: false
    },
    {
      name: 'upsert',
      short: 'u',
      description: 'Update if key exists (insert or replace)',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind memory store -k "api/auth" -v "JWT implementation"', description: 'Store text' },
    { command: 'monomind memory store -k "pattern/singleton" --vector', description: 'Store vector' },
    { command: 'monomind memory store -k "pattern" -v "updated" --upsert', description: 'Update existing' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = ctx.flags.key as string;
    let value = ctx.flags.value as string || ctx.args[0];
    const namespace = (ctx.flags.namespace as string) || 'default';
    const ttl = ctx.flags.ttl as number;
    const tags = ctx.flags.tags ? (ctx.flags.tags as string).split(',') : [];
    const asVector = ctx.flags.vector as boolean;
    const upsert = ctx.flags.upsert as boolean;

    if (!key) {
      output.printError('Key is required. Use --key or -k');
      return { success: false, exitCode: 1 };
    }

    if (!value && ctx.interactive) {
      value = await input({
        message: 'Enter value to store:',
        validate: (v) => v.length > 0 || 'Value is required'
      });
    }

    if (!value) {
      output.printError('Value is required. Use --value');
      return { success: false, exitCode: 1 };
    }

    const storeData = {
      key,
      namespace,
      value,
      ttl,
      tags,
      asVector,
      storedAt: new Date().toISOString(),
      size: Buffer.byteLength(value, 'utf8')
    };

    output.printInfo(`Storing in ${namespace}/${key}...`);

    // Use direct sql.js storage with automatic embedding generation
    try {
      const { storeEntry } = await import('../memory/memory-initializer.js');

      if (asVector) {
        output.writeln(output.dim('  Generating embedding vector...'));
      }

      const result = await storeEntry({
        key,
        value,
        namespace,
        generateEmbeddingFlag: true, // Always generate embeddings for semantic search
        tags,
        ttl,
        upsert
      });

      if (!result.success) {
        output.printError(result.error || 'Failed to store');
        return { success: false, exitCode: 1 };
      }

      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'val', header: 'Value', width: 40 }
        ],
        data: [
          { property: 'Key', val: key },
          { property: 'Namespace', val: namespace },
          { property: 'Size', val: `${storeData.size} bytes` },
          { property: 'TTL', val: ttl ? `${ttl}s` : 'None' },
          { property: 'Tags', val: tags.length > 0 ? tags.join(', ') : 'None' },
          { property: 'Vector', val: result.embedding ? `Yes (${result.embedding.dimensions}-dim)` : 'No' },
          { property: 'ID', val: result.id.substring(0, 20) }
        ]
      });

      output.writeln();
      output.printSuccess('Data stored successfully');

      return { success: true, data: { ...storeData, id: result.id, embedding: result.embedding } };
    } catch (error) {
      output.printError(`Failed to store: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Retrieve command
export const retrieveCommand: Command = {
  name: 'retrieve',
  aliases: ['get'],
  description: 'Retrieve data from memory',
  options: [
    {
      name: 'key',
      short: 'k',
      description: 'Storage key',
      type: 'string'
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Memory namespace',
      type: 'string',
      default: 'default'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = ctx.flags.key as string || ctx.args[0];
    const namespace = ctx.flags.namespace as string;

    if (!key) {
      output.printError('Key is required');
      return { success: false, exitCode: 1 };
    }

    // Use sql.js directly for consistent data access
    try {
      const { getEntry } = await import('../memory/memory-initializer.js');
      const result = await getEntry({ key, namespace });

      if (!result.success) {
        output.printError(`Failed to retrieve: ${result.error}`);
        return { success: false, exitCode: 1 };
      }

      if (!result.found || !result.entry) {
        output.printWarning(`Key not found: ${key}`);
        return { success: false, exitCode: 1, data: { key, found: false } };
      }

      const entry = result.entry;

      if (ctx.flags.format === 'json') {
        output.printJson(entry);
        return { success: true, data: entry };
      }

      output.writeln();
      output.printBox(
        [
          `Namespace: ${entry.namespace}`,
          `Key: ${entry.key}`,
          `Size: ${entry.content.length} bytes`,
          `Access Count: ${entry.accessCount}`,
          `Tags: ${entry.tags.length > 0 ? entry.tags.join(', ') : 'None'}`,
          `Vector: ${entry.hasEmbedding ? 'Yes' : 'No'}`,
          '',
          output.bold('Value:'),
          entry.content
        ].join('\n'),
        'Memory Entry'
      );

      return { success: true, data: entry };
    } catch (error) {
      output.printError(`Failed to retrieve: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Search command
export const searchCommand: Command = {
  name: 'search',
  description: 'Search memory with semantic/vector search',
  options: [
    {
      name: 'query',
      short: 'q',
      description: 'Search query',
      type: 'string',
      required: true
    },
    {
      name: 'namespace',
      short: 'n',
      description: 'Memory namespace',
      type: 'string'
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum results',
      type: 'number',
      default: 10
    },
    {
      name: 'threshold',
      description: 'Similarity threshold (0-1)',
      type: 'number',
      default: 0.7
    },
    {
      name: 'type',
      short: 't',
      description: 'Search type (semantic, keyword, hybrid)',
      type: 'string',
      default: 'semantic',
      choices: ['semantic', 'keyword', 'hybrid']
    },
    {
      name: 'build-hnsw',
      description: 'Force-build the HNSW ANN index against the current memory database, regardless of MONOMIND_HNSW_THRESHOLD, and cache it to disk. search() itself only uses this index automatically once the active embedded-entry count crosses the threshold — below it, brute-force cosine stays the search path. Requires the SQLite bridge to be available.',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind memory search -q "authentication patterns"', description: 'Semantic search' },
    { command: 'monomind memory search -q "JWT" -t keyword', description: 'Keyword search' },
    { command: 'monomind memory search -q "test" --build-hnsw', description: 'Pre-build and cache the HNSW ANN index' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = ctx.flags.query as string || ctx.args[0];
    const namespace = ctx.flags.namespace as string || 'all';
    const limit = ctx.flags.limit as number || 10;
    const threshold = ctx.flags.threshold as number || 0.3;
    const searchType = ctx.flags.type as string || 'semantic';
    const buildHnsw = (ctx.flags['build-hnsw'] || ctx.flags.buildHnsw) as boolean;

    if (!query) {
      output.printError('Query is required. Use --query or -q');
      return { success: false, exitCode: 1 };
    }

    if (buildHnsw) {
      output.printInfo('Building HNSW ANN index...');
      try {
        const { bridgeForceBuildHNSW, bridgeGetHNSWStatus } = await import('../memory/memory-bridge.js');

        const startTime = Date.now();
        const built = await bridgeForceBuildHNSW();
        const buildTime = Date.now() - startTime;

        if (built) {
          const status = await bridgeGetHNSWStatus();
          output.printSuccess(`HNSW index built (${built.entryCount} vectors, ${buildTime}ms)`);
          output.writeln(output.dim(`  Dimensions: ${built.dimensions}, Metric: cosine`));
          if (built.cachePath) {
            output.writeln(output.dim(`  Cached to: ${built.cachePath}`));
          }
          if (status && status.activeEmbeddedEntries < status.thresholdEntries) {
            output.writeln(output.dim(`  Note: ${status.activeEmbeddedEntries} active embedded entries is below the ${status.thresholdEntries}-entry threshold — the search below still uses brute-force cosine (which is faster at this scale). This index is cached but won't be used automatically until the corpus grows past the threshold.`));
          }
        } else {
          output.printWarning('HNSW index not available — the SQLite bridge could not be reached');
        }
        output.writeln();
      } catch (error) {
        output.printWarning(`HNSW build failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        output.writeln(output.dim('  Falling back to brute-force search'));
        output.writeln();
      }
    }

    // Requested type only — the method that ACTUALLY ran is printed after the
    // search, from searchResult.searchMethod. Labelling this line "(semantic)"
    // used to claim a vector search that may never have happened.
    output.printInfo(`Searching: "${query}" (requested: ${searchType})`);
    output.writeln();

    // Use direct sql.js search with vector similarity
    try {
      const { searchEntries } = await import('../memory/memory-initializer.js');

      const searchResult = await searchEntries({
        query,
        namespace,
        limit,
        threshold
      });

      if (!searchResult.success) {
        output.printError(searchResult.error || 'Search failed');
        return { success: false, exitCode: 1 };
      }

      const results = searchResult.results.map(r => ({
        key: r.key,
        score: r.score,
        namespace: r.namespace,
        preview: r.content
      }));

      const actualMethod = searchResult.searchMethod ?? 'unknown';
      const fallbackReason = searchResult.fallbackReason;

      // `--type` is not (yet) threaded through to the backend — it cannot force
      // which search path runs. So the honest thing is to compare what was
      // requested against what actually ran and say so when they diverge,
      // rather than let the flag look like it did something it didn't.
      const METHOD_FAMILY: Record<string, 'semantic' | 'hybrid' | 'keyword' | 'unknown'> = {
        semantic: 'semantic',
        hybrid: 'hybrid',
        keyword: 'keyword',
        'keyword-fallback': 'keyword',
        'hash-vector': 'semantic',
        'hash-hybrid': 'hybrid',
        unknown: 'unknown',
      };
      const actualFamily = METHOD_FAMILY[actualMethod] ?? 'unknown';
      const typeMismatch = actualFamily !== 'unknown' && actualFamily !== searchType;

      if (ctx.flags.format === 'json') {
        output.printJson({
          query,
          searchType,
          searchMethod: actualMethod,
          ...(typeMismatch ? { requestedTypeHonored: false } : {}),
          ...(fallbackReason ? { fallbackReason } : {}),
          results,
          searchTime: `${searchResult.searchTime}ms`,
        });
        return { success: true, data: results };
      }

      if (typeMismatch) {
        output.printWarning(`Requested --type ${searchType} but the backend used method "${actualMethod}" instead.`);
      }

      // Performance stats — method first, so a keyword fallback is never hidden
      // behind a "(semantic)" header.
      const REASON_TEXT: Record<string, string> = {
        'no-embedding-model': 'embedding model unavailable',
        'empty-query': 'query was empty, so no vector could be built',
        'embedding-failed': 'embedding generation failed',
        'no-semantic-matches': 'vector search returned no matches',
      };
      const why = fallbackReason ? REASON_TEXT[fallbackReason] ?? fallbackReason : undefined;
      if (actualMethod === 'semantic') {
        output.writeln(output.dim('  Method: semantic (vector similarity)'));
      } else if (actualMethod === 'hybrid') {
        output.writeln(output.dim('  Method: hybrid (per-entry cosine, keyword overlap where no vector exists)'));
      } else if (actualMethod === 'hash-vector' || actualMethod === 'hash-hybrid') {
        // A vector search did run, but over hash-fallback embeddings — the
        // scores are cosines of a lexical hash, not of a semantic model.
        output.printWarning(
          `Method: ${actualMethod}${why ? ` — ${why}` : ''}. Scores are cosines over deterministic hash embeddings, not semantic similarity.`
        );
      } else if (actualMethod === 'unknown') {
        output.writeln(output.dim('  Method: unknown'));
      } else {
        output.printWarning(
          `Method: ${actualMethod}${why ? ` — ${why}` : ''}. Scores are token-overlap fractions, not vector similarity.`
        );
      }
      output.writeln(output.dim(`  Search time: ${searchResult.searchTime}ms`));
      output.writeln();

      if (results.length === 0) {
        output.printWarning('No results found');
        output.writeln(output.dim('Try: monomind memory store -k "key" --value "data"'));
        return { success: true, data: [] };
      }

      output.printTable({
        columns: [
          { key: 'key', header: 'Key', width: 20 },
          { key: 'score', header: 'Score', width: 8, align: 'right', format: (v) => Number(v).toFixed(2) },
          { key: 'namespace', header: 'Namespace', width: 12 },
          { key: 'preview', header: 'Preview', width: 35 }
        ],
        data: results
      });

      output.writeln();
      output.printInfo(`Found ${results.length} results`);

      return { success: true, data: results };
    } catch (error) {
      output.printError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false, exitCode: 1 };
    }
  }
};

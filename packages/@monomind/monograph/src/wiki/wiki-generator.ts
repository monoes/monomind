import type { MonographDb } from '../storage/db.js';
import { buildWikiPrompt } from './prompt-builder.js';
import { upsertWikiPage, getWikiPage, listWikiPages } from './wiki-store.js';
import { callLLM, type LLMConfig } from './providers.js';

export type { LLMConfig } from './providers.js';
export type { LLMProvider, LLMResponse } from './providers.js';

export interface WikiGeneratorOptions {
  repoPath: string;
  reviewOnly?: boolean;
  db?: MonographDb;
}

export interface WikiGeneratorResult {
  reviewMode?: boolean;
  proposedGroupings?: unknown[];
  pages: string[];
  pageCount: number;
}

/**
 * Top-level wiki generation entry point.
 * When reviewOnly is true, returns proposed community groupings without generating pages.
 */
export async function generateWiki(options: WikiGeneratorOptions): Promise<WikiGeneratorResult> {
  const db = options.db;

  // Collect community groupings from DB (if available)
  let groupings: unknown[] = [];
  if (db) {
    try {
      const rows = db.prepare('SELECT DISTINCT community_id FROM nodes WHERE community_id IS NOT NULL').all();
      groupings = rows as unknown[];
    } catch {
      groupings = [];
    }
  }

  if (options.reviewOnly) {
    return {
      reviewMode: true,
      proposedGroupings: groupings,
      pages: [],
      pageCount: 0,
    };
  }

  // Full generation path
  if (!db) {
    return { pages: [], pageCount: 0 };
  }

  const result = await generateAllWikiPages(db);
  return {
    pages: [],
    pageCount: result.generated,
  };
}

export interface LlmClient {
  generate: (prompt: string) => Promise<string>;
}

export interface GenerateWikiPageOptions {
  model?: string;
  apiKey?: string;
  /** Inject a test client instead of calling Anthropic API */
  llmClient?: LlmClient;
  /** Use a multi-provider LLM config instead of the default Anthropic SDK */
  llmConfig?: LLMConfig;
}

export interface GenerateAllWikiPagesOptions {
  force?: boolean;
  model?: string;
  communityId?: string;
  llmClient?: LlmClient;
  /** Use a multi-provider LLM config instead of the default Anthropic SDK */
  llmConfig?: LLMConfig;
}

export interface GenerateAllResult {
  generated: number;
  skipped: number;
  errors: number;
}

/**
 * Generate a wiki page for a single community using the LLM.
 * Returns the generated markdown content and persists it to the DB.
 */
export async function generateWikiPage(
  db: MonographDb,
  communityId: string,
  options?: GenerateWikiPageOptions,
): Promise<string> {
  const communityIdStr = String(communityId);

  // 1. Get community label
  const commRow = db.prepare('SELECT id, label FROM communities WHERE id = ?')
    .get(Number(communityIdStr)) as { id: number; label: string | null } | undefined;
  const label = commRow?.label ?? `Community ${communityIdStr}`;

  // 2. Get top 5 symbols by degree (count of connected edges, since no centrality column)
  const symbolRows = db.prepare(`
    SELECT n.name, n.label, n.file_path,
           COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) AS degree
    FROM nodes n
    LEFT JOIN edges e1 ON e1.source_id = n.id
    LEFT JOIN edges e2 ON e2.target_id = n.id
    WHERE n.community_id = ?
    GROUP BY n.id
    ORDER BY degree DESC, n.name ASC
    LIMIT 5
  `).all(Number(communityIdStr)) as { name: string; label: string; file_path: string | null }[];

  // 3. Count incoming edges to community (edges whose target is in this community)
  const incomingRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM edges
    WHERE target_id IN (SELECT id FROM nodes WHERE community_id = ?)
  `).get(Number(communityIdStr)) as { cnt: number };

  // 4. Count outgoing edges from community (edges whose source is in this community)
  const outgoingRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM edges
    WHERE source_id IN (SELECT id FROM nodes WHERE community_id = ?)
  `).get(Number(communityIdStr)) as { cnt: number };

  // 5. Build prompt
  const prompt = buildWikiPrompt({
    communityId: communityIdStr,
    label,
    topSymbols: symbolRows.map(r => ({ name: r.name, label: r.label, filePath: r.file_path })),
    incomingCount: incomingRow.cnt,
    outgoingCount: outgoingRow.cnt,
  });

  // 6. Call LLM (injected client, multi-provider config, or Anthropic SDK)
  let content: string;

  if (options?.llmClient) {
    content = await options.llmClient.generate(prompt);
  } else if (options?.llmConfig) {
    const result = await callLLM(prompt, options.llmConfig);
    content = result.text;
  } else {
    const apiKey = options?.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set');
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: options?.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    content = (block?.type === 'text') ? block.text : '';
  }

  // 7. Persist to DB — prepend OKF frontmatter if not already present
  if (!content.startsWith('---')) {
    const safeLabel = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    content = `---\ntype: Code Community Wiki\ntitle: "${safeLabel}"\ntags: [monograph, wiki]\ntimestamp: ${new Date().toISOString()}\n---\n\n${content}`;
  }
  upsertWikiPage(db, communityIdStr, content);

  return content;
}

/**
 * Generate wiki pages for all (or a filtered) communities.
 */
export async function generateAllWikiPages(
  db: MonographDb,
  options?: GenerateAllWikiPagesOptions,
): Promise<GenerateAllResult> {
  // Get all distinct community_ids from nodes
  let communityRows: { community_id: number }[];

  if (options?.communityId != null) {
    communityRows = [{ community_id: Number(options.communityId) }];
  } else {
    communityRows = db.prepare(
      'SELECT DISTINCT community_id FROM nodes WHERE community_id IS NOT NULL',
    ).all() as { community_id: number }[];
  }

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of communityRows) {
    const communityIdStr = String(row.community_id);

    // Skip if already generated and force is not set
    if (!options?.force) {
      const existing = getWikiPage(db, communityIdStr);
      if (existing) {
        skipped++;
        continue;
      }
    }

    try {
      await generateWikiPage(db, communityIdStr, {
        model: options?.model,
        llmClient: options?.llmClient,
        llmConfig: options?.llmConfig,
      });
      generated++;
    } catch {
      errors++;
    }
  }

  return { generated, skipped, errors };
}

export { upsertWikiPage, getWikiPage, listWikiPages };

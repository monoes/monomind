import { buildWikiPrompt } from './prompt-builder.js';
import { upsertWikiPage, getWikiPage, listWikiPages } from './wiki-store.js';
import { callLLM } from './providers.js';
/**
 * Top-level wiki generation entry point.
 * When reviewOnly is true, returns proposed community groupings without generating pages.
 */
export async function generateWiki(options) {
    const db = options.db;
    // Collect community groupings from DB (if available)
    let groupings = [];
    if (db) {
        try {
            const rows = db.prepare('SELECT DISTINCT community_id FROM nodes WHERE community_id IS NOT NULL').all();
            groupings = rows;
        }
        catch {
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
/**
 * Generate a wiki page for a single community using the LLM.
 * Returns the generated markdown content and persists it to the DB.
 */
export async function generateWikiPage(db, communityId, options) {
    const communityIdStr = String(communityId);
    // 1. Get community label
    const commRow = db.prepare('SELECT id, label FROM communities WHERE id = ?')
        .get(Number(communityIdStr));
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
  `).all(Number(communityIdStr));
    // 3. Count incoming edges to community (edges whose target is in this community)
    const incomingRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM edges
    WHERE target_id IN (SELECT id FROM nodes WHERE community_id = ?)
  `).get(Number(communityIdStr));
    // 4. Count outgoing edges from community (edges whose source is in this community)
    const outgoingRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM edges
    WHERE source_id IN (SELECT id FROM nodes WHERE community_id = ?)
  `).get(Number(communityIdStr));
    // 5. Build prompt
    const prompt = buildWikiPrompt({
        communityId: communityIdStr,
        label,
        topSymbols: symbolRows.map(r => ({ name: r.name, label: r.label, filePath: r.file_path })),
        incomingCount: incomingRow.cnt,
        outgoingCount: outgoingRow.cnt,
    });
    // 6. Call LLM (injected client, multi-provider config, or Anthropic SDK)
    let content;
    if (options?.llmClient) {
        content = await options.llmClient.generate(prompt);
    }
    else if (options?.llmConfig) {
        const result = await callLLM(prompt, options.llmConfig);
        content = result.text;
    }
    else {
        const { claudeCliCall, isClaudeCliAvailable } = await import('../claude-cli.js');
        if (!isClaudeCliAvailable()) {
            throw new Error('Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
        }
        content = await claudeCliCall(prompt);
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
export async function generateAllWikiPages(db, options) {
    // Get all distinct community_ids from nodes
    let communityRows;
    if (options?.communityId != null) {
        communityRows = [{ community_id: Number(options.communityId) }];
    }
    else {
        communityRows = db.prepare('SELECT DISTINCT community_id FROM nodes WHERE community_id IS NOT NULL').all();
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
        }
        catch {
            errors++;
        }
    }
    return { generated, skipped, errors };
}
export { upsertWikiPage, getWikiPage, listWikiPages };
//# sourceMappingURL=wiki-generator.js.map
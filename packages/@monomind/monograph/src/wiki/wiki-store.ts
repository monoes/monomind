import type { MonographDb } from '../storage/db.js';

export interface WikiPage {
  communityId: string;
  content: string;
  generatedAt: string;
}

/**
 * Upsert a wiki page for a community.
 * community_id is stored as TEXT (coerced from integer community_id in nodes).
 */
export function upsertWikiPage(db: MonographDb, communityId: string, content: string): void {
  const generatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO wiki_pages (community_id, content, generated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(community_id) DO UPDATE SET content = excluded.content, generated_at = excluded.generated_at
  `).run(String(communityId), content, generatedAt);
}

/**
 * Get a single wiki page by community ID.
 */
export function getWikiPage(db: MonographDb, communityId: string): WikiPage | null {
  const row = db.prepare('SELECT community_id, content, generated_at FROM wiki_pages WHERE community_id = ?')
    .get(String(communityId)) as { community_id: string; content: string; generated_at: string } | undefined;

  if (!row) return null;
  return {
    communityId: row.community_id,
    content: row.content,
    generatedAt: row.generated_at,
  };
}

/**
 * List all wiki pages.
 */
export function listWikiPages(db: MonographDb): WikiPage[] {
  const rows = db.prepare('SELECT community_id, content, generated_at FROM wiki_pages ORDER BY community_id')
    .all() as { community_id: string; content: string; generated_at: string }[];

  return rows.map(row => ({
    communityId: row.community_id,
    content: row.content,
    generatedAt: row.generated_at,
  }));
}

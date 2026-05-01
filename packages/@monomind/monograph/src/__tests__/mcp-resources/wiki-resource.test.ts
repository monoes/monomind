import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { wikiResource, wikiPageResource } from '../../mcp-resources/wiki-resource.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE wiki_pages (
      community_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
    INSERT INTO wiki_pages VALUES ('1', '# Auth cluster\nHandles user authentication.', '2026-05-01T00:00:00Z');
    INSERT INTO wiki_pages VALUES ('2', '# Data cluster\nManages database access.', '2026-05-01T00:00:00Z');
  `);
  return db;
}

describe('wikiResource (list)', () => {
  it('has correct URI and name', () => {
    expect(wikiResource.uri).toBe('monograph://wiki');
    expect(wikiResource.name).toBe('wiki');
  });

  it('handler returns all wiki pages', () => {
    const db = makeDb();
    const result = wikiResource.handler(db) as any[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].communityId).toBeDefined();
    expect(result[0].content).toBeDefined();
  });
});

describe('wikiPageResource (single)', () => {
  it('has URI with {communityId} template', () => {
    expect(wikiPageResource.uri).toContain('{communityId}');
  });

  it('returns a single wiki page by communityId', () => {
    const db = makeDb();
    const result = wikiPageResource.handler(db, { communityId: '1' }) as any;
    expect(result).not.toBeNull();
    expect(result.content).toContain('Auth cluster');
  });

  it('returns null for unknown communityId', () => {
    const db = makeDb();
    const result = wikiPageResource.handler(db, { communityId: '999' });
    expect(result).toBeNull();
  });
});

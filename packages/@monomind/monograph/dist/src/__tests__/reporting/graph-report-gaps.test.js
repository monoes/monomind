import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { generateGraphReport } from '../../reporting/graph-report.js';
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL,
      norm_label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER,
      community_id INTEGER, is_exported INTEGER DEFAULT 0, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
      relation TEXT NOT NULL, confidence TEXT DEFAULT 'EXTRACTED', confidence_score REAL DEFAULT 1.0, properties TEXT);
  `);
    // 2 isolated nodes (no edges)
    db.prepare(`INSERT INTO nodes VALUES ('iso1','Function','orphan1',null,'/a.ts',1,5,99,1,null,null)`).run();
    db.prepare(`INSERT INTO nodes VALUES ('iso2','Function','orphan2',null,'/b.ts',1,3,99,1,null,null)`).run();
    // thin community: only 1 node
    db.prepare(`INSERT INTO nodes VALUES ('thin1','Function','alone',null,'/c.ts',1,3,7,1,null,null)`).run();
    // normal connected nodes
    db.prepare(`INSERT INTO nodes VALUES ('n1','Function','foo',null,'/d.ts',1,5,1,1,null,null)`).run();
    db.prepare(`INSERT INTO nodes VALUES ('n2','Function','bar',null,'/e.ts',1,3,1,1,null,null)`).run();
    db.prepare(`INSERT INTO edges VALUES ('e1','n1','n2','CALLS','AMBIGUOUS',0.1,null)`).run();
    return db;
}
describe('graph report knowledge gap section', () => {
    it('includes knowledge gap heading', () => {
        const r = generateGraphReport(makeDb(), '/tmp');
        expect(r.markdown).toMatch(/knowledge.gap|Knowledge Gap/i);
    });
    it('reports isolated nodes', () => {
        const r = generateGraphReport(makeDb(), '/tmp');
        expect(r.markdown).toMatch(/isolated|orphan/i);
    });
    it('reports thin communities', () => {
        const r = generateGraphReport(makeDb(), '/tmp');
        expect(r.markdown).toMatch(/thin|small.*communit/i);
    });
});
//# sourceMappingURL=graph-report-gaps.test.js.map
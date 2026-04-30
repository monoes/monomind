export const CREATE_NODES = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  norm_label TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  community_id INTEGER,
  is_exported INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  properties TEXT
)`;

export const CREATE_EDGES = `
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'EXTRACTED',
  confidence_score REAL NOT NULL DEFAULT 1.0,
  FOREIGN KEY (source_id) REFERENCES nodes(id),
  FOREIGN KEY (target_id) REFERENCES nodes(id)
)`;

export const CREATE_COMMUNITIES = `
CREATE TABLE IF NOT EXISTS communities (
  id INTEGER PRIMARY KEY,
  label TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  cohesion_score REAL NOT NULL DEFAULT 0.0
)`;

export const CREATE_INDEX_META = `
CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

export const CREATE_NODES_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id UNINDEXED,
  name,
  norm_label,
  file_path,
  label UNINDEXED,
  content='nodes',
  content_rowid='rowid'
)`;

export const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_norm ON nodes(norm_label)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_confidence ON edges(confidence)`,
];

export const FTS_SYNC_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, id, name, norm_label, file_path, label)
  VALUES (new.rowid, new.id, new.name, new.norm_label, new.file_path, new.label);
END;
CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, id, name, norm_label, file_path, label)
  VALUES ('delete', old.rowid, old.id, old.name, old.norm_label, old.file_path, old.label);
END;
CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, id, name, norm_label, file_path, label)
  VALUES ('delete', old.rowid, old.id, old.name, old.norm_label, old.file_path, old.label);
  INSERT INTO nodes_fts(rowid, id, name, norm_label, file_path, label)
  VALUES (new.rowid, new.id, new.name, new.norm_label, new.file_path, new.label);
END`;

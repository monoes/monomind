/**
 * Memory Schema
 * SQL schema for the Monomind memory database.
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/memory-schema
 */

/**
 * Enhanced schema with pattern confidence, temporal decay, versioning
 * Vector embeddings enabled for semantic search
 */
export const MEMORY_SCHEMA = `
-- Monomind Memory Database
-- Version: 3.0.0
-- Features: Pattern learning, vector embeddings, temporal decay, migration tracking

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ============================================
-- CORE MEMORY TABLES
-- ============================================

-- Memory entries (main storage)
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'semantic',
  embedding TEXT,
  embedding_model TEXT DEFAULT 'local',
  embedding_dimensions INTEGER,
  confidence REAL DEFAULT 1.0,
  decay_rate REAL DEFAULT 0.01,
  importance_score REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  last_accessed_at INTEGER,
  expires_at INTEGER,
  tags TEXT,
  metadata TEXT,
  owner_id TEXT,
  agent_id TEXT,
  session_id TEXT,
  status TEXT DEFAULT 'active',
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_entries(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(key);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_entries(status);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_accessed ON memory_entries(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_memory_owner ON memory_entries(owner_id);

-- Pattern learning tables
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'task-routing',
  condition TEXT NOT NULL,
  action TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  decay_rate REAL DEFAULT 0.05,
  last_matched_at INTEGER,
  status TEXT DEFAULT 'active',
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence);
CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
CREATE INDEX IF NOT EXISTS idx_patterns_last_matched ON patterns(last_matched_at);

-- Pattern history for temporal analysis
CREATE TABLE IF NOT EXISTS pattern_history (
  id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  confidence_before REAL,
  confidence_after REAL,
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_pattern_history_pattern ON pattern_history(pattern_id);

-- Trajectory recording for learning
CREATE TABLE IF NOT EXISTS trajectories (
  id TEXT PRIMARY KEY,
  task_description TEXT NOT NULL,
  agent_type TEXT,
  success BOOLEAN DEFAULT FALSE,
  total_steps INTEGER DEFAULT 0,
  duration_ms INTEGER,
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  completed_at INTEGER
);

-- Trajectory steps
CREATE TABLE IF NOT EXISTS trajectory_steps (
  id TEXT PRIMARY KEY,
  trajectory_id TEXT NOT NULL REFERENCES trajectories(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  result TEXT,
  success BOOLEAN,
  duration_ms INTEGER,
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_steps_trajectory ON trajectory_steps(trajectory_id);

-- Migration state tracking
CREATE TABLE IF NOT EXISTS migration_state (
  id TEXT PRIMARY KEY,
  migration_type TEXT NOT NULL,
  source_path TEXT,
  target_path TEXT,
  status TEXT DEFAULT 'pending',
  entries_migrated INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Session management
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  metadata TEXT,
  status TEXT DEFAULT 'active',
  started_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  ended_at INTEGER,
  summary TEXT
);

-- Vector index configuration
CREATE TABLE IF NOT EXISTS vector_indexes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dimensions INTEGER NOT NULL DEFAULT 384,
  hnsw_m INTEGER DEFAULT 16,
  hnsw_ef_construction INTEGER DEFAULT 200,
  entry_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
`;

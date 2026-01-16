/**
 * Agent Definition Versioning Types (Task 29)
 *
 * Interfaces for versioned agent definitions with rollback support.
 */

/**
 * Core version data for an agent definition snapshot.
 */
export interface AgentVersion {
  /** Agent identifier (e.g. "coder", "researcher") */
  slug: string;
  /** Semantic version string (e.g. "1.0.0") */
  version: string;
  /** Human-readable description of changes */
  changelog: string;
  /** Whether this version is deprecated */
  deprecated: boolean;
  /** Version string that replaces this one (when deprecated) */
  deprecatedBy?: string;
  /** Full agent definition content */
  content: string;
  /** SHA-256 hex digest of content */
  contentHash: string;
  /** Timestamp when the snapshot was captured */
  capturedAt: Date;
  /** Identity of who captured this version */
  capturedBy: string;
}

/**
 * Persisted version record with storage metadata.
 */
export interface AgentVersionRecord extends AgentVersion {
  /** Unique record identifier */
  id: string;
  /** Whether this is the current active version for the slug */
  isCurrent: boolean;
}

/**
 * Result of diffing two agent versions.
 */
export interface DiffResult {
  slug: string;
  fromVersion: string;
  toVersion: string;
  additions: number;
  deletions: number;
  hunks: string;
}

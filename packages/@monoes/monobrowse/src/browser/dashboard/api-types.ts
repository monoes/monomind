/**
 * Typed API response schemas for the monobrowse dashboard.
 *
 * These interfaces are the canonical contract between server.ts and
 * dashboard clients (ui.html + any external consumers).  Changing a
 * field name here will surface breakage at compile time rather than
 * at runtime — preventing the field-name regression class documented
 * in the sprint review (e.g. `msg` vs `message`, `tokensIn` vs
 * `tokens_in`).
 *
 * @module @monomind/cli/browser/dashboard/api-types
 */

// ---------------------------------------------------------------------------
// Org / run lifecycle
// ---------------------------------------------------------------------------

export interface OrgStatusResponse {
  name: string;
  status: 'ready' | 'running' | 'stopped';
  currentRun?: RunRecord;
}

export interface RunRecord {
  /** Stable run identifier (UUID or monotonic ID). */
  id: string;
  playbookId: string;
  startedAt: number; // Unix ms timestamp
  itemsProcessed: number;
  status: string;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export interface SessionListResponse {
  sessions: SessionEntry[];
  total: number;
}

export interface SessionEntry {
  sessionId: string;
  name: string;
  createdAt: string; // ISO-8601 timestamp
}

// ---------------------------------------------------------------------------
// Budget / cost tracking
// ---------------------------------------------------------------------------

export interface BudgetResponse {
  /** Input tokens consumed in this session/run. */
  tokensIn: number;
  /** Output tokens generated in this session/run. */
  tokensOut: number;
  /** Total monetary cost in `currency` units. */
  totalCost: number;
  currency: 'USD';
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  /** Human-readable error message. */
  error: string;
  /** Optional machine-readable error code for programmatic handling. */
  code?: string;
}

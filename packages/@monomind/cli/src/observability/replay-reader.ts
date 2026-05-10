/**
 * ReplayReader
 *
 * Reads session files from .monomind/sessions/ for replay and listing.
 * Session files follow the pattern session-{id}.json. current.json is a
 * regular file (not a symlink) pointing to the active session data.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, sep, resolve } from 'path';

export interface SessionSummary {
  id: string;
  startedAt: string;
  endedAt?: string;
  tokenUsage?: { total?: number };
  taskCount?: number;
  filePath: string;
}

export interface SessionReplay extends SessionSummary {
  raw: Record<string, unknown>; // full session data
}

export class ReplayReader {
  private sessionsDir: string;

  constructor(cwd = process.cwd()) {
    this.sessionsDir = join(cwd, '.monomind', 'sessions');
  }

  /**
   * Find and return the session data for a given session ID.
   * The ID may be a bare ID (e.g. "session-1234567890") or a timestamp number.
   * Falls back to current.json if the id matches the current session.
   */
  async show(sessionId: string): Promise<SessionReplay | null> {
    if (!existsSync(this.sessionsDir)) {
      return null;
    }

    // Normalize: allow bare numeric IDs or full "session-<id>" form
    const normalized = sessionId.startsWith('session-')
      ? sessionId
      : `session-${sessionId}`;

    // Guard against path traversal (e.g. sessionId = "../../../etc/passwd")
    const filePath = join(this.sessionsDir, `${normalized}.json`);
    if (!resolve(filePath).startsWith(resolve(this.sessionsDir) + sep)) return null;
    if (existsSync(filePath)) {
      return this.parseReplay(filePath);
    }

    // Fall back to current.json if the id matches
    const currentPath = join(this.sessionsDir, 'current.json');
    if (existsSync(currentPath)) {
      const current = this.parseReplay(currentPath);
      if (current && (current.id === sessionId || current.id === normalized)) {
        return current;
      }
    }

    return null;
  }

  /**
   * List sessions ordered by startedAt descending (most recent first).
   * current.json is excluded — only persisted session-*.json files are listed.
   */
  async list(limit = 20): Promise<SessionSummary[]> {
    if (!existsSync(this.sessionsDir)) {
      return [];
    }

    let entries: string[];
    try {
      entries = readdirSync(this.sessionsDir);
    } catch {
      return [];
    }

    const summaries: SessionSummary[] = [];

    for (const entry of entries) {
      if (!entry.startsWith('session-') || !entry.endsWith('.json')) {
        continue;
      }
      const filePath = join(this.sessionsDir, entry);
      const summary = this.parseSummary(filePath);
      if (summary) {
        summaries.push(summary);
      }
    }

    // Sort by startedAt descending; push invalid dates to the end
    summaries.sort((a, b) => {
      const ta = new Date(a.startedAt).getTime();
      const tb = new Date(b.startedAt).getTime();
      if (isNaN(ta) && isNaN(tb)) return 0;
      if (isNaN(ta)) return 1;
      if (isNaN(tb)) return -1;
      return tb - ta;
    });

    return summaries.slice(0, limit);
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private parseReplay(filePath: string): SessionReplay | null {
    const raw = this.readJson(filePath);
    if (!raw) return null;
    const summary = this.buildSummary(raw, filePath);
    if (!summary) return null;
    return { ...summary, raw };
  }

  private parseSummary(filePath: string): SessionSummary | null {
    const raw = this.readJson(filePath);
    if (!raw) return null;
    return this.buildSummary(raw, filePath);
  }

  private buildSummary(
    raw: Record<string, unknown>,
    filePath: string,
  ): SessionSummary | null {
    const id = typeof raw.id === 'string' ? raw.id : null;
    const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : null;
    if (!id || !startedAt) return null;

    const endedAt = typeof raw.endedAt === 'string' ? raw.endedAt : undefined;

    // tokenUsage is not present in current session files but kept optional per interface
    const tokenUsage =
      raw.tokenUsage && typeof raw.tokenUsage === 'object'
        ? (raw.tokenUsage as { total?: number })
        : undefined;

    // taskCount comes from metrics.tasks
    const metrics =
      raw.metrics && typeof raw.metrics === 'object'
        ? (raw.metrics as Record<string, unknown>)
        : undefined;
    const taskCount =
      metrics && typeof metrics.tasks === 'number' ? metrics.tasks : undefined;

    return { id, startedAt, endedAt, tokenUsage, taskCount, filePath };
  }

  private readJson(filePath: string): Record<string, unknown> | null {
    try {
      // Hard size cap. Without this, a single planted multi-GB session-*.json
      // (or a runaway log) crashes the CLI with allocation failure when
      // any code path touches `list()` or `show()`.
      const stat = statSync(filePath);
      if (stat.size > 25 * 1024 * 1024) return null;
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
}

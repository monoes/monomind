/**
 * LearningService — session-scoped learning consolidation
 * Used as a module-level singleton by hook-handler.cjs (getLearningService()).
 *
 * Contract:
 *   new LearningService()
 *   await svc.initialize()   — open DB / load state
 *   await svc.consolidate()  — flush accumulated learnings to persistent store
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';

const CWD = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const LEARN_DIR = path.join(CWD, '.monomind', 'learning');
const LEARN_FILE = path.join(LEARN_DIR, 'session-learnings.json');

export class LearningService {
  constructor() {
    this._entries = [];
    this._initialized = false;
  }

  async initialize() {
    try {
      mkdirSync(LEARN_DIR, { recursive: true });
      if (existsSync(LEARN_FILE)) {
        const raw = await fs.readFile(LEARN_FILE, 'utf-8');
        const data = JSON.parse(raw);
        this._entries = Array.isArray(data) ? data : [];
      }
    } catch (_) {
      this._entries = [];
    }
    this._initialized = true;
  }

  record(entry) {
    if (!this._initialized) return;
    this._entries.push(Object.assign({ ts: new Date().toISOString() }, entry));
  }

  async consolidate() {
    if (!this._initialized || this._entries.length === 0) return;
    try {
      mkdirSync(LEARN_DIR, { recursive: true });
      // Keep last 1000 entries
      const trimmed = this._entries.slice(-1000);
      await fs.writeFile(LEARN_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
      this._entries = trimmed;
    } catch (_) {}
  }

  getEntries() {
    return this._entries.slice();
  }
}

export default { LearningService };

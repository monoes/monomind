/**
 * Trigger Scanner (Task 32)
 *
 * Scans task descriptions against compiled trigger patterns
 * from agent frontmatter and returns matches.
 *
 * - Patterns are tested in descending priority order.
 * - A `takeover` match short-circuits: only that agent is returned.
 * - `inject` matches accumulate as additional candidates.
 * - Invalid regex patterns are silently skipped.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type {
  TriggerPattern,
  TriggerMatch,
  TriggerIndex,
} from '../../../../@monobrain/shared/src/types/trigger.js';

/** Compiled regex paired with its source TriggerPattern. */
interface CompiledPattern {
  source: TriggerPattern;
  regex: RegExp;
}

export class TriggerScanner {
  private compiled: CompiledPattern[] = [];
  private patterns: TriggerPattern[] = [];
  private totalAgentsScanned = 0;

  constructor(patterns: TriggerPattern[] = []) {
    for (const p of patterns) {
      this.compileAndAdd(p);
    }
    this.sortByPriority();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Test all patterns against `taskDescription` and return matches.
   *
   * Patterns are tested in descending priority order.
   * If a `takeover` pattern matches, scanning stops immediately
   * and only that agent is returned.
   */
  scan(taskDescription: string): TriggerMatch[] {
    const matches: TriggerMatch[] = [];

    for (const { source, regex } of this.compiled) {
      // Reset lastIndex in case the regex has the global flag
      regex.lastIndex = 0;
      const m = regex.exec(taskDescription);
      if (!m) continue;

      const match: TriggerMatch = {
        agentSlug: source.agentSlug,
        pattern: source.pattern,
        mode: source.mode,
        matchedText: m[0],
      };

      if (source.mode === 'takeover') {
        // Short-circuit: return only this agent
        return [match];
      }

      matches.push(match);
    }

    return matches;
  }

  /**
   * Build an index by scanning agent markdown files under `agentDir`.
   *
   * Reads each `.md` file, extracts YAML frontmatter, and looks for
   * `triggers:` entries with `pattern`, `mode`, and optional `priority`.
   */
  buildIndex(agentDir: string): TriggerIndex {
    const mdFiles = this.collectMdFiles(agentDir);
    this.patterns = [];
    this.compiled = [];
    this.totalAgentsScanned = mdFiles.length;

    for (const filePath of mdFiles) {
      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const slug = this.slugFromPath(filePath);
      const triggers = this.extractTriggers(content, slug);
      for (const t of triggers) {
        this.compileAndAdd(t);
      }
    }

    this.sortByPriority();

    return {
      patterns: [...this.patterns],
      builtAt: new Date().toISOString(),
      totalAgentsScanned: this.totalAgentsScanned,
    };
  }

  /** Add a pattern to the index at runtime. */
  addPattern(pattern: TriggerPattern): void {
    this.compileAndAdd(pattern);
    this.sortByPriority();
  }

  /**
   * Remove a specific pattern for an agent.
   * Returns `true` if the pattern was found and removed.
   */
  removePattern(agentSlug: string, pattern: string): boolean {
    const idx = this.patterns.findIndex(
      (p) => p.agentSlug === agentSlug && p.pattern === pattern,
    );
    if (idx === -1) return false;

    this.patterns.splice(idx, 1);
    this.compiled.splice(idx, 1);
    return true;
  }

  /** Return a snapshot of the current index. */
  getIndex(): TriggerIndex {
    return {
      patterns: [...this.patterns],
      builtAt: new Date().toISOString(),
      totalAgentsScanned: this.totalAgentsScanned,
    };
  }

  /** Number of compiled patterns. */
  get size(): number {
    return this.compiled.length;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private compileAndAdd(pattern: TriggerPattern): void {
    try {
      const regex = new RegExp(pattern.pattern, 'i');
      this.patterns.push(pattern);
      this.compiled.push({ source: pattern, regex });
    } catch {
      // Invalid regex — skip silently
    }
  }

  private sortByPriority(): void {
    // Sort both arrays in-sync by descending priority
    const indexed = this.patterns.map((p, i) => ({ p, c: this.compiled[i], priority: p.priority }));
    indexed.sort((a, b) => b.priority - a.priority);
    this.patterns = indexed.map((x) => x.p);
    this.compiled = indexed.map((x) => x.c);
  }

  /** Recursively collect `.md` files. */
  private collectMdFiles(dir: string): string[] {
    const results: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return results;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        results.push(...this.collectMdFiles(full));
      } else if (stat.isFile() && extname(entry) === '.md') {
        results.push(full);
      }
    }
    return results;
  }

  /** Derive slug from filename. */
  private slugFromPath(filePath: string): string {
    const base = filePath.split('/').pop() ?? '';
    return base
      .replace(/\.md$/i, '')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  /**
   * Extract trigger definitions from markdown frontmatter.
   *
   * Looks for a YAML block between `---` markers, then finds lines like:
   *   - pattern: "\\b(auth|jwt)\\b"
   *     mode: "inject"
   *     priority: 10
   */
  private extractTriggers(content: string, agentSlug: string): TriggerPattern[] {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return [];

    const block = fmMatch[1];
    const triggers: TriggerPattern[] = [];

    // Find trigger blocks: lines starting with "- pattern:" under a triggers: section
    const lines = block.split('\n');
    let inTriggers = false;
    let currentTrigger: Partial<TriggerPattern> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      // Measure leading whitespace to distinguish top-level keys from nested props
      const indent = line.length - line.trimStart().length;

      if (trimmed === 'triggers:' || trimmed.startsWith('triggers:')) {
        inTriggers = true;
        continue;
      }

      // Exit triggers section when we hit a non-indented top-level key (indent 0)
      if (inTriggers && indent === 0 && /^[a-zA-Z]/.test(trimmed)) {
        inTriggers = false;
        if (currentTrigger?.pattern) {
          triggers.push(this.finalizeTrigger(currentTrigger, agentSlug));
        }
        currentTrigger = null;
        continue;
      }

      if (!inTriggers) continue;

      // New list item
      if (trimmed.startsWith('- pattern:')) {
        if (currentTrigger?.pattern) {
          triggers.push(this.finalizeTrigger(currentTrigger, agentSlug));
        }
        currentTrigger = {
          pattern: this.extractYamlValue(trimmed.replace(/^- pattern:\s*/, '')),
          agentSlug,
        };
      } else if (currentTrigger && trimmed.startsWith('mode:')) {
        const val = this.extractYamlValue(trimmed.replace(/^mode:\s*/, ''));
        if (val === 'inject' || val === 'takeover') {
          currentTrigger.mode = val;
        }
      } else if (currentTrigger && trimmed.startsWith('priority:')) {
        const val = parseInt(trimmed.replace(/^priority:\s*/, ''), 10);
        if (!isNaN(val)) {
          currentTrigger.priority = val;
        }
      }
    }

    // Flush last trigger
    if (currentTrigger?.pattern) {
      triggers.push(this.finalizeTrigger(currentTrigger, agentSlug));
    }

    return triggers;
  }

  private finalizeTrigger(partial: Partial<TriggerPattern>, agentSlug: string): TriggerPattern {
    return {
      pattern: partial.pattern!,
      mode: partial.mode ?? 'inject',
      priority: partial.priority ?? 0,
      agentSlug,
    };
  }

  private extractYamlValue(raw: string): string {
    let v = raw.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      // YAML double-quoted: unescape \\ → \ so "\\b" becomes \b (word boundary)
      v = v.slice(1, -1).replace(/\\\\/g, '\\');
    } else if (v.startsWith("'") && v.endsWith("'")) {
      v = v.slice(1, -1);
    }
    return v;
  }
}

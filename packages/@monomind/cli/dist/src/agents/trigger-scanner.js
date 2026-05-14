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
import { readFileSync, readdirSync, lstatSync, statSync, realpathSync } from 'fs';
import { join, extname, resolve, sep } from 'path';
export class TriggerScanner {
    compiled = [];
    patterns = [];
    totalAgentsScanned = 0;
    buildingIndex = false;
    constructor(patterns = []) {
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
    scan(taskDescription) {
        const matches = [];
        for (const { source, regex } of this.compiled) {
            // Reset lastIndex in case the regex has the global flag
            regex.lastIndex = 0;
            const m = regex.exec(taskDescription);
            if (!m)
                continue;
            const match = {
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
    buildIndex(agentDir, allowedRoot) {
        if (this.buildingIndex) {
            throw new Error('buildIndex is already running; concurrent invocations are not safe');
        }
        this.buildingIndex = true;
        try {
            return this._buildIndex(agentDir, allowedRoot);
        }
        finally {
            this.buildingIndex = false;
        }
    }
    _buildIndex(agentDir, allowedRoot) {
        if (allowedRoot) {
            let resolvedDir;
            let resolvedRoot;
            try {
                resolvedDir = realpathSync(resolve(agentDir));
            }
            catch {
                resolvedDir = resolve(agentDir);
            }
            try {
                resolvedRoot = realpathSync(resolve(allowedRoot));
            }
            catch {
                resolvedRoot = resolve(allowedRoot);
            }
            if (!resolvedDir.startsWith(resolvedRoot + sep) && resolvedDir !== resolvedRoot) {
                throw new Error(`Agent directory escapes workspace: ${resolvedDir}`);
            }
        }
        const mdFiles = this.collectMdFiles(agentDir);
        this.patterns = [];
        this.compiled = [];
        this.totalAgentsScanned = mdFiles.length;
        const MAX_AGENT_FILE_BYTES = 1 * 1024 * 1024;
        for (const filePath of mdFiles) {
            let content;
            try {
                if (statSync(filePath).size > MAX_AGENT_FILE_BYTES)
                    continue;
                content = readFileSync(filePath, 'utf-8');
            }
            catch {
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
    addPattern(pattern) {
        this.compileAndAdd(pattern);
        this.sortByPriority();
    }
    /**
     * Remove a specific pattern for an agent.
     * Returns `true` if the pattern was found and removed.
     */
    removePattern(agentSlug, pattern) {
        const idx = this.patterns.findIndex((p) => p.agentSlug === agentSlug && p.pattern === pattern);
        if (idx === -1)
            return false;
        this.patterns.splice(idx, 1);
        this.compiled.splice(idx, 1);
        return true;
    }
    /** Return a snapshot of the current index. */
    getIndex() {
        return {
            patterns: [...this.patterns],
            builtAt: new Date().toISOString(),
            totalAgentsScanned: this.totalAgentsScanned,
        };
    }
    /** Number of compiled patterns. */
    get size() {
        return this.compiled.length;
    }
    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------
    compileAndAdd(pattern) {
        if (pattern.pattern.length > 200)
            return;
        // Reject patterns with nested/repeated quantifiers (ReDoS vectors)
        // Covers: (a+)+, (a|b+)+, (a?){n}, ((a)+)+, [a-z]+{n}
        if (/(\(.*[+*?].*\)|[+*?]){2,}|\{[0-9,]+\}.*[+*?]|(\[[^\]]*\]|\.)[+*?][+*?]/.test(pattern.pattern))
            return;
        if (/\([^)]*([+*][^)]*){2,}\)/.test(pattern.pattern))
            return;
        try {
            const regex = new RegExp(pattern.pattern, 'i');
            this.patterns.push(pattern);
            this.compiled.push({ source: pattern, regex });
        }
        catch {
            // Invalid regex — skip silently
        }
    }
    sortByPriority() {
        // Sort both arrays in-sync by descending priority
        const indexed = this.patterns.map((p, i) => ({ p, c: this.compiled[i], priority: p.priority }));
        indexed.sort((a, b) => b.priority - a.priority);
        this.patterns = indexed.map((x) => x.p);
        this.compiled = indexed.map((x) => x.c);
    }
    /** Recursively collect `.md` files (symlinks skipped, visited inodes tracked). */
    collectMdFiles(dir, visited = new Set()) {
        const results = [];
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return results;
        }
        for (const entry of entries) {
            const full = join(dir, entry);
            let lstat;
            try {
                lstat = lstatSync(full);
            }
            catch {
                continue;
            }
            if (lstat.isSymbolicLink())
                continue;
            if (lstat.isDirectory()) {
                if (visited.has(lstat.ino))
                    continue;
                visited.add(lstat.ino);
                results.push(...this.collectMdFiles(full, visited));
            }
            else if (lstat.isFile() && extname(entry) === '.md') {
                results.push(full);
            }
        }
        return results;
    }
    /** Derive slug from filename. */
    slugFromPath(filePath) {
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
    extractTriggers(content, agentSlug) {
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fmMatch)
            return [];
        const block = fmMatch[1];
        const triggers = [];
        // Find trigger blocks: lines starting with "- pattern:" under a triggers: section
        const lines = block.split('\n');
        let inTriggers = false;
        let currentTrigger = null;
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
            if (!inTriggers)
                continue;
            // New list item
            if (trimmed.startsWith('- pattern:')) {
                if (currentTrigger?.pattern) {
                    triggers.push(this.finalizeTrigger(currentTrigger, agentSlug));
                }
                currentTrigger = {
                    pattern: this.extractYamlValue(trimmed.replace(/^- pattern:\s*/, '')),
                    agentSlug,
                };
            }
            else if (currentTrigger && trimmed.startsWith('mode:')) {
                const val = this.extractYamlValue(trimmed.replace(/^mode:\s*/, ''));
                if (val === 'inject' || val === 'takeover') {
                    currentTrigger.mode = val;
                }
            }
            else if (currentTrigger && trimmed.startsWith('priority:')) {
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
    finalizeTrigger(partial, agentSlug) {
        return {
            pattern: partial.pattern,
            mode: partial.mode ?? 'inject',
            priority: partial.priority ?? 0,
            agentSlug,
        };
    }
    extractYamlValue(raw) {
        let v = raw.trim();
        if (v.startsWith('"') && v.endsWith('"')) {
            // YAML double-quoted: unescape \\ → \ so "\\b" becomes \b (word boundary)
            v = v.slice(1, -1).replace(/\\\\/g, '\\');
        }
        else if (v.startsWith("'") && v.endsWith("'")) {
            v = v.slice(1, -1);
        }
        return v;
    }
}
//# sourceMappingURL=trigger-scanner.js.map
/**
 * Tool Registry (Task 31)
 *
 * Manages semver versioning for MCP tools with deprecation tracking
 * and tool-to-agent impact analysis. Uses JSONL file storage.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync, readdirSync, lstatSync, } from 'fs';
import { join, dirname, extname, resolve, sep } from 'path';
/** Default JSONL storage path relative to project root. */
const DEFAULT_STORAGE_PATH = '.monomind/tool-versions.jsonl';
/**
 * Registry for versioned MCP tools.
 *
 * Stores tool metadata and version history in a JSONL file.
 * Supports deprecation marking and agent impact analysis.
 */
export class ToolRegistry {
    tools = new Map();
    history = [];
    storagePath;
    constructor(storagePath = DEFAULT_STORAGE_PATH) {
        const resolvedPath = resolve(storagePath);
        const allowedRoot = process.env.MONOMIND_DATA_DIR
            ? resolve(process.env.MONOMIND_DATA_DIR)
            : resolve(process.cwd());
        if (resolvedPath !== allowedRoot && !resolvedPath.startsWith(allowedRoot + sep)) {
            throw new Error(`Tool registry storagePath escapes allowed root: ${resolvedPath}`);
        }
        this.storagePath = resolvedPath;
        this.loadFromDisk();
    }
    /**
     * Register a new tool or update an existing one.
     */
    register(tool) {
        const existing = this.tools.get(tool.toolName);
        const changeType = existing
            ? 'updated'
            : 'added';
        this.tools.set(tool.toolName, { ...tool });
        const entry = {
            toolName: tool.toolName,
            version: tool.version,
            changeType,
            changedAt: new Date().toISOString(),
            description: changeType === 'added'
                ? `Registered tool ${tool.toolName} v${tool.version}`
                : `Updated tool ${tool.toolName} to v${tool.version}`,
        };
        this.history.push(entry);
        this.appendEntry(entry);
    }
    /**
     * Mark a tool as deprecated with an optional successor.
     */
    deprecate(toolName, message, successor) {
        const tool = this.tools.get(toolName);
        if (!tool) {
            throw new Error(`Tool "${toolName}" not found in registry`);
        }
        tool.deprecated = true;
        tool.deprecationMessage = message;
        tool.deprecatedAt = new Date().toISOString();
        if (successor) {
            tool.successor = successor;
        }
        const entry = {
            toolName,
            version: tool.version,
            changeType: 'deprecated',
            changedAt: tool.deprecatedAt,
            description: message,
        };
        this.history.push(entry);
        this.appendEntry(entry);
    }
    /**
     * Get the current version info for a tool.
     * Returns null if the tool is not registered.
     */
    getVersion(toolName) {
        return this.tools.get(toolName) ?? null;
    }
    /**
     * List all deprecated tools.
     */
    listDeprecated() {
        const result = [];
        for (const tool of this.tools.values()) {
            if (tool.deprecated) {
                result.push({ ...tool });
            }
        }
        return result;
    }
    /**
     * Find agents that reference the given tool.
     *
     * Scans agent markdown files under the provided agents directory
     * and returns slugs of agents whose `tools:` frontmatter or body
     * mention the tool name.
     */
    getImpactedAgents(toolName, agentsDir = 'agents') {
        // Reject empty or short tool names — `content.includes('')` returns true
        // for every file, turning the registry into a directory enumerator.
        if (typeof toolName !== 'string' || toolName.length < 2 || !/^[a-zA-Z0-9_.-]+$/.test(toolName)) {
            return [];
        }
        const impacted = [];
        const mdFiles = collectMdFiles(agentsDir);
        for (const filePath of mdFiles) {
            let content;
            try {
                content = readFileSync(filePath, 'utf-8');
            }
            catch {
                continue;
            }
            if (content.includes(toolName)) {
                // Derive slug from filename (strip .md extension)
                const parts = filePath.split('/');
                const filename = parts[parts.length - 1];
                const slug = filename.replace(/\.md$/, '');
                impacted.push(slug);
            }
        }
        return impacted;
    }
    /**
     * Get the full version history for a tool, or all tools if no name given.
     */
    getHistory(toolName) {
        if (!toolName) {
            return [...this.history];
        }
        return this.history.filter((e) => e.toolName === toolName);
    }
    /**
     * Get all registered tools.
     */
    listAll() {
        return Array.from(this.tools.values()).map((t) => ({ ...t }));
    }
    // ---- Private helpers ----
    /**
     * Load existing entries from the JSONL file on disk.
     */
    loadFromDisk() {
        if (!existsSync(this.storagePath)) {
            return;
        }
        let raw;
        try {
            raw = readFileSync(this.storagePath, 'utf-8');
        }
        catch {
            return;
        }
        const NAME_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
        const STR_MAX = 500;
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const record = JSON.parse(trimmed);
                if (!record || typeof record !== 'object')
                    continue;
                // Validate fields before storage. The JSONL file lives on disk; an
                // attacker with local write access could otherwise plant attacker-controlled
                // strings (e.g. malicious deprecationMessage with markup) that reach
                // downstream renderers (DOT visualizer, deprecation-injector warnings).
                if (record._type === 'tool') {
                    if (typeof record.toolName !== 'string' || !NAME_RE.test(record.toolName))
                        continue;
                    if (record.successor !== undefined && (typeof record.successor !== 'string' || !NAME_RE.test(record.successor)))
                        continue;
                    if (record.deprecationMessage !== undefined && (typeof record.deprecationMessage !== 'string' || record.deprecationMessage.length > STR_MAX))
                        continue;
                    this.tools.set(record.toolName, record);
                }
                else if (record._type === 'history') {
                    if (typeof record.toolName !== 'string' || !NAME_RE.test(record.toolName))
                        continue;
                    this.history.push(record);
                }
            }
            catch {
                // Skip malformed lines
            }
        }
    }
    /**
     * Append a version history entry and the current tool state to disk.
     */
    appendEntry(entry) {
        const dir = dirname(this.storagePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const tool = this.tools.get(entry.toolName);
        const lines = [];
        if (tool) {
            lines.push(JSON.stringify({ _type: 'tool', ...tool }));
        }
        lines.push(JSON.stringify({ _type: 'history', ...entry }));
        appendFileSync(this.storagePath, lines.join('\n') + '\n', 'utf-8');
    }
}
/**
 * Recursively collect all `.md` files under a directory.
 */
function collectMdFiles(root) {
    const results = [];
    let entries;
    try {
        entries = readdirSync(root);
    }
    catch {
        return results;
    }
    for (const entry of entries) {
        const full = join(root, entry);
        let stat;
        try {
            // Use lstatSync so symlinks aren't followed — otherwise a symlink under
            // `agentsDir` could redirect this scan into arbitrary filesystem
            // locations, which combined with `getImpactedAgents` becomes a content
            // oracle that fingerprints arbitrary text files outside the project.
            stat = lstatSync(full);
        }
        catch {
            continue;
        }
        if (stat.isSymbolicLink())
            continue;
        if (stat.isDirectory()) {
            results.push(...collectMdFiles(full));
        }
        else if (stat.isFile() && extname(entry) === '.md') {
            results.push(full);
        }
    }
    return results;
}
//# sourceMappingURL=tool-registry.js.map
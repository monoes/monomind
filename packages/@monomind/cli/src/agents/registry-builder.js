/**
 * Registry Builder (Task 30)
 *
 * Scans agent definition .md files, parses YAML frontmatter,
 * and produces a unified AgentRegistry JSON.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename, relative, extname } from 'path';
/** Directories to skip during recursive scan. */
const SKIP_DIRS = new Set(['schemas', 'ephemeral']);
/**
 * Recursively collect all `.md` files under `root`, skipping SKIP_DIRS.
 */
function collectMdFiles(root, base = root) {
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
            stat = statSync(full);
        }
        catch {
            continue;
        }
        if (stat.isDirectory()) {
            if (SKIP_DIRS.has(entry))
                continue;
            results.push(...collectMdFiles(full, base));
        }
        else if (stat.isFile() && extname(entry) === '.md') {
            results.push(full);
        }
    }
    return results;
}
/**
 * Parse YAML frontmatter from markdown content using simple regex.
 * Returns key-value pairs from the `---` delimited block.
 */
function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match)
        return {};
    const block = match[1];
    const result = {};
    for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        // Handle YAML arrays written as "[a, b, c]"
        if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
            value = value
                .slice(1, -1)
                .split(',')
                .map((s) => s.trim().replace(/^["']|["']$/g, ''))
                .filter(Boolean);
        }
        // Handle booleans
        else if (value === 'true')
            value = true;
        else if (value === 'false')
            value = false;
        // Handle quoted strings
        else if (typeof value === 'string' &&
            ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}
/** Coerce a value into a string array. */
function toStringArray(val) {
    if (Array.isArray(val))
        return val.map(String);
    if (typeof val === 'string' && val.length > 0)
        return [val];
    return [];
}
/** Parse trigger patterns from frontmatter value. */
function parseTriggers(val) {
    if (!val)
        return [];
    const arr = Array.isArray(val) ? val : [val];
    return arr.map((t) => {
        if (typeof t === 'object' && t !== null && 'pattern' in t) {
            return { pattern: String(t.pattern), mode: String(t.mode ?? 'glob') };
        }
        return { pattern: String(t), mode: 'glob' };
    });
}
/**
 * Derive a slug from a filename: remove extension, lowercase, replace spaces with hyphens.
 */
function slugFromFilename(filename) {
    return basename(filename, extname(filename))
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}
/**
 * Derive category from the parent directory name relative to agents root.
 */
function categoryFromPath(filePath, agentsRoot) {
    const rel = relative(agentsRoot, filePath);
    const parts = rel.split('/');
    return parts.length > 1 ? parts[0] : 'default';
}
/**
 * Build the agent registry by scanning `.md` files under `agentsRoot`.
 *
 * @param agentsRoot - Root directory containing agent definition markdown files.
 * @param outputPath - Optional path to write the registry JSON file.
 * @returns The built AgentRegistry object.
 */
export function buildRegistry(agentsRoot, outputPath) {
    const files = collectMdFiles(agentsRoot);
    const now = new Date().toISOString();
    const agents = [];
    for (const file of files) {
        const content = readFileSync(file, 'utf-8');
        const fm = parseFrontmatter(content);
        const slug = fm.slug || slugFromFilename(file);
        const entry = {
            slug,
            name: fm.name || slug,
            version: fm.version || '0.0.0',
            category: fm.category || categoryFromPath(file, agentsRoot),
            capabilities: toStringArray(fm.capabilities),
            taskTypes: toStringArray(fm.taskTypes ?? fm['task-types'] ?? fm.task_types),
            tools: toStringArray(fm.tools),
            triggers: parseTriggers(fm.triggers),
            deprecated: fm.deprecated === true,
            deprecatedBy: fm.deprecatedBy,
            dependencies: toStringArray(fm.dependencies),
            filePath: file,
            registeredAt: now,
            lastUpdated: now,
        };
        agents.push(entry);
    }
    const registry = {
        version: '1.0.0',
        generatedAt: now,
        totalAgents: agents.length,
        agents,
    };
    if (outputPath) {
        writeFileSync(outputPath, JSON.stringify(registry, null, 2), 'utf-8');
    }
    return registry;
}
//# sourceMappingURL=registry-builder.js.map
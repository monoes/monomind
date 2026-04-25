/**
 * Tool Registry (Task 31)
 *
 * Manages semver versioning for MCP tools with deprecation tracking
 * and tool-to-agent impact analysis. Uses JSONL file storage.
 */

import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, dirname, extname } from 'path';
import type {
  VersionedMCPTool,
  ToolVersionEntry,
} from '../../../shared/src/types/tool-version.js';

/** Default JSONL storage path relative to project root. */
const DEFAULT_STORAGE_PATH = '.monobrain/tool-versions.jsonl';

/**
 * Registry for versioned MCP tools.
 *
 * Stores tool metadata and version history in a JSONL file.
 * Supports deprecation marking and agent impact analysis.
 */
export class ToolRegistry {
  private tools: Map<string, VersionedMCPTool> = new Map();
  private history: ToolVersionEntry[] = [];
  private readonly storagePath: string;

  constructor(storagePath: string = DEFAULT_STORAGE_PATH) {
    this.storagePath = storagePath;
    this.loadFromDisk();
  }

  /**
   * Register a new tool or update an existing one.
   */
  register(tool: VersionedMCPTool): void {
    const existing = this.tools.get(tool.toolName);
    const changeType: ToolVersionEntry['changeType'] = existing
      ? 'updated'
      : 'added';

    this.tools.set(tool.toolName, { ...tool });

    const entry: ToolVersionEntry = {
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
  deprecate(
    toolName: string,
    message: string,
    successor?: string,
  ): void {
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

    const entry: ToolVersionEntry = {
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
  getVersion(toolName: string): VersionedMCPTool | null {
    return this.tools.get(toolName) ?? null;
  }

  /**
   * List all deprecated tools.
   */
  listDeprecated(): VersionedMCPTool[] {
    const result: VersionedMCPTool[] = [];
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
  getImpactedAgents(
    toolName: string,
    agentsDir: string = 'agents',
  ): string[] {
    const impacted: string[] = [];
    const mdFiles = collectMdFiles(agentsDir);

    for (const filePath of mdFiles) {
      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
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
  getHistory(toolName?: string): ToolVersionEntry[] {
    if (!toolName) {
      return [...this.history];
    }
    return this.history.filter((e) => e.toolName === toolName);
  }

  /**
   * Get all registered tools.
   */
  listAll(): VersionedMCPTool[] {
    return Array.from(this.tools.values()).map((t) => ({ ...t }));
  }

  // ---- Private helpers ----

  /**
   * Load existing entries from the JSONL file on disk.
   */
  private loadFromDisk(): void {
    if (!existsSync(this.storagePath)) {
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(this.storagePath, 'utf-8');
    } catch {
      return;
    }

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed);
        if (record._type === 'tool') {
          this.tools.set(record.toolName, record as VersionedMCPTool);
        } else if (record._type === 'history') {
          this.history.push(record as ToolVersionEntry);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Append a version history entry and the current tool state to disk.
   */
  private appendEntry(entry: ToolVersionEntry): void {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tool = this.tools.get(entry.toolName);
    const lines: string[] = [];

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
function collectMdFiles(root: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (stat.isFile() && extname(entry) === '.md') {
      results.push(full);
    }
  }
  return results;
}

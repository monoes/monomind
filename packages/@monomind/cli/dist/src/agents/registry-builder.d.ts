/**
 * Registry Builder (Task 30)
 *
 * Scans agent definition .md files, parses YAML frontmatter,
 * and produces a unified AgentRegistry JSON.
 */
import type { AgentRegistry } from '../../../shared/src/types/agent-registry.js';
/**
 * Build the agent registry by scanning `.md` files under `agentsRoot`.
 *
 * @param agentsRoot - Root directory (or array of directories) to scan.
 * @param outputPath - Optional path to write the registry JSON file.
 * @returns The built AgentRegistry object.
 */
export declare function buildRegistry(agentsRoot: string, outputPath?: string): AgentRegistry;
/**
 * Build a unified agent registry from multiple root directories, deduplicating
 * by slug. When the same slug appears in more than one root, the entry from the
 * **first** root in the array wins (earlier roots are considered canonical).
 *
 * Typical usage — extras (agency-agents) listed first so they take precedence
 * over any locally duplicated copies in `.claude/agents/`:
 *
 * ```ts
 * buildUnifiedRegistry([
 *   '/path/to/agency-agents',   // canonical source — wins on conflict
 *   '.claude/agents',           // dev copies — used only for unique slugs
 * ], '.monomind/registry.json');
 * ```
 *
 * @param roots      - Ordered list of directories to scan (first-wins on slug conflict).
 * @param outputPath - Optional path to write the merged registry JSON file.
 * @returns The deduplicated AgentRegistry.
 */
export declare function buildUnifiedRegistry(roots: string[], outputPath?: string): AgentRegistry;
//# sourceMappingURL=registry-builder.d.ts.map
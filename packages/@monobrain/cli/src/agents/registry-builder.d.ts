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
 * @param agentsRoot - Root directory containing agent definition markdown files.
 * @param outputPath - Optional path to write the registry JSON file.
 * @returns The built AgentRegistry object.
 */
export declare function buildRegistry(agentsRoot: string, outputPath?: string): AgentRegistry;
//# sourceMappingURL=registry-builder.d.ts.map
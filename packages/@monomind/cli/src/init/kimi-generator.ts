/**
 * kimi-code Configuration Generator
 *
 * Emits Kimi Code CLI artifacts that wire monomind into kimi:
 *
 *   Tier 1 (project-level, zero-install):
 *     .kimi-code/mcp.json              — monomind MCP server (merged, never clobbered)
 *     .kimi-code/agents/<name>.md      — converted from .claude/agents/
 *     .kimi-code/skills/<name>/SKILL.md — converted from .claude/skills/
 *     .kimi-code/skills/<cat>-<name>/  — .claude/commands/ converted to flow skills
 *                                        (the only project-level command mechanism kimi has)
 *     AGENTS.md                        — kimi workspace instructions (skip-if-exists)
 *
 *   Tier 2 (hooks bridge):
 *     .kimi-code/plugin/hooks/monomind-gate.mjs — stdin/exit-code bridge into the
 *                                        existing .claude/helpers/hook-handler.cjs gates.
 *                                        Kimi's hook protocol matches Claude's (JSON on
 *                                        stdin, exit 2 = block), so the handlers run unchanged.
 *
 *   Tier 3 (plugin packaging):
 *     .kimi-code/plugin/kimi.plugin.json + commands/ — installable via
 *                                        `/plugins install ./.kimi-code/plugin`, giving
 *                                        /<plugin>:<command> slash commands and auto-wired hooks
 *                                        (hooks cannot be configured project-level otherwise —
 *                                        [[hooks]] only lives in the user config.toml or plugins).
 *
 * ADDITIVE ONLY: opt-in via components.kimicode (default false). Never touches
 * .claude/, .gemini/, .opencode/ or opencode.json.
 *
 * Kimi format references (https://www.kimi.com/code/docs/en/):
 *   - MCP:      .kimi-code/mcp.json → { mcpServers: { name: { command, args, env } } }
 *   - Agents:   frontmatter name (kebab-case, else skipped), description; unknown
 *               fields (Claude's `model`, opencode's `mode`) are ignored; comma-separated
 *               `tools:` strings load fine.
 *   - Skills:   directory-form SKILL.md requires name + description; `type: flow`
 *               means manual invocation only (no model auto-invocation).
 *   - Commands: plugin manifest `commands` field → /monomind:<command>; $ARGUMENTS
 *               is the placeholder, same convention Claude commands already use.
 *
 * File-size sweep: split into sibling modules by tier/theme — MCP config in
 * kimi-generator-mcp.ts, Tier 1 frontmatter converters in
 * kimi-generator-frontmatter.ts, AGENTS.md in kimi-generator-agents-md.ts,
 * statusline in kimi-generator-statusline.ts, the Tier 2 hook gate bridge in
 * kimi-generator-hooks.ts, and the Tier 3 plugin manifest in
 * kimi-generator-plugin.ts. Re-exported here so every existing import path
 * keeps working unchanged.
 */

export { generateKimiAgentsMd } from './kimi-generator-agents-md.js';
export {
  convertKimiAgentMd,
  convertKimiCommandToFlowSkill,
  convertKimiPluginCommandMd,
  convertKimiSkillMd,
  isCatalogStyleRouterCommand,
  kimiCommandFilename,
} from './kimi-generator-frontmatter.js';
export { generateKimiGateScript, generateKimiMeshScript } from './kimi-generator-hooks.js';
export {
  generateKimiMcpConfig,
  generateKimiMcpJson,
  mergeKimiMcpJson,
} from './kimi-generator-mcp.js';
export { generateKimiPluginManifest } from './kimi-generator-plugin.js';
export {
  generateKimiStatuslineSh,
  mergeKimiTuiTomlStatusline,
} from './kimi-generator-statusline.js';

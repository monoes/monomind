/**
 * GEMINI.md Generator
 * Generates Antigravity (agy) configuration and rules for Monomind integration.
 *
 * Outputs:
 *  - GEMINI.md             — agent instructions read by agy
 *  - .gemini/rules/monomind.md — rules file for Monomind workflows
 *  - .gemini/helpers/statusline.sh — shell script for the agy status bar
 *  - .gemini/settings.json — wires the status bar command into agy
 */

import type { InitOptions } from './types.js';

/** Generate GEMINI.md — the Antigravity equivalent of CLAUDE.md */
export function generateGeminiMd(options: InitOptions): string {
  const version = '2.8.0';
  return `# Monomind for Antigravity (agy) — v${version}

> Monomind extends agy with a codebase knowledge graph (Monograph), persistent
> cross-session memory, semantic Second Brain document search, and autonomous
> agent organisations. All data stays local — nothing leaves your machine.

## Behavioral Rules (Always Enforced)

- ALWAYS call \`mcp__monomind__monograph_suggest\` when starting a task touching 3+ files — it ranks files by task relevance and shows blast-radius before you touch anything.
- ALWAYS call \`mcp__monomind__monograph_query\` BEFORE running grep/find in the terminal — fall back to grep only if monograph returns zero results or the database does not exist.
- ALWAYS call \`mcp__monomind__monograph_impact\` before editing a class or exported symbol — it shows all upstream dependents.
- ALWAYS call \`mcp__monomind__memory_search\` before starting a task to recall past solutions, decisions, and architectural rules.
- After a memory search that actually helped: call \`mcp__monomind__memory_feedback\` with the entry IDs and quality score to train future ranking.
- At the end of a session that produced durable insight: call \`mcp__monomind__memory_kg_ingest\` once with the session ID as \`originRef\`.
- Use \`mcp__monomind__knowledge_search\` to query the project's indexed documents (specs, handbooks, notes) and the user's personal global brain.
- Do what has been asked; nothing more, nothing less.
- NEVER commit secrets, credentials, or .env files.
- NEVER create files unless they are absolutely necessary.
- ALWAYS prefer editing an existing file over creating a new one.

## Status Bar

The Monomind status bar is wired into agy via \`.gemini/helpers/statusline.sh\`.
It shows live: graph node count, stale-node count, agent routing, cost metrics,
and git state. The bar refreshes automatically whenever agy polls it.

To check system health at any time:
\`\`\`bash
node .gemini/helpers/statusline.cjs
\`\`\`

## MCP Tools — Quick Reference

| Category | Key Tools |
|---|---|
| **Knowledge Graph** | \`monograph_suggest\`, \`monograph_query\`, \`monograph_impact\`, \`monograph_neighbors\`, \`monograph_context\` |
| **Memory** | \`memory_search\`, \`memory_store\`, \`memory_feedback\`, \`memory_kg_ingest\`, \`memory_kg_search\` |
| **Documents** | \`knowledge_search\`, \`knowledge_ingest\` |
| **Orgs** | \`task_create\`, \`task_status\`, \`system_status\` |

## Org Runtime

Run autonomous background agent teams:
\`\`\`bash
monomind org run <name> --task "..."   # start daemon
monomind org status                    # check all orgs
monomind org questions <name>          # pending human questions
monomind org answer <name> <q-id> "…" # answer an agent question
\`\`\`

Org role provider can be set to \`gemini\` in the org JSON:
\`\`\`json
{ "provider": { "kind": "gemini", "apiKeyEnv": "GEMINI_API_KEY" } }
\`\`\`
`;
}

/** Generate .gemini/rules/monomind.md */
export function generateGeminiRulesMd(_options: InitOptions): string {
  return `# Monomind Workflow Rules for Antigravity

## Knowledge Graph (Monograph)

- Before exploring code: call \`mcp__monomind__monograph_suggest\` with your task description.
- Before editing a symbol: call \`mcp__monomind__monograph_impact\` to see what breaks.
- For targeted lookups: call \`mcp__monomind__monograph_query\` (BM25 + PPR graph reranking).
- Only fall back to \`grep\`/\`find\` if monograph returns zero results.

## Memory

- Always call \`mcp__monomind__memory_search\` at the start of a task.
- After a helpful search: call \`mcp__monomind__memory_feedback\` with result IDs.
- At session end: distill insights via \`mcp__monomind__memory_kg_ingest\`.

## Documents (Second Brain)

- User specs, handbooks, and notes are indexed locally.
- Use \`mcp__monomind__knowledge_search\` to retrieve them semantically.
- Results labeled \`[global]\` come from the user's personal cross-project brain.

## Statusline

- The Monomind status bar renders at the bottom of the agy chat window.
- It is driven by \`.gemini/helpers/statusline.sh\` → \`.gemini/helpers/statusline.cjs\`.
- Run \`node .gemini/helpers/statusline.cjs\` to see it in the terminal.
`;
}

/** Generate the .gemini/helpers/statusline.sh wrapper script */
export function generateStatuslineSh(): string {
  return `#!/usr/bin/env bash
# Monomind statusline for Antigravity (agy)
#
# agy calls this script periodically and renders its stdout in the status bar
# at the bottom of the chat window. The script delegates to the local Node.js
# statusline helper which reads .monomind/ metrics and produces ANSI output.
#
# Environment variables agy may pass:
#   ANTIGRAVITY_PROJECT_DIR  — absolute path to the open project root
#   CLAUDE_PROJECT_DIR       — legacy alias (also accepted)

PROJECT_DIR="\${ANTIGRAVITY_PROJECT_DIR:-\${CLAUDE_PROJECT_DIR:-\$(pwd)}}"

STATUSLINE_CJS="\${PROJECT_DIR}/.gemini/helpers/statusline.cjs"
if [ -f "\${STATUSLINE_CJS}" ]; then
  node "\${STATUSLINE_CJS}" 2>/dev/null
elif [ -f "\${PROJECT_DIR}/.claude/helpers/statusline.cjs" ]; then
  node "\${PROJECT_DIR}/.claude/helpers/statusline.cjs" 2>/dev/null
fi
`;
}

/** Generate .gemini/settings.json — wires the statusline into agy.
 *  NOTE: currently unused — writeGeminiFiles builds the settings object
 *  inline (it merges into existing settings instead of writing a fresh
 *  file). Kept exported for consumers that want the standalone JSON. */
export function generateAgySettingsJson(_options: InitOptions): string {
  return JSON.stringify({
    statusLine: {
      type: 'command',
      command: '.gemini/helpers/statusline.sh',
    },
  }, null, 2);
}

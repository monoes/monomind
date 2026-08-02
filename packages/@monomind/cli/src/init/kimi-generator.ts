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
 */

import type { InitOptions } from './types.js';

function isWindows(): boolean {
  return process.platform === 'win32';
}

/** Platform-specific npx invocation, mirrors mcp-generator.ts. */
function monomindMcpEntry(env: Record<string, string>): Record<string, unknown> {
  const base = ['-y', 'monomind@latest', 'mcp', 'start'];
  return isWindows()
    ? { command: 'cmd', args: ['/c', 'npx', ...base], env }
    : { command: 'npx', args: base, env };
}

function monomindEnv(options: InitOptions): Record<string, string> {
  return {
    npm_config_update_notifier: 'false',
    MONOMIND_MODE: 'v1',
    MONOMIND_HOOKS_ENABLED: 'true',
    MONOMIND_TOPOLOGY: options.runtime.topology,
    MONOMIND_MAX_AGENTS: String(options.runtime.maxAgents),
    MONOMIND_MEMORY_BACKEND: options.runtime.memoryBackend,
  };
}

/**
 * Build the .kimi-code/mcp.json object. Standalone (no existing file) case;
 * the executor merges into an existing file via mergeKimiMcpJson below.
 */
export function generateKimiMcpConfig(options: InitOptions): Record<string, unknown> {
  const config: Record<string, unknown> = { mcpServers: {} };
  if (options.mcp.monomind) {
    (config.mcpServers as Record<string, unknown>).monomind = monomindMcpEntry(monomindEnv(options));
  }
  return config;
}

export function generateKimiMcpJson(options: InitOptions): string {
  return JSON.stringify(generateKimiMcpConfig(options), null, 2) + '\n';
}

/**
 * Merge the monomind server into an existing .kimi-code/mcp.json without
 * touching the user's other servers. Returns null when the existing file is
 * unparseable (caller should skip, never clobber).
 */
export function mergeKimiMcpJson(existing: string, options: InitOptions): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(existing) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return null;
  if (options.mcp.monomind) servers.monomind = monomindMcpEntry(monomindEnv(options));
  parsed.mcpServers = servers;
  return JSON.stringify(parsed, null, 2) + '\n';
}

// ─── Tier 1: frontmatter converters (.claude/* → .kimi-code/*) ─────────────
//
// Same minimal-transform approach as opencode-generator.ts: only ensure the
// keys kimi actually reads are present and correct; everything else passes
// through (kimi ignores unknown frontmatter fields on agents).

interface SplitMd {
  fm: string;   // raw frontmatter body (between the --- fences), no fences
  body: string; // markdown body after the closing fence
  hasFm: boolean;
}

function splitFrontmatter(src: string): SplitMd {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: '', body: src, hasFm: false };
  return { fm: m[1], body: m[2], hasFm: true };
}

/** Insert a top-level scalar `key: value` into a frontmatter block if absent. */
function ensureFmKey(fm: string, key: string, value: string): string {
  const re = new RegExp('^' + key + '\\s*:', 'm');
  if (re.test(fm)) return fm;
  const line = key + ': ' + value;
  if (!fm.trim()) return line;
  const descIdx = fm.search(/^description\s*:/m);
  if (descIdx >= 0) {
    const eol = fm.indexOf('\n', descIdx);
    return eol < 0 ? fm + '\n' + line : fm.slice(0, eol + 1) + line + '\n' + fm.slice(eol + 1);
  }
  return line + '\n' + fm;
}

/** Set (replace-or-insert) a top-level scalar `key: value`. */
function setFmKey(fm: string, key: string, value: string): string {
  const re = new RegExp('^' + key + '\\s*:.*$', 'm');
  if (re.test(fm)) return fm.replace(re, key + ': ' + value);
  return ensureFmKey(fm, key, value);
}

/** Kebab-case slug — kimi REQUIRES agent names in kebab-case and skips the
 *  file with a warning otherwise. Also guarantees a filesystem-safe filename. */
function slugifyName(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'agent';
}

function getFmScalar(fm: string, key: string): string | null {
  const m = fm.match(new RegExp('^' + key + '\\s*:\\s*(.+?)\\s*$', 'm'));
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

/**
 * Convert a Claude agent definition to kimi agent format.
 * - name is slugified to kebab-case (hard requirement — kimi skips the file otherwise).
 * - description is ensured (kimi shows it to the main agent for delegation).
 * - Everything else passes through: kimi ignores Claude-only keys (model, etc.)
 *   and accepts comma-separated tools: strings.
 */
export function convertKimiAgentMd(src: string, fallbackName: string): string {
  const { fm, body, hasFm } = splitFrontmatter(src);
  const rawName = (getFmScalar(fm, 'name') || fallbackName).trim();
  const name = slugifyName(rawName);
  let out = fm;
  out = setFmKey(out, 'name', name);
  if (!getFmScalar(out, 'description')) {
    out = ensureFmKey(out, 'description', name + ' agent (monomind)');
  }
  if (hasFm || fm) {
    return '---\n' + out + '\n---\n' + body;
  }
  return '---\nname: ' + name + '\ndescription: ' + name + ' agent (monomind)\n---\n' + body;
}

/**
 * Convert a SKILL.md. Both Claude and kimi use directory-form SKILL.md with
 * required name + description — this only guarantees those two keys.
 */
export function convertKimiSkillMd(src: string, fallbackName: string): string {
  const { fm, body, hasFm } = splitFrontmatter(src);
  const name = slugifyName((getFmScalar(fm, 'name') || fallbackName).trim());
  let out = fm;
  out = setFmKey(out, 'name', name);
  if (!getFmScalar(out, 'description')) {
    out = ensureFmKey(out, 'description', name + ' skill (monomind)');
  }
  if (hasFm || fm) {
    return '---\n' + out + '\n---\n' + body;
  }
  return '---\nname: ' + name + '\ndescription: ' + name + ' skill (monomind)\n---\n' + body;
}

/**
 * Convert a Claude slash-command into a kimi flow skill — the only way to get
 * an invocable command at PROJECT level (kimi has no project-level command
 * directory; real slash commands require the plugin, see Tier 3).
 * - type: flow  → manual invocation only (/skill:<name>), never auto-invoked.
 * - Strips Claude-only frontmatter keys (allowed-tools, argument-hint, bare
 *   claude model names) whose semantics kimi doesn't share.
 */
export function convertKimiCommandToFlowSkill(src: string, category: string, fallbackName: string): string {
  const { fm, body } = splitFrontmatter(src);
  let out = fm
    .replace(/^allowed-tools\s*:.*(\r?\n|$)/im, '')
    .replace(/^argument-hint\s*:.*(\r?\n|$)/im, '')
    .replace(/^model\s*:\s*(?!.*\/).*/im, '') // drop bare claude model names
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const name = slugifyName(category + '-' + fallbackName);
  out = setFmKey(out, 'name', name);
  if (!getFmScalar(out, 'description')) {
    out = ensureFmKey(out, 'description', category + ' ' + fallbackName + ' command (monomind)');
  }
  out = setFmKey(out, 'type', 'flow');
  return '---\n' + out + '\n---\n\n' + body.trimStart();
}

/**
 * Convert a Claude slash-command into a kimi PLUGIN command file.
 * Plugin commands only read `name`/`description` frontmatter; the body is the
 * prompt and $ARGUMENTS is the placeholder — the same convention Claude
 * commands already use, so bodies pass through unchanged.
 */
export function convertKimiPluginCommandMd(src: string, category: string, fallbackName: string): string {
  const { fm, body } = splitFrontmatter(src);
  let out = fm
    .replace(/^allowed-tools\s*:.*(\r?\n|$)/im, '')
    .replace(/^argument-hint\s*:.*(\r?\n|$)/im, '')
    .replace(/^model\s*:\s*(?!.*\/).*/im, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!getFmScalar(out, 'description')) {
    out = ensureFmKey(out, 'description', category + ' ' + fallbackName + ' command (monomind)');
  }
  return '---\n' + out + '\n---\n\n' + body.trimStart();
}

/** Namespace-prefixed command filename: "mastermind-build.md". */
export function kimiCommandFilename(category: string, file: string): string {
  const base = file.replace(/\.md$/i, '');
  return slugifyName(category + '-' + base) + '.md';
}

/**
 * Generate AGENTS.md for kimi — workspace instructions (CLAUDE.md equivalent).
 * Only written when no AGENTS.md exists (the opencode target may already have
 * written one; both are generic monomind instructions).
 */
export function generateKimiAgentsMd(): string {
  const lines = [
    '# AGENTS.md — Monomind on Kimi Code',
    '',
    'Monomind is wired in as an MCP server (see .kimi-code/mcp.json). Its tools are',
    'available as `mcp__monomind__*`: `monograph_query`, `monograph_suggest`,',
    '`monograph_impact`, `memory_kg_search`, `memory_pattern-store`, and more.',
    '',
    '## Code navigation — graph first',
    'Call `mcp__monomind__monograph_query` / `monograph_suggest` BEFORE grep/rg/find',
    'for code exploration. They return file path + line number from a SQLite knowledge',
    'graph. Only fall back to grep if monograph returns nothing or the graph isn’t built.',
    '',
    '## Memory',
    'Persist insights across sessions: `mcp__monomind__memory_pattern-store` to save,',
    '`mcp__monomind__memory_kg_search` to recall. Use namespacing to keep project/agent',
    'memory separate.',
    '',
    '## Hooks & slash commands (optional plugin)',
    'Project-level hooks are not supported by kimi (only user config.toml or plugins).',
    'To enable monomind hooks and /monomind:* slash commands, install the generated',
    'plugin once: `/plugins install ./.kimi-code/plugin`, then `/reload`.',
    '',
    '## Security',
    '- NEVER hardcode secrets/keys in source. NEVER commit .env.',
    '- Always validate input at system boundaries.',
    '- Run `npx monomind@latest security scan` after security-related changes.',
    '',
    '## Conventions',
    '- Agents live in `.kimi-code/agents/`, skills in `.kimi-code/skills/`.',
    '- Claude commands are also present as flow skills: /skill:<category>-<name>.',
    '- For multi-file work, dispatch parallel sub-agents via the Agent tool.',
    '- Project-specific run/test/lint commands are in `.agents/shared_instructions.md`.',
    '',
    '## Autonomous orgs',
    'Set MONOMIND_RUNTIME=kimicode to run org roles on the kimi CLI backend, then:',
    '```bash',
    'monomind org run <name> --task "..."',
    '```',
    '',
    '## Build & test',
    '```bash',
    'npm run build && npm test && npm run lint',
    '```',
    '',
  ];
  return lines.join('\n') + '\n';
}

// ─── Statusline (footer under the chatbox) ─────────────────────────────────
//
// Kimi supports a custom status line: [status_line].command in
// ~/.kimi-code/tui.toml. Kimi runs the command with a JSON snapshot on stdin
// (model, cwd, git branch, permission mode, plan mode, context usage,
// session id, version) and renders the FIRST stdout line as the footer.
// Runs are capped at 300ms and throttled to once per second; a failure (or
// no output) falls back to the built-in layout, so this script exits quietly
// whenever the project has no monomind statusline.

/**
 * Generate ~/.kimi-code/statusline.sh — reads the cwd out of kimi's stdin
 * JSON snapshot and delegates to that project's monomind statusline helper,
 * printing only the first line (kimi ignores the rest). Exits 0 with no
 * output when there's nothing to show (kimi then keeps its built-in layout).
 *
 * The script must be free of backticks and ${...} outside its own template
 * usage — it is embedded into a TypeScript template literal by the caller.
 */
export function generateKimiStatuslineSh(): string {
  return `#!/usr/bin/env bash
# monomind statusline for Kimi Code (generated by monomind init --kimicode).
# Kimi passes a JSON snapshot on stdin (model, cwd, git branch, ...); we only
# need the cwd to find the project's monomind statusline helper.
INPUT=$(cat)

PROJECT_DIR=$(printf '%s' "$INPUT" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  try{const j=JSON.parse(d);console.log(j.cwd||j.working_dir||j.project_dir||'')}catch(e){console.log('')}
});" 2>/dev/null)
[ -z "$PROJECT_DIR" ] && PROJECT_DIR="$(pwd)"

if [ -f "$PROJECT_DIR/.claude/helpers/statusline.cjs" ]; then
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" node "$PROJECT_DIR/.claude/helpers/statusline.cjs" 2>/dev/null | head -1
elif [ -f "$PROJECT_DIR/.gemini/helpers/statusline.cjs" ]; then
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" node "$PROJECT_DIR/.gemini/helpers/statusline.cjs" 2>/dev/null | head -1
fi
# No output otherwise — kimi falls back to its built-in status layout.
`;
}

/**
 * Merge [status_line].command into a tui.toml file WITHOUT clobbering:
 * - existing [status_line] with a command → unchanged (user's choice wins)
 * - existing [status_line] without a command → command inserted into the section
 * - no [status_line] section → appended at the end
 * Anything else in the file is preserved byte-for-byte.
 */
export function mergeKimiTuiTomlStatusline(existing: string, command: string): string {
  const sectionRe = /^\s*\[status_line\]\s*$/m;
  const commandLine = 'command = "' + command + '"';

  if (sectionRe.test(existing)) {
    const sectionStart = existing.search(sectionRe);
    // Find the end of this section: next [section] header or EOF
    const rest = existing.slice(sectionStart);
    const nextSection = rest.slice(rest.indexOf('\n') + 1).search(/^\s*\[/m);
    const sectionEnd = nextSection === -1 ? existing.length : sectionStart + rest.indexOf('\n') + 1 + nextSection;
    const section = existing.slice(sectionStart, sectionEnd);
    if (/^\s*command\s*=/m.test(section)) return existing; // user already has one
    return existing.slice(0, sectionEnd).replace(/\s*$/, '\n') + commandLine + '\n' + existing.slice(sectionEnd);
  }

  const sep = existing.length && !existing.endsWith('\n') ? '\n' : '';
  return existing + sep + (existing.length ? '\n' : '') + '[status_line]\n' + commandLine + '\n';
}

// ─── Tier 2: hook gate bridge script ───────────────────────────────────────
//
// Kimi hooks and Claude hooks share the same protocol: JSON payload on stdin,
// exit 0 = allow, exit 2 = block with the reason on stderr. This script
// translates kimi's PreToolUse payload into the {tool_name, tool_input}
// envelope the existing .claude/helpers/hook-handler.cjs gates consume, and
// maps their exit code straight back. Nothing in .claude/helpers is modified.
//
// The script must be free of backticks and ${...} outside its own template
// usage — it is embedded into a TypeScript template literal by the caller.

export function generateKimiGateScript(): string {
  return `// monomind gate bridge for Kimi Code hooks (generated by monomind init --kimicode).
// Reads kimi's hook payload on stdin, forwards to .claude/helpers/hook-handler.cjs,
// maps exit code 2 back to a block. Fails OPEN when the handler is absent or errors,
// matching both platforms' "hook errors never block" policy.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

let input = "";
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  let payload = {};
  try { payload = JSON.parse(input || "{}"); } catch (e) { process.exit(0); }
  const cwd = payload.cwd || process.cwd();
  const handler = path.join(cwd, ".claude", "helpers", "hook-handler.cjs");
  if (!fs.existsSync(handler)) process.exit(0); // gates not installed -> nothing to enforce

  const tool = payload.tool_name || "";
  let event = null;
  let gateInput = {};
  if (tool === "Bash") {
    event = "pre-bash";
    gateInput = { command: payload.tool_input && payload.tool_input.command };
  } else if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
    event = "pre-write";
    gateInput = payload.tool_input || {};
  }
  if (!event) process.exit(0);

  let r;
  try {
    r = spawnSync(process.execPath, [handler, event], {
      input: JSON.stringify({ tool_name: tool, tool_input: gateInput, session_id: payload.session_id || "" }),
      encoding: "utf-8",
      timeout: 5000,
      cwd: cwd,
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: cwd }),
    });
  } catch (e) {
    process.exit(0);
  }
  if (!r || r.status !== 2) process.exit(0);

  let reason = "blocked by monomind gate";
  const lines = (r.stderr || "").split("\\n");
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && obj.decision === "block" && obj.reason) { reason = obj.reason; break; }
    } catch (e) {}
  }
  console.error("[monomind] " + reason);
  process.exit(2);
});
`;
}

// ─── Tier 3: plugin manifest ───────────────────────────────────────────────

/**
 * Generate kimi.plugin.json for the self-contained plugin directory
 * (.kimi-code/plugin/). The manifest deliberately declares only `commands`
 * and `hooks`:
 *   - skills/agents stay project-level (.kimi-code/skills, .kimi-code/agents)
 *     so they work with zero install — no duplication inside the plugin.
 *   - mcpServers stays in project .kimi-code/mcp.json to avoid a duplicate
 *     "monomind" server when both the project config and the plugin load.
 *   - hooks are the plugin's whole reason to exist: kimi has no project-level
 *     hooks, so the gate bridge only runs while the plugin is enabled — which
 *     also means disabling the plugin cleanly disables monomind enforcement.
 */
export function generateKimiPluginManifest(options: InitOptions): string {
  const manifest = {
    name: 'monomind',
    version: '1.0.0',
    description: 'Monomind hooks and commands for Kimi Code (knowledge graph, memory, gates)',
    commands: './commands/',
    hooks: [
      {
        event: 'PreToolUse',
        matcher: 'Bash',
        command: 'node ./hooks/monomind-gate.mjs',
        timeout: 5,
      },
      {
        event: 'PreToolUse',
        matcher: '^(Write|Edit|MultiEdit)$',
        command: 'node ./hooks/monomind-gate.mjs',
        timeout: 5,
      },
    ],
    interface: {
      displayName: 'Monomind',
      shortDescription: 'Knowledge graph, memory, and gate hooks for kimi',
    },
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * opencode Configuration Generator
 *
 * Emits an `opencode.json` that wires monomind's MCP server into opencode,
 * plus permission rules mirroring the Claude Code allow/deny list.
 *
 * ADDITIVE ONLY: this target is opt-in via `components.opencode` (default
 * false). Default `monomind init` (Claude + Antigravity) is byte-identical
 * whether or not this generator exists — it only runs when the flag is set.
 *
 * opencode schema reference: https://opencode.ai/config.json
 *   - `mcp[name].command` is an array of strings, `type` is required
 *   - `permission` per-tool: either an action string or { pattern: action };
 *     opencode evaluates the LAST matching rule, so broad rules go first,
 *     narrow rules go last.
 */

import type { InitOptions } from './types.js';

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';

function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * opencode MCP `command` is always a string array. On Windows we prepend
 * `cmd /c` (mirrors mcp-generator.ts' cross-platform handling).
 */
function monomindCommand(): string[] {
  const base = ['-y', 'monomind@latest', 'mcp', 'start'];
  return isWindows() ? ['cmd', '/c', 'npx', ...base] : ['npx', ...base];
}

/**
 * Build the opencode.json config object.
 */
export function generateOpencodeConfig(options: InitOptions): Record<string, unknown> {
  const config: Record<string, unknown> = {
    $schema: OPENCODE_SCHEMA,
    // opencode loads AGENTS.md (its CLAUDE.md equivalent) via this array.
    // .agents/shared_instructions.md is the tool-agnostic project context that
    // monomind already generates for every target — reuse it verbatim.
    instructions: ['AGENTS.md', '.agents/shared_instructions.md'],
  };

  // MCP server — identical stdio server Claude Code consumes via .mcp.json.
  // opencode reads this from its own config; .mcp.json is untouched.
  if (options.mcp.monomind) {
    config.mcp = {
      monomind: {
        type: 'local',
        command: monomindCommand(),
        enabled: true,
        env: {
          npm_config_update_notifier: 'false',
          MONOMIND_MODE: 'v1',
          MONOMIND_HOOKS_ENABLED: 'true',
          MONOMIND_TOPOLOGY: options.runtime.topology,
          MONOMIND_MAX_AGENTS: String(options.runtime.maxAgents),
          MONOMIND_MEMORY_BACKEND: options.runtime.memoryBackend,
        },
      },
    };
  }

  // Permission rules — mirrors .claude/settings.json allow/deny.
  // opencode: LAST matching rule wins → broad first, narrow last.
  config.permission = {
    bash: {
      '*': 'ask',
      'npx monomind *': 'allow',
      'npx -y monomind *': 'allow',
      'npx monomind@*': 'allow',
      'npx @monomind/*': 'allow',
    },
    read: {
      '*': 'allow',
      './.env': 'deny',
      './.env.*': 'deny',
    },
  };

  return config;
}

/**
 * Generate opencode.json as a formatted string.
 */
export function generateOpencodeJson(options: InitOptions): string {
  return `${JSON.stringify(generateOpencodeConfig(options), null, 2)}\n`;
}

// ─── Tier 2: frontmatter converters (.claude/* → .opencode/*) ──────────────
//
// All transforms are minimal and additive. They keep monomind's own metadata
// (e.g. the capability: block on agents) intact — opencode routes unknown
// frontmatter keys into options, so they are inert but preserved. We only
// ensure the handful of keys opencode actually reads are present and correct.

interface SplitMd {
  fm: string; // raw frontmatter body (between the --- fences), no fences
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
  const re = new RegExp(`^${key}\\s*:`, 'm');
  if (re.test(fm)) return fm;
  const line = `${key}: ${value}`;
  if (!fm.trim()) return line;
  // Append after the description line if present (keeps readable order),
  // otherwise at the top.
  const descIdx = fm.search(/^description\s*:/m);
  if (descIdx >= 0) {
    const eol = fm.indexOf('\n', descIdx);
    return eol < 0 ? `${fm}\n${line}` : `${fm.slice(0, eol + 1) + line}\n${fm.slice(eol + 1)}`;
  }
  return `${line}\n${fm}`;
}

/** Set (replace-or-insert) a top-level scalar `key: value`. */
function setFmKey(fm: string, key: string, value: string): string {
  const re = new RegExp(`^${key}\\s*:.*$`, 'm');
  if (re.test(fm)) return fm.replace(re, `${key}: ${value}`);
  return ensureFmKey(fm, key, value);
}

/** Slugify a name into a safe lowercase-hyphen identifier (opencode convention).
 *  Also guarantees a filesystem-safe filename (no path separators). */
function slugifyName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'agent';
}

function getFmScalar(fm: string, key: string): string | null {
  const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

/**
 * Convert a Claude agent definition to opencode agent format.
 * - Ensures mode: subagent (these are Task-tool subagents).
 * - Keeps name, description, and the capability: metadata block.
 * - If no description, derives one from the name so opencode doesn't drop it.
 */
export function convertAgentMd(src: string, fallbackName: string): string {
  const { fm, body, hasFm } = splitFrontmatter(src);
  // Slugify the name: opencode wants lowercase-hyphen identifiers, and this
  // also guarantees a filesystem-safe filename (agent names like "LSP/Index
  // Engineer" would otherwise leak a path separator into the dest path).
  const rawName = (getFmScalar(fm, 'name') || fallbackName).trim();
  const name = slugifyName(rawName);
  let out = fm;
  out = setFmKey(out, 'name', name);
  if (!getFmScalar(out, 'description')) {
    out = ensureFmKey(out, 'description', `${name} agent (monomind)`);
  }
  out = ensureFmKey(out, 'mode', 'subagent');
  if (hasFm || fm) {
    return `---\n${out}\n---\n${body}`;
  }
  return (
    '---\nname: ' +
    name +
    '\ndescription: ' +
    name +
    ' agent (monomind)\nmode: subagent\n---\n' +
    body
  );
}

/**
 * Convert a Claude slash-command to opencode command format.
 * - Keeps description; drops Claude-only keys (allowed-tools, argument-hint).
 * - The category dir becomes a filename prefix so /mastermind:build survives
 *   as /mastermind-build (opencode commands are a flat namespace).
 */
export function convertCommandMd(src: string, category: string, fallbackName: string): string {
  const { fm } = splitFrontmatter(src);
  // Strip Claude-only frontmatter keys opencode doesn't understand.
  let out = fm
    .replace(/^allowed-tools\s*:.*(\r?\n|$)/im, '')
    .replace(/^argument-hint\s*:.*(\r?\n|$)/im, '')
    .replace(/^model\s*:\s*(?!anthropic\/).*/im, '') // drop bare claude model names
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!getFmScalar(out, 'description')) {
    out = ensureFmKey(out, 'description', `${category} ${fallbackName} command (monomind)`);
  }
  const { body } = splitFrontmatter(src);
  return `---\n${out}\n---\n\n${body.trimStart()}`;
}

/** Namespace-prefixed command filename: "mastermind-build.md". */
export function opencodeCommandFilename(category: string, file: string): string {
  const base = file.replace(/\.md$/i, '');
  return `${category}-${base}.md`;
}

/**
 * Convert a SKILL.md. opencode and Claude use the same SKILL.md shape
 * (name + description). Only ensures description exists, since opencode
 * filters out skills without one.
 */
export function convertSkillMd(src: string, fallbackName: string): string {
  const { fm, body, hasFm } = splitFrontmatter(src);
  let out = fm;
  out = ensureFmKey(out, 'name', fallbackName);
  if (!getFmScalar(out, 'description')) {
    out = ensureFmKey(out, 'description', `${fallbackName} skill (monomind)`);
  }
  if (hasFm || fm) {
    return `---\n${out}\n---\n${body}`;
  }
  return (
    '---\nname: ' +
    fallbackName +
    '\ndescription: ' +
    fallbackName +
    ' skill (monomind)\n---\n' +
    body
  );
}

/**
 * Generate the /monomind-status command — the opencode equivalent of the
 * Claude Code statusline. opencode has no custom statusbar UI, so this command
 * runs the SAME statusline.cjs (unchanged) and reports a formatted summary.
 * Reuses the helper verbatim; only the command wrapper is opencode-shaped.
 */
export function generateStatusCommand(): string {
  const lines = [
    '---',
    'description: Show the monomind statusline (version, git, swarm, security, hooks, token cost).',
    '---',
    '',
    'Run the monomind statusline and report project status. Execute exactly one of these (first that exists):',
    '',
    '1. `node .claude/helpers/statusline.cjs --compact`',
    '2. `npx -y monomind@latest hooks statusline --json`  (fallback if the helper is absent)',
    '',
    'Parse the JSON and present a concise, readable summary. Include these fields if present:',
    '- monomind version (if discoverable) and git branch',
    '- git: modified / untracked / staged / ahead / behind',
    '- swarm: activeAgents / maxAgents, coordinationActive',
    '- security: status, cvesFixed / totalCves',
    '- hooks: enabled / total',
    '- tokenCost: todayCost, monthCost, todayCalls',
    '',
    'Format as a compact table or tight bullet list. Report the numbers only — do not editorialize or add recommendations. If the command errors, say so and show the error.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Generate AGENTS.md — opencode's instructions file (CLAUDE.md equivalent).
 * Built as a joined string array so inline-code backticks are literal chars
 * (no template-literal escaping pitfalls).
 */
export function generateAgentsMd(): string {
  const lines = [
    '# AGENTS.md — Monomind on opencode',
    '',
    'Monomind is wired in as an MCP server (see opencode.json). Its tools are',
    'available as the `monomind` server: `monograph_query`, `monograph_suggest`,',
    '`monograph_impact`, `memory_pattern-search`, `memory_pattern-store`, and more.',
    '',
    '## Code navigation — graph first',
    'Call `monograph_query` / `monograph_suggest` BEFORE grep/rg/find for code',
    'exploration. They return file path + line number from a SQLite knowledge graph.',
    'Only fall back to grep if monograph returns nothing or the graph isn’t built.',
    '',
    'The graph gate enforces this on hook-capable platforms: the first grep/search',
    'in a session is blocked once until a monograph tool is called, then searches',
    'pass with a reminder. Opt out: .monomind/guidance/active-gates.json',
    '{"graphGate": "off"} or MONOMIND_GRAPH_GATE=off.',
    '',
    '## Memory',
    'Persist insights across sessions: `memory_pattern-store` to save, `memory_pattern-search` to',
    'recall. Use namespacing to keep project/agent memory separate.',
    '',
    '## Security',
    '- NEVER hardcode secrets/keys in source. NEVER commit .env.',
    '- Always validate input at system boundaries.',
    '- Run `npx monomind@latest security scan` after security-related changes.',
    '',
    '## Conventions',
    '- Agents live in `.opencode/agent/` (subagents), commands in `.opencode/command/`.',
    '- For multi-file work, spawn parallel subagents via the Task tool.',
    '- Project-specific run/test/lint commands are in `.agents/shared_instructions.md`.',
    '',
    '## Build & test',
    '```bash',
    'npm run build && npm test && npm run lint',
    '```',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Generate the opencode hook-shim plugin (Tier 3).
 *
 * opencode has no declarative hooks block; hooks come from TS plugins. This
 * plugin bridges monomind's existing Claude-Code CJS gate handlers
 * (.claude/helpers/hook-handler.cjs) into opencode's tool.execute.before event.
 * Blocking maps to throwing inside tool.execute.before (opencode's documented
 * mechanism — see the .env-protection plugin example).
 *
 * The handlers run UNCHANGED: the plugin only synthesises the {tool_name,
 * tool_input} envelope they already consume and maps exit-code-2 back to a
 * thrown error. Nothing in .claude/helpers is modified, so Claude Code's own
 * hook path is unaffected.
 *
 * Plugin body is intentionally free of backticks and ${...} so it embeds here
 * without template-literal escaping.
 */
export function generateHooksPlugin(): string {
  return `import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Locate the monomind gate handler. Lives beside the Claude tree; if absent
// (opencode-only install with no .claude/), the plugin no-ops (fail open).
function findHandler(worktree, directory) {
  const cands = [
    path.join(worktree || "", ".claude", "helpers", "hook-handler.cjs"),
    path.join(directory || "", ".claude", "helpers", "hook-handler.cjs"),
  ];
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  return null;
}

// Run one monomind gate event and translate its exit code into a decision.
// Claude Code protocol: exit 2 = block, JSON {decision,reason} on stderr.
// sessionId comes from opencode's tool.execute.before input (input.sessionID)
// — the graph gate latches "once per session", so it must be real.
function runGate(handler, event, toolName, input, cwd, sessionId) {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: input, session_id: sessionId || "" });
  let r;
  try {
    r = spawnSync(process.execPath, [handler, event], {
      input: payload,
      encoding: "utf-8",
      timeout: 5000,
      cwd: cwd,
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: cwd }),
    });
  } catch (e) {
    return { block: false };
  }
  if (!r || r.status !== 2) return { block: false };
  let reason = "blocked by monomind gate";
  try {
    const lines = (r.stderr || "").split("\\n");
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && obj.decision === "block" && obj.reason) { reason = obj.reason; break; }
      } catch (e) {}
    }
  } catch (e) {}
  return { block: true, reason: reason };
}

export const MonomindHooks = async (ctx) => {
  const directory = (ctx && ctx.directory) || process.cwd();
  const worktree = (ctx && ctx.worktree) || directory;
  const handler = findHandler(worktree, directory);

  return {
    "tool.execute.before": async (input, output) => {
      if (!handler) return; // handlers not installed -> nothing to enforce
      const tool = input && input.tool;
      const sessionId = (input && input.sessionID) || "";
      try {
        if (tool === "bash") {
          const res = runGate(handler, "pre-bash", "Bash", { command: output.args && output.args.command }, worktree, sessionId);
          if (res.block) throw new Error("[monomind] " + (res.reason || "bash blocked"));
        } else if (tool === "write" || tool === "edit" || tool === "multiedit") {
          const res = runGate(handler, "pre-write", "Write", output.args || {}, worktree, sessionId);
          if (res.block) throw new Error("[monomind] " + (res.reason || "write blocked"));
        } else if (tool === "grep" || tool === "glob") {
          // Graph-first gate: consult monograph before grep/glob for code
          // exploration (once-per-session block, then warn) — same rule as
          // Claude's pre-search hook.
          const res = runGate(handler, "pre-search", tool === "grep" ? "Grep" : "Glob", output.args || {}, worktree, sessionId);
          if (res.block) throw new Error("[monomind] " + (res.reason || "search blocked"));
        }
      } catch (e) {
        // Re-throw intentional gate blocks; swallow unexpected errors so a
        // handler bug can never hard-stop the user's tool.
        if (e && typeof e.message === "string" && e.message.indexOf("[monomind]") === 0) throw e;
      }
    },
  };
};
`;
}

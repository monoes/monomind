import { spawnSync } from "node:child_process";
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
    const lines = (r.stderr || "").split("\n");
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

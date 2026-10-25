import { execFile, spawnSync } from "node:child_process";
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


// Locate a helper beside the Claude tree; absent -> the mesh hooks no-op.
function findHelper(worktree, directory, name) {
  for (const base of [worktree || "", directory || ""]) {
    const c = path.join(base, ".claude", "helpers", name);
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  return null;
}

// Run a mesh helper with node (process.execPath is opencode itself in a compiled build); "" on any failure.
function meshRun(file, cwd, input) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    try {
      const child = execFile("node", [file], { cwd: cwd, encoding: "utf-8", timeout: 2500 }, (err, stdout) => {
        resolve(err ? "" : String(stdout || "").trim());
      });
      child.stdin.end(input || "");
    } catch (e) { resolve(""); }
  });
}

// Run one monomind gate event and translate its exit code into a decision.
// Claude Code protocol: exit 2 = block, JSON {decision,reason} on stderr.
// sessionId comes from opencode's tool.execute.before input (input.sessionID)
// — the graph gate latches "once per session", so it must be real.
function runGate(handler, event, toolName, input, cwd, sessionId) {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: input, session_id: sessionId || "" });
  // Inside a monomind org role, quiet the hook handler. Set here, on the
  // handler process only: this plugin runs inside opencode, whose shell tool
  // inherits opencode's env, so a role-wide setting would reach every command.
  const orgRoleEnv = process.env.MONOMIND_ORG_ROLE
    ? { MONOMIND_HOOK_QUIET: "1", MONOMIND_GRAPH_GATE: "off", MONOMIND_SDK_AGENT: "1" }
    : {};
  let r;
  try {
    r = spawnSync(process.execPath, [handler, event], {
      input: payload,
      encoding: "utf-8",
      timeout: 5000,
      cwd: cwd,
      env: Object.assign({}, process.env, orgRoleEnv, { CLAUDE_PROJECT_DIR: cwd }),
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
    // Mesh inbox: unread messages from other agents ride along with the user's prompt.
    "chat.message": async (input, output) => {
      const text = await meshRun(findHelper(worktree, directory, "mesh-inbox.cjs"), worktree, "");
      if (!text || !output || !output.message || !Array.isArray(output.parts)) return;
      const id = "prt_" + (Date.now() * 4096).toString(16).padStart(12, "0") + Math.random().toString(36).slice(2, 16).padEnd(14, "0");
      output.parts.push({ id: id, sessionID: input.sessionID, messageID: output.message.id, type: "text", text: text, synthetic: true });
    },
    // Mesh name: title a new top-level session with the name it has on the mesh.
    event: async ({ event }) => {
      const info = event && event.type === "session.created" && event.properties && event.properties.info;
      if (!info || info.parentID || !ctx || !ctx.client) return;
      const out = await meshRun(findHelper(worktree, directory, "mesh-title.cjs"), worktree, JSON.stringify({ cwd: worktree }));
      try {
        const title = JSON.parse(out).hookSpecificOutput.sessionTitle;
        if (title) await ctx.client.session.update({ path: { id: info.id }, body: { title: title } });
      } catch (e) {}
    },

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

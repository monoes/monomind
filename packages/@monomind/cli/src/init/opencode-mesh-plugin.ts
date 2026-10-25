/**
 * The Monomind Mesh half of the opencode hook-shim plugin (see generateHooksPlugin).
 *
 * opencode runs plugins inside its own process, so the mesh helpers (.claude/helpers/mesh-inbox.cjs
 * and mesh-title.cjs, unchanged) are started as its children: their ancestor walk finds the
 * credentials the MCP server left under opencode's pid. Both fragments are free of backticks and
 * dollar-brace sequences so they embed in a template literal without escaping.
 */

/** Module-scope helpers; the plugin imports execFile from node:child_process. */
export const MESH_PLUGIN_HELPERS = `
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
`;

/** Hook entries for the object the plugin returns (each ends with a comma). */
export const MESH_PLUGIN_HOOKS = `
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
`;

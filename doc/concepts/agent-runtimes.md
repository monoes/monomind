# Agent Runtimes

Org roles and `monomind agent exec` run on whichever coding agent you have installed, through the [Agent Exec Protocol](../agent-exec-protocol.md): one turn in, NDJSON events out, the same shape for every runtime.

```bash
monomind agent scan                              # which runtimes are installed (19 known: claude, codex, opencode, kimicode, kilo, qwen, grok, copilot, hermes, aider, …)
monomind agent models --runtime codex --json     # a runtime's own model list
monomind agent test claude --json                # smoke-test a runtime with one tiny turn
monomind agent exec --runtime codex --prompt "summarize ./README" --effort high
```

| Flag | Purpose |
|---|---|
| `--access scoped\|read\|full` | Allow-list only (default), read-only, or unrestricted native tools. `full` is coder mode: it needs `--cwd`, refuses root, kills the whole process tree on stop or timeout, and writes an audit record per run. In an org, set `policy.access: "full"` on a role. |
| `--sandbox <mode>` / `--sandbox-fallback` | Use the vendor CLI's own sandbox; choose what happens when a runtime lacks the mode. |
| `--effort off\|low\|medium\|high\|xhigh\|max` | Reasoning effort, mapped per runtime. |
| `--settings none\|user,project,local` | Let Claude load your CLAUDE.md, skills, hooks and MCP servers. |
| `--attach <file>` | Send a file with the prompt (repeatable, up to 10, 20 MB each): Claude sees images and PDFs directly, Codex sees images, other runtimes get the file paths. |
| `--claude-path <file\|bundled>` | Choose the Claude Code binary (also `MONOMIND_CLAUDE_PATH` or `monomind config set claude.path`). |

In coder mode the model and effort you select win over `CLAUDE_CODE_EFFORT_LEVEL` in your settings, and a subagent launch that names a different model is refused. `MONOMIND_CODER_MAX_AGENTS` (default 40) and `MONOMIND_CODER_MAX_REVIEW_AGENTS` (default 12) cap how many subagents a turn may launch; 0 turns a cap off. Threat model: [Coder mode security](../concepts/coder-mode-security.md).

Project: monomind (nokhodian/monomind)
Stack: Node.js/TypeScript monorepo, pnpm workspaces, macOS darwin
Key packages: @monomind/cli (41 commands), @monomind/graph, @monomind/memory (AgentDB+HNSW)
Runtime layer: .claude/helpers/*.cjs — only actually-running code (TS packages have build errors)
Working style: 1 message = all parallel operations; Task tool for agents; MCP tools for coordination only
Memory palace: .monomind/palace/ — drawers.jsonl, closets.jsonl, kg.json
Git remote: git@github.com:nokhodian/monomind.git, main branch

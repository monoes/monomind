Project: monobrain (nokhodian/monobrain)
Stack: Node.js/TypeScript monorepo, pnpm workspaces, macOS darwin
Key packages: @monobrain/cli (41 commands), @monobrain/graph, @monobrain/memory (AgentDB+HNSW)
Runtime layer: .claude/helpers/*.cjs — only actually-running code (TS packages have build errors)
Working style: 1 message = all parallel operations; Task tool for agents; MCP tools for coordination only
Memory palace: .monobrain/palace/ — drawers.jsonl, closets.jsonl, kg.json
Git remote: git@github.com:nokhodian/monobrain.git, main branch

# Graphify (safishamsi/graphify)

**Source:** https://github.com/safishamsi/graphify  
**Category:** Knowledge Graph Construction  
**Role in Monobrain:** AST-based node/edge extraction, Louvain community detection, GRAPH_REPORT.md format — foundation for @monoes/graph

---

## What It Is

Graphify is a tool that constructs knowledge graphs from codebases using Abstract Syntax Tree (AST) analysis. It extracts entities (functions, classes, modules, variables) as graph nodes and relationships (calls, imports, inherits, uses) as edges, then applies Louvain community detection to identify clusters of closely related code.

## What We Extracted

### 1. AST-Based Node/Edge Extraction
Graphify's approach of parsing source files with AST analysis rather than regex or textual heuristics produces semantically accurate graphs. Monobrain's `@monoes/graph` package (`packages/@monobrain/graph/`) adopted this approach: the graph construction pipeline parses TypeScript/JavaScript files via AST, extracting:
- **Nodes**: functions, classes, interfaces, type aliases, exported constants
- **Edges**: import relationships, function calls, class inheritance, type references

This produces a graph where "A calls B" means the AST actually found a function invocation, not just that A and B appear near each other in the text.

### 2. Community Detection with Louvain
Graphify uses the Louvain algorithm to detect communities of closely related nodes — groups of files/functions that form natural architectural boundaries. Monobrain's `@monoes/graph` applies Louvain community detection to identify:
- Domain boundaries (DDD bounded contexts)
- Module cohesion clusters
- Architectural layers (UI, business logic, data access)

The community structure feeds the `[ARCH]` statusline row's "DDD domain coverage" metric.

### 3. `GRAPH_REPORT.md` Report Format
Graphify's `GRAPH_REPORT.md` output format — a markdown file summarizing the graph's key metrics, top nodes by centrality, detected communities, and relationships — was adopted as the output format for `@monoes/graph`'s pipeline. Running `npx monobrain@latest graphify analyze` produces a `GRAPH_REPORT.md` in the project root with the same structure.

## How It Improved Monobrain

Graphify proved that codebase understanding at the graph level — rather than the file or line level — enables qualitatively better routing decisions. When the routing system knows that `auth.ts` is in the same community as `session.ts` and `token.ts`, it can route a task about "fix the login bug" to a security-specialist agent rather than a generic coder, because the graph shows the login system is tightly coupled to the auth/session/token cluster.

## Key Files Influenced

- `packages/@monobrain/graph/src/index.ts` — graph construction entry point
- `packages/@monobrain/graph/src/pipeline.ts` — AST extraction pipeline
- `packages/@monobrain/cli/src/mcp-tools/graphify-tools.ts` — MCP tool wrappers
- `packages/@monobrain/graph/src/visualize.ts` — graph report generation

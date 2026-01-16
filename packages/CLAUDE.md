# Module Development

This directory contains the V1 monorepo packages. Root CLAUDE.md rules apply here.

## Build & Test

```bash
# From packages/@monobrain/<package>
npm install && npm run build && npm test
```

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@monobrain/cli` | `@monobrain/cli/` | CLI entry point (26 commands, 140+ subcommands) |
| `@monobrain/guidance` | `@monobrain/guidance/` | Governance control plane (compile, enforce, prove, evolve) |
| `@monobrain/hooks` | `@monobrain/hooks/` | 17 hooks + 12 background workers |
| `@monobrain/memory` | `@monobrain/memory/` | AgentDB + HNSW vector search |
| `@monobrain/shared` | `@monobrain/shared/` | Shared types and utilities |
| `@monobrain/security` | `@monobrain/security/` | Input validation, path security, CVE remediation |

## Code Quality

- Files under 500 lines
- No hardcoded secrets
- Input validation at system boundaries
- Typed interfaces for all public APIs
- TDD London School (mock-first) preferred
- Event sourcing for state changes

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| HNSW Search | 150x-12,500x faster | Implemented |
| Memory Reduction | 50-75% (Int8 quantization) | Implemented |
| MCP Response | <100ms | Achieved |
| CLI Startup | <500ms | Achieved |
| Flash Attention | 2.49x-7.47x speedup | In progress |

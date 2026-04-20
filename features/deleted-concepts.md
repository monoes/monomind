# Deleted Concepts — Future Implementation Reference

> **Note (2026-04-20):** This document references `@monobrain/swarm` and `@monobrain/plugins` which were deleted in the Round 12 cleanup. See `docs/tododeleted.md` for details.

Algorithms, systems, and plugins removed during the cleanup (Apr 2026) that had genuine value but zero consumers. Preserved here for future reimplementation.

---

## Plugins (10 deleted — all had real implementations, 2,500-3,500 LOC each)

### Healthcare Clinical (`@monobrain/plugin-healthcare-clinical`)
- **What:** HIPAA-compliant clinical decision support
- **Algorithms:** Patient similarity via HNSW (150x faster), drug interaction checking via GNN, clinical pathway recommendations
- **Ontologies:** ICD-10, SNOMED-CT, LOINC, RxNorm navigation
- **Use case:** Build a medical AI assistant that respects patient data privacy
- **Rebuild as:** MCP tool set (`healthcare_*`) or standalone skill

### Financial Risk (`@monobrain/plugin-financial-risk`)
- **What:** Portfolio risk analysis with regulatory compliance
- **Algorithms:** VaR, CVaR, Sharpe ratio, Sortino ratio, anomaly detection
- **Compliance:** Basel III, MiFID II, SOX audit logging
- **Use case:** Financial AI agent that needs risk-aware decision making
- **Rebuild as:** MCP tool set (`financial_*`)

### Legal Contracts (`@monobrain/plugin-legal-contracts`)
- **What:** Contract analysis with clause extraction
- **Algorithms:** DAG-based obligation tracking, attention-based clause alignment, risk scoring
- **Use case:** AI-assisted contract review, playbook matching
- **Rebuild as:** MCP tool set (`legal_*`)

### Code Intelligence (`@monobrain/plugin-code-intelligence`)
- **What:** Semantic code search and architecture analysis
- **Algorithms:** GNN bridge for code graph analysis, MinCut bridge for module splitting, pattern learning
- **Use case:** Deep codebase understanding beyond grep — semantic similarity, refactoring impact
- **Rebuild as:** Extend `graphify` MCP tools with semantic search

### Test Intelligence (`@monobrain/plugin-test-intelligence`)
- **What:** Predictive test selection and flaky test detection
- **Algorithms:** ML-driven test prioritization via RL, SONA pattern learning for test outcomes, mutation testing optimization
- **Use case:** CI pipeline that runs only relevant tests (save 60-80% test time)
- **Rebuild as:** Hook in `post-edit` that suggests test subsets based on changed files

### Performance Optimizer (`@monobrain/plugin-perf-optimizer`)
- **What:** Bottleneck detection, memory leak analysis, query optimization
- **Algorithms:** Trace analysis with SONA learning, bundle size optimization, config tuning
- **Why deleted:** Overlapped with hooks `benchmark` worker + `performance` MCP tools + `@monobrain/performance` package (3 existing systems)
- **Rebuild as:** Not needed — existing systems cover this

### Neural Coordination (`@monobrain/plugin-neural-coordination`)
- **What:** Multi-agent swarm coordination using neural consensus
- **Algorithms:** Neural voting protocols, EWC++ consolidation, emergent protocol learning, topology optimization via attention
- **Use case:** Swarms that learn optimal communication patterns over time
- **Rebuild as:** Extension to `hive-mind` MCP tools

### Cognitive Kernel (`@monobrain/plugin-cognitive-kernel`)
- **What:** Working memory, attention control, meta-cognition for LLMs
- **Algorithms:** Miller's 7±2 memory model, SONA integration, attention scaffolding
- **Use case:** Agent that manages its own cognitive resources (knows when it's confused, when to ask for help)
- **Rebuild as:** Hook in `pre-task` that assesses task cognitive load

### Quantum Optimizer (`@monobrain/plugin-quantum-optimizer`)
- **What:** Quantum-inspired optimization for combinatorial problems
- **Algorithms:** QUBO formulation, QAOA simulation, Grover-inspired search, simulated annealing with temperature scheduling, variational optimization
- **Use case:** Scheduling, dependency resolution, resource allocation problems too complex for greedy algorithms
- **Rebuild as:** MCP tool `quantum_optimize` wrapping the core algorithms

### Hyperbolic Reasoning (`@monobrain/plugin-hyperbolic-reasoning`)
- **What:** Poincaré ball embeddings for hierarchical reasoning
- **Algorithms:** Möbius transforms, LCA (Lowest Common Ancestor) computation, geodesic attention, taxonomy comparison, entailment graphs
- **Why unique:** Standard embeddings lose hierarchy — hyperbolic space preserves tree structure naturally
- **Note:** `@monobrain/embeddings` still has basic hyperbolic mode; this plugin added the reasoning layer on top
- **Use case:** Ontology navigation, taxonomy-aware search, hierarchical classification
- **Rebuild as:** Extension to `embeddings` MCP tools with `embeddings_hyperbolic_reason`

---

## Packages (6 deleted)

### `@monobrain/codex` (14 files)
- **What:** OpenAI Codex dual-mode integration (Claude + Codex in parallel)
- **Use case:** Run Claude for architecture + Codex for implementation concurrently
- **Why deleted:** Codex product deprecated by OpenAI; integration was never built
- **Rebuild as:** Not needed unless OpenAI relaunches similar product

### `@monobrain/providers` (12 files)
- **What:** Multi-LLM provider abstraction (Anthropic, OpenAI, Google, Cohere, Ollama)
- **Why deleted:** `agentic-flow` already handles multi-provider routing as optional dependency
- **Rebuild as:** Not needed — use `agentic-flow` directly

### `@monobrain/testing` (36 files)
- **What:** TDD London School framework with mock factories, fixtures, regression runners
- **Why deleted:** Teams use vitest directly; framework was never imported
- **Rebuild as:** Not needed — vitest + standard patterns sufficient

### `@monobrain/deployment` (6 files)
- **What:** Release manager, publisher, validator for npm package deployment
- **Why deleted:** Minimal implementation, never built
- **Rebuild as:** GitHub Actions workflow or CLI command if needed

### `@monobrain/integration` (20 files)
- **What:** Deep agentic-flow bridge — SDK adapter, worker pool, SONA adapter, token optimizer
- **Why deleted:** CLI handles agentic-flow via optional dependency with lazy loading; this package was a parallel implementation
- **Rebuild as:** Not needed — cli/src/services/agentic-flow-bridge.ts is the active bridge

### `@monobrain/agents` (5 YAML files)
- **What:** YAML agent config templates (architect, coder, reviewer, security-architect, tester)
- **Why deleted:** Not a real package; agent definitions live in `.claude/agents/` as markdown
- **Rebuild as:** Not needed

---

## CLI Commands (12 stubs deleted)

All returned fake "placeholder" success messages. Listed here in case real implementations are wanted:

| Command | What it would do | Rebuild priority |
|---------|-----------------|-----------------|
| `cost` | Token cost tracking and budget alerts | LOW — `/tokens` slash command covers this |
| `dlq` | Dead letter queue inspection for failed tasks | MEDIUM — useful for debugging swarm failures |
| `eval` | Evaluation traces and dataset management | LOW — vitest covers testing |
| `knowledge` | Knowledge base add/search/list | LOW — memory commands + knowledge indexing in hooks cover this |
| `scores` | Agent specialization scores from SpecializationScorer | MEDIUM — data exists in hooks, no UI |
| `consensus` | Consensus audit trail inspection | LOW — hive-mind status covers this |
| `flows` | Communication flow visualization | LOW — no flow enforcer active |
| `agent-version` | Version control for agent configs | LOW — git handles versioning |
| `prompt` | Prompt version rollback | LOW — git handles versioning |
| `tools` | Tool impact analysis | LOW — no tool deprecation tracking active |
| `registry` | Agent registry query/validate/conflicts | MEDIUM — registry.json exists but has no query UI |
| `metrics` | Latency reporting and summary | LOW — statusline + /tokens cover this |

---

## Config Keys (8 deleted from settings.json)

| Key | What it would do | Status |
|-----|-----------------|--------|
| `monobrain.modelPreferences` | Static model routing overrides | Not needed — pre-task dynamic scoring is better |
| `monobrain.agentTeams.*` | Custom agent team coordination | Not needed — Claude Code native Task tool handles this |
| `monobrain.ddd.*` | DDD bounded context validation | Would need a DDD model defined first |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Feature flag | Not needed — env var never checked |
| `MONOBRAIN_v1_ENABLED` | Feature flag | Not needed — env var never checked |
| `MONOBRAIN_HOOKS_ENABLED` | Feature flag | Not needed — hooks fire via settings.json definitions |

**Kept and wired:**
- `monobrain.neural.enabled` — now a real kill switch for intelligence.init()
- `monobrain.adr.autoGenerate` — now auto-creates ADR stubs after architect tasks

---

## Structural Cleanup (Round 6)

### `packages/src/` (23 DDD files — deleted)
- **What:** Early DDD implementation with Agent lifecycle, SwarmCoordinator, SQLiteBackend, HybridBackend, MCPServer, PluginManager
- **Why deleted:** Zero imports from any package — superseded by `packages/@monobrain/*` scoped packages
- **Rebuild as:** Not needed — all functionality exists in @monobrain/memory, @monobrain/swarm, @monobrain/mcp, @monobrain/plugins

### `packages/agents/` (5 YAML files — deleted)
- **What:** YAML agent config templates (architect, coder, reviewer, security-architect, tester)
- **Why deleted:** Agent definitions live in `.claude/agents/` as markdown; YAML format was legacy v1

### Stale directories removed
- 2 nested `.claude/` dirs in packages (4.3MB, 408 files — outdated standalone copies)
- 7 nested `.monobrain/` dirs in packages (stale session artifacts)
- 28 empty `tmp.json` placeholder files
- `tsconfig.vitest-temp.json` (temporary build file)
- `monobrain/.monobrain/` (empty umbrella package artifact)
- Root `ruvector.db` → moved to `.monobrain/data/`
- Root `test-database-provider.rvf` → moved to `packages/__tests__/fixtures/`

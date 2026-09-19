# Privacy & Outbound Network Requests

Monomind's core systems — Monograph (the code graph), Memory, and MCP tool
execution — run entirely locally against files already on your machine. This
page is the canonical list of every network request monomind can make on its
own, without you giving it a specific command to do so. Nothing else in this
repo or on npm should claim to be more absolute than the rows below — if you
find one that does, that claim is stale; this table is the correction.

## The table

| Trigger | Destination | When | Opt-out |
|---|---|---|---|
| Startup update check | `registry.npmjs.org` | Every command, rate-limited to once per 24h | `--no-update`, `MONOMIND_AUTO_UPDATE=false`, or any CI environment (`CI=true`/`CONTINUOUS_INTEGRATION=true`) |
| `doctor` version freshness | `npm view monomind version` (→ npm registry) | Every `monomind doctor` run | `doctor --component <name>` limits the run to one non-network check, or skip `doctor` |
| `doctor` companion-tool freshness | `api.github.com/repos/monoes/mono-agent/releases/latest` | Every `monomind doctor` run, **only if** the separate `monoagentcli` tool is installed | Same as above; uninstalling `monoagentcli` also stops it |
| `security cve` lookup | `api.osv.dev` | Only when you run `monomind security cve` | Don't run that command |
| Crash report | `api.github.com/repos/<repo>/issues` | **Only after you explicitly consent** — a non-interactive crash (CI, agents, most real runs) never asks and only saves the report locally until you've answered | Decline the one-time prompt, or set `MONOMIND_CRASH_REPORTING=off` up front |
| monoes.me connect | `https://monoes.me` | Only when you explicitly connect a community account via `monomind ui` → Connect | Never connect (nothing is sent before you do) |
| Embedding/reranker model download | HuggingFace CDN (`huggingface.co`, via the `@huggingface/transformers` package) | First `monomind doc ingest`/index that needs it, or an explicit `monomind download-embeddings` | Stay offline — search degrades to keyword matching |

## Verdicts on hosts found during the audit that aren't in the table

- **`api.fallow.cloud`** (`packages/@monomind/monograph/src/{coverage/cloud-client.ts, coverage/upload-inventory.ts, upload-source-maps.ts, license/manager.ts}`) — **unreachable**. Nothing in this repo imports any of these files, they aren't re-exported from monograph's public entry point or any published subpath, and nothing inside monograph itself calls them either. Dead code; removing it is tracked separately as **i-097** and is out of scope here.
- **`monograph.dev`** (6 occurrences, all in `packages/@monomind/monograph/src/{init/project-detection.ts, config/schema-gen.ts, report/json-schema.ts, report/output-grouped.ts}`) — **not a network request**. Every occurrence is a JSON Schema `$id`/`$schema` identifier embedded in generated config/report output (a namespacing convention, not a URL monomind fetches). No code in this repo dereferences it.

## What's not in this table, on purpose

Monomind also makes network requests when *you* tell it to, using your own
credentials — that's you directing the tool, not the tool phoning home:

- `monomind browse <url>` drives a real browser to wherever you point it (the login-flow adapters under `packages/@monomind/cli/src/browser/adapters/` just recognize specific sites like Google/LinkedIn/X so the automation can handle their auth forms).
- Configuring an org role to run through an external AI provider (Grok, Qwen, Hermes, z.ai, Antigravity, GitHub Copilot, etc.) routes that role's requests to the provider you chose, with the credentials you supplied.
- `doctor`/`init` occasionally print a plain URL as human-readable install guidance (e.g. "Install Node.js from https://nodejs.org") — that text is never fetched, only shown.

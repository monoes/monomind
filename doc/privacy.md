# Privacy & Outbound Network Requests

Monomind's core systems — Monograph (the code graph), Memory, and MCP tool
execution — run entirely locally against files already on your machine. This
page lists every network request monomind can make on its own, without you
giving it a specific command to do so, as of the commit that last touched
this file. It is kept honest by
`packages/@monomind/cli/src/__tests__/privacy-claims.test.ts`'s §3 completeness
check, which derives the expected host set directly from every `fetch`/
`httpsGet`/`http(s).request` call site in this repo and fails if one is added
here without a matching row, verdict, or documented exclusion below — read
that test, not just this page, if you need to be certain nothing is missing.

## The table

| Trigger | Destination | When | Opt-out |
|---|---|---|---|
| Startup update check | `registry.npmjs.org` | Every command, rate-limited to once per 24h | `--no-update`, `MONOMIND_AUTO_UPDATE=false`, or any CI environment (`CI=true`/`CONTINUOUS_INTEGRATION=true`) |
| `doctor` version freshness | `npm view monomind version` (→ npm registry) | Every `monomind doctor` run | `doctor --component <name>` limits the run to one non-network check, or skip `doctor` |
| `doctor` companion-tool freshness | `api.github.com/repos/monoes/mono-agent/releases/latest` | Every `monomind doctor` run, **only if** the separate `monoagentcli` tool is installed | Same as above; uninstalling `monoagentcli` also stops it |
| `security cve` lookup | `services.nvd.nist.gov` **first**, falling back to `api.osv.dev` only if NVD fails | Only when you run `monomind security cve` | Don't run that command |
| Crash report | `api.github.com/repos/<repo>/issues` | **Only after you explicitly consent** — a non-interactive crash (CI, agents, most real runs) never asks and only saves the report locally until you've answered | Decline the one-time prompt, or set `MONOMIND_CRASH_REPORTING=off` up front |
| monoes.me connect | `https://monoes.me` | Only when you explicitly connect a community account via `monomind ui` → Connect | Never connect (nothing is sent before you do) |
| Embedding/reranker model download | HuggingFace CDN (`huggingface.co`), via the `@huggingface/transformers` package or a direct fetch of the reranker classifier head | First `monomind doc ingest`/index that needs it, an explicit `monomind download-embeddings`, or the reranker head's first use | Stay offline — search degrades to keyword matching |
| sql.js WASM binary | `sql.js.org` | Only if the memory backend falls back to the sql.js driver **and** the WASM file bundled with the package can't be resolved locally | Ensure the bundled WASM resolves (the normal case); there is no separate flag |
| Monograph HTML/graph visualization | `fonts.googleapis.com`, `unpkg.com` (vis-network), `cdnjs.cloudflare.com` (sigma.js, graphology) | Opening a graph view via `monomind ui` or the `monograph_visualize`/`monograph_serve` MCP tools — these hosts are contacted by **your browser**, loading tags monomind's server put in the page it served you | Don't open the graph view; there is no bundled-assets flag yet |

## Verdicts on hosts found during the audit that aren't in the table

- **`api.fallow.cloud`** (`packages/@monomind/monograph/src/{coverage/cloud-client.ts, coverage/upload-inventory.ts, upload-source-maps.ts, license/manager.ts}`) — **unreachable**. Nothing in this repo imports any of these files, they aren't re-exported from monograph's public entry point or any published subpath, and nothing inside monograph itself calls them either. Dead code; removing it is tracked separately as **i-097** and is out of scope here.
- **`monograph.dev`** (6 occurrences, all in `packages/@monomind/monograph/src/{init/project-detection.ts, config/schema-gen.ts, report/json-schema.ts, report/output-grouped.ts}`) — **not a network request**. Every occurrence is a JSON Schema `$id`/`$schema` identifier embedded in generated config/report output (a namespacing convention, not a URL monomind fetches). No code in this repo dereferences it.
- **`api.anthropic.com`** (`packages/@monomind/mcp/src/sampling.ts:322`, inside `createAnthropicProvider`) — **unreachable**. Zero callers of `createAnthropicProvider` and zero callers of `registerLLMProvider` anywhere outside this file's own definition/re-export; `sampling/createMessage` returns "No LLM provider available" rather than reaching this branch. Dead code, not a live leak.
- **`api.openai.com`** (`packages/@monomind/monograph/src/wiki/providers.ts:67`) — **unreachable in practice**. Its one caller, `wiki-generator.ts:156`, is gated on an `llmConfig` value that no non-test code path ever sets; the MCP `monograph_wiki_build` tool takes the local `claude --print` branch instead. Dead in the sense that nothing in this repo currently drives execution there — flagged here rather than removed, since a future caller supplying `llmConfig` would be a legitimate, user-configured use (same category as the external-provider bullet below), not a defect.

## What's not in this table, on purpose

Monomind also makes network requests when *you* tell it to, using your own
credentials or your own explicit target — that's you directing the tool, not
the tool phoning home:

- `monomind browse <url>` drives a real browser to wherever you point it (the login-flow adapters under `packages/@monomind/cli/src/browser/adapters/` just recognize specific sites like Google/LinkedIn/X so the automation can handle their auth forms).
- Configuring an org role to run through an external AI provider (Grok, Qwen, Hermes, z.ai, Antigravity, GitHub Copilot, a self-hosted Ollama endpoint, etc.) routes that role's requests to the provider you chose, with the credentials or host you supplied.
- Distributed org coordination — a role's `endpoint.url`, `org_observe --remote`, cross-org forwarding, and the mastermind dashboard's controller connection all talk to a host and credential file **you configured** in your own org/role files, not a monomind-operated service. Locally these default to your own machine (`localhost`) and never leave it.
- A handful of commands send data to a target you supply as an argument or config value: `security redteam --target <url>` (your own endpoint, your own payloads), Monograph's URL ingest (`safeFetch`, SSRF-guarded against private/metadata IPs) fetching a URL you passed it, and publishing a generated wiki page to a GitHub gist (your own token). Same category as `browse` above — you aimed it.
- `doctor`/`init` occasionally print a plain URL as human-readable install guidance (e.g. "Install Node.js from https://nodejs.org") — that text is never fetched, only shown.

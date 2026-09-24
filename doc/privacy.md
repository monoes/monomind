# Privacy & Outbound Network Requests

Monomind's core systems — Monograph (the code graph), Memory, and MCP tool
execution — run entirely locally against files already on your machine. This
page lists every network request monomind can make on its own, without you
giving it a specific command to do so, as of the commit that last touched
this file. It is kept honest by
`packages/@monomind/cli/src/__tests__/privacy-claims.test.ts`'s §3b: rather
than trying to find every `fetch`/`httpsGet`/`http(s).request` call site (a
call-syntax-shaped detector that took three revisions to keep missing an
adjacent shape — file granularity, an aliased-fetch pattern, then `.html`
`<script src>` tags), §3b asserts that **every external host appearing
anywhere in monomind's shipped source — in a fetch call, a `<script src>`
tag, or a comment — is CLASSIFIED**: into a row in the table below, a
verdict, or a reviewed exclusion with a reason. That is deliberately not
"every host is a request" — a JSON Schema `$id`, a SARIF `$schema`, a
launchd plist DOCTYPE are hosts that appear in shipped source and are not
requests at all, and forcing a false row for one (or silently dropping it)
would be its own kind of inaccuracy. A new, unclassified host anywhere
fails the check, regardless of the shape it appears in.

**Scope, stated rather than implied:** this inventory covers literal
`https?://` hosts in files that ship **and** (execute **or** are served to
a client) — `.ts`/`.mjs`/`.js` source and `.html`/`.svg` served/rendered
content. It deliberately **excludes** test fixtures (`__tests__/`, which
contain deliberate SSRF-guard/browser-adapter attack hosts like
`169.254.169.254` and `metadata.google.internal` — those do not belong in
a privacy inventory at all), top-level project docs (README.md, `doc/**`),
and in-`src` reference documentation (`.md` files that ship as package
content but are neither executed nor served as a page — a design-system
citation link is not a request monomind makes). **Stated limit, not swept
under the rug:** it cannot see a runtime-assembled host
(`'https://' + host` or `` `https://${host}` ``) — no literal substring
means no static scanner, this one included, can find it.

**A second stated limit, about this page itself:** the guard verifies that
every external host found in shipped source is **reviewed and classified**
— as a table row, a verdict, or a deliberate exclusion. It does **not**
verify that the description attached to each host below is **accurate**. A
row that misdescribes what triggers a request, or misclassifies a
non-request (an XML namespace, a `$schema` string) as one, will not be
caught here — only that the host itself was not silently omitted. Read the
test, not just this page, if you need the full reasoning.

## The table

| Trigger | Destination | When | Opt-out |
|---|---|---|---|
| Startup update check | `registry.npmjs.org` | Every command, rate-limited to once per 24h | `--no-update`, `MONOMIND_AUTO_UPDATE=false`, or any CI environment (`CI=true`/`CONTINUOUS_INTEGRATION=true`) |
| `doctor` version freshness | `npm view monomind version` (→ npm registry) | Every `monomind doctor` run | `doctor --component <name>` limits the run to one non-network check, or skip `doctor` |
| `doctor` companion-tool freshness | `api.github.com/repos/monoes/mono-agent/releases/latest` | Only when you run `monomind doctor -c monoes-tools`, on macOS, with the separate `monoagentcli` tool installed | Don't run that component |
| `security cve` lookup | `services.nvd.nist.gov` **first**, falling back to `api.osv.dev` only if NVD fails | Only when you run `monomind security cve` | Don't run that command |
| Crash report | `api.github.com/repos/<repo>/issues` | **Only after you explicitly consent** — a non-interactive crash (CI, agents, most real runs) never asks and only saves the report locally until you've answered | Decline the one-time prompt, or set `MONOMIND_CRASH_REPORTING=off` up front |
| monoes.me connect | `https://monoes.me` | Only when you explicitly connect a community account via `monomind ui` → Connect (nothing is sent before you do) — and once connected, this is an **ongoing channel, not a one-shot handshake**: every MCP message for that session is forwarded to `monoes.me/api/mcp`, and org definitions are uploaded on publish | Never connect, or Disconnect in `monomind ui` |
| Embedding/reranker model download | HuggingFace CDN (`huggingface.co`), via the `@huggingface/transformers` package or a direct fetch of the reranker classifier head | First `monomind doc ingest`/index that needs it, an explicit `monomind download-embeddings`, or the reranker head's first use | Stay offline — search degrades to keyword matching |
| sql.js WASM binary | `sql.js.org` | Only if the memory backend falls back to the sql.js driver **and** the WASM file bundled with the package can't be resolved locally | Ensure the bundled WASM resolves (the normal case); there is no separate flag |
| Dashboard / Monograph HTML graph visualization | `fonts.googleapis.com`, `unpkg.com` (vis-network **and** the React/Babel UMD builds), `cdnjs.cloudflare.com` (sigma.js, graphology), `cdn.jsdelivr.net` (gsap, used by the dashboard's own pages and by the graphology/sigma fallback build) | Opening the dashboard via `monomind ui`, or a graph view via the `monograph_visualize`/`monograph_serve` MCP tools — these hosts are contacted by **your browser**, loading `<script>`/`<link>` tags monomind's server put in the page it served you | Don't open the dashboard or a graph view; there is no bundled-assets flag yet |
| `/mastermind:understand` semantic analysis | `api.anthropic.com` (`packages/@monomind/cli/scripts/understand-analyze.mjs`) | Only when the script is run directly with `ANTHROPIC_API_KEY` set and without `--no-llm` — the documented `/mastermind:understand` slash command always invokes it with `--no-llm` itself, so the *documented* path never calls out | Pass `--no-llm` yourself if invoking the script directly, or don't set `ANTHROPIC_API_KEY` in that shell |
| Jev decision model (agent/skill picking) | The host in `MONOMIND_JEV_URL` (self-hosted OpenJev or any compatible server), and/or `api.typesafe.ai` when **both** `TYPESAFE_API_KEY` and `MONOMIND_JEV_HOSTED=1` are set | Only when configured that way. Credential-shaped text is masked first. Then: **every prompt you type** (the UserPromptSubmit hook picks an agent and skill), each `monomind route semantic` / `agent --task` / `pick` / `org skills search` call, and in running orgs each task title (skill suggestion) and each `org_task` with `assignee: "auto"`. With the text go the candidates it chooses between (a keyword-ranked shortlist of up to 30 agents and 30 skills per request): agent names and descriptions, org role titles and responsibilities, and the names and descriptions of skills from your project (`.claude/skills`, `.claude/commands`), your user skills in `~/.claude/skills`, and the Org skill library. Each description is cut to 160 characters; skill bodies and agent prompts are never sent. Catalog skills (`monomind catalog`) are included only while this project's catalog state lists them active with `--target jev` and their stored package still verifies; with no readable catalog state, none are sent. `monomind doctor -c jev` sends one fixed probe sentence; the full `doctor` run sends nothing. | Unset `MONOMIND_JEV_URL` / `MONOMIND_JEV_HOSTED`, or set `MONOMIND_JEV=off` |

## Verdicts on hosts found during the audit that aren't in the table

- **`api.fallow.cloud`** (`packages/@monomind/monograph/src/{coverage/cloud-client.ts, coverage/upload-inventory.ts, upload-source-maps.ts, license/manager.ts}`) — **unreachable**. Nothing in this repo imports any of these files, they aren't re-exported from monograph's public entry point or any published subpath, and nothing inside monograph itself calls them either. Dead code; removing it is tracked separately as **i-097** and is out of scope here.
- **`monograph.dev`** (6 occurrences, all in `packages/@monomind/monograph/src/{init/project-detection.ts, config/schema-gen.ts, report/json-schema.ts, report/output-grouped.ts}`) — **not a network request**. Every occurrence is a JSON Schema `$id`/`$schema` identifier embedded in generated config/report output (a namespacing convention, not a URL monomind fetches). No code in this repo dereferences it.
- **`api.anthropic.com`** (`packages/@monomind/mcp/src/sampling.ts:322`, inside `createAnthropicProvider`) — **unreachable**. Zero callers of `createAnthropicProvider` and zero callers of `registerLLMProvider` anywhere outside this file's own definition/re-export; `sampling/createMessage` returns "No LLM provider available" rather than reaching this branch. Dead code, not a live leak.
- **`api.openai.com`** (`packages/@monomind/monograph/src/wiki/providers.ts:67`) — **unreachable in practice**. Its one caller, `wiki-generator.ts:156`, is gated on an `llmConfig` value that no non-test code path ever sets; the MCP `monograph_wiki_build` tool takes the local `claude --print` branch instead. Dead in the sense that nothing in this repo currently drives execution there — flagged here rather than removed, since a future caller supplying `llmConfig` would be a legitimate, user-configured use (same category as the external-provider bullet below), not a defect.
- **`github.com` (`api.version` update check)** (`packages/@monoes/monodesign/skill/scripts/context.mjs`'s `fetchLatestSkillVersion`) — **unreachable**. `computeUpdateDirective()` returns `null` unconditionally before this call is ever reached (an explicit `eslint-disable-next-line no-unreachable` marks the rest as a deliberate stub) — the monodesign skill's own update checking was disabled in favor of monomind's own update flow. Dead code, not a live leak.

## What's not in this table, on purpose

Monomind also makes network requests when *you* tell it to, using your own
credentials or your own explicit target — that's you directing the tool, not
the tool phoning home:

- `monomind browse <url>` drives a real browser to wherever you point it (the login-flow adapters under `packages/@monomind/cli/src/browser/adapters/` just recognize specific sites like Google/LinkedIn/X so the automation can handle their auth forms).
- Configuring an org role to run through an external AI provider (Grok, Qwen, Hermes, z.ai, Antigravity, GitHub Copilot, a self-hosted Ollama endpoint, etc.) routes that role's requests to the provider you chose, with the credentials or host you supplied.
- Distributed org coordination — a role's `endpoint.url`, `org_observe --remote`, cross-org forwarding, and the mastermind dashboard's controller connection all talk to a host and credential file **you configured** in your own org/role files, not a monomind-operated service. Locally these default to your own machine (`localhost`) and never leave it.
- A handful of commands send data to a target you supply as an argument or config value: `security redteam --target <url>` (your own endpoint, your own payloads), Monograph's URL ingest (`ingestUrl`, guarded by `validateUrl` against private/metadata IPs, re-checked after redirects) fetching a URL you passed it, and publishing a generated wiki page to a GitHub gist (your own token). Same category as `browse` above — you aimed it.
- `doctor`/`init` occasionally print a plain URL as human-readable install guidance (e.g. "Install Node.js from https://nodejs.org") — that text is never fetched, only shown.

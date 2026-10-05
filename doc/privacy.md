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

**What this page does not cover: the AI runtimes' own traffic.** Monomind
runs locally and keeps its state on your machine — memory, the code graph,
the document index and org state, embedded by a local model. The AI
runtimes it drives (Claude Code, Codex, OpenCode, Kimi Code, Antigravity)
are separate programs that send your prompts and code to their model
providers, including the memory and Second Brain excerpts monomind injects.
Org roles are different: a role on an AI-SDK provider is called by monomind
itself, so monomind sends that role's prompts (including org memory and
injected excerpts) to the provider you configured. What a provider
receives and keeps is set by that runtime and provider, not by monomind.

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
| `npx monomind@latest` launch | `registry.npmjs.org` — made by npx, not by monomind | Every launch through `npx monomind@latest` (a hook, MCP server entry or shell command written that way), because npx re-resolves the `latest` tag each time and downloads the package when its cached copy is older | Install it (`npm i -g monomind`) and run `monomind`, or pin an exact version (`npx monomind@<version>`) |
| `doctor` version freshness | `npm view monomind version` (→ npm registry) | Every `monomind doctor` run | `doctor --component <name>` limits the run to one non-network check, or skip `doctor` |
| `doctor` companion-tool freshness | `api.github.com/repos/monoes/mono-agent/releases/latest` | Only when you run `monomind doctor -c monoes-tools`, on macOS, with the separate `monoagentcli` tool installed | Don't run that component |
| `security cve` lookup | `services.nvd.nist.gov` **first**, falling back to `api.osv.dev` only if NVD fails | Only when you run `monomind security cve` | Don't run that command |
| Crash report | `api.github.com/repos/<repo>/issues` | **Only after you explicitly consent** — a non-interactive crash (CI, agents, most real runs) never asks and only saves the report locally until you've answered | Decline the one-time prompt, or set `MONOMIND_CRASH_REPORTING=off` up front |
| monoes.me connect | `https://monoes.me` | Only when you explicitly connect a community account via `monomind ui` → Connect (nothing is sent before you do) — and once connected, this is an **ongoing channel, not a one-shot handshake**: every MCP message for that session is forwarded to `monoes.me/api/mcp`, and org definitions are uploaded on publish | Never connect, or Disconnect in `monomind ui` |
| Embedding/reranker model download | HuggingFace CDN (`huggingface.co`), via the `@huggingface/transformers` package or a direct fetch of the reranker classifier head | First `monomind doc ingest`/index that needs it, an explicit `monomind download-embeddings`, or the reranker head's first use | Stay offline — search degrades to keyword matching |
| Heavy dependencies installed on first use | Your npm registry (`registry.npmjs.org` by default), and `storage.googleapis.com/chrome-for-testing-public` for Chrome | The first Claude org role, `agent exec --runtime claude` or `agent models --runtime claude` installs `@anthropic-ai/claude-agent-sdk` (about 300 MB with its Claude binary, about 4 MB without it when a usable Claude Code is installed; see [An installed Claude Code](#an-installed-claude-code)). The first `monomind browse` command, or `design detect` of a URL, on a machine with **no** Chrome, Chromium or Edge installs `@puppeteer/browsers` (about 2 MB) and downloads Chrome (about 400 MB). Each happens once, into `~/.monomind/deps` (`$MONOMIND_HOME/deps`), with a notice on stderr; see [Install-time downloads](#install-time-downloads) | `MONOMIND_NO_AUTO_INSTALL=1`: nothing is installed, and the error prints the command that does the same install by hand |
| sql.js WASM binary | `sql.js.org` | Only if the memory backend falls back to the sql.js driver **and** the WASM file bundled with the package can't be resolved locally | Ensure the bundled WASM resolves (the normal case); there is no separate flag |
| Dashboard / Monograph HTML graph visualization | `fonts.googleapis.com`, `unpkg.com` (vis-network **and** the React/Babel UMD builds), `cdnjs.cloudflare.com` (sigma.js, graphology), `cdn.jsdelivr.net` (gsap, used by the dashboard's own pages and by the graphology/sigma fallback build) | Opening the dashboard via `monomind ui`, or a graph view via the `monograph_visualize`/`monograph_serve` MCP tools — these hosts are contacted by **your browser**, loading `<script>`/`<link>` tags monomind's server put in the page it served you | Don't open the dashboard or a graph view; there is no bundled-assets flag yet |
| `/mastermind:understand` semantic analysis | `api.anthropic.com` (`packages/@monomind/cli/scripts/understand-analyze.mjs`) | Only when the script is run directly with `ANTHROPIC_API_KEY` set and without `--no-llm` — the documented `/mastermind:understand` slash command always invokes it with `--no-llm` itself, so the *documented* path never calls out | Pass `--no-llm` yourself if invoking the script directly, or don't set `ANTHROPIC_API_KEY` in that shell |
| Jev decision model (agent/skill picking) | The host in `MONOMIND_JEV_URL` (self-hosted OpenJev or any compatible server), and/or `api.typesafe.ai` when **both** `TYPESAFE_API_KEY` and `MONOMIND_JEV_HOSTED=1` are set | Only when configured that way. Credential-shaped text is masked first. Then: **every prompt you type** (the UserPromptSubmit hook picks an agent and skill), each `monomind route semantic` / `agent --task` / `pick` / `org skills search` call, and in running orgs each task title (skill suggestion) and each `org_task` with `assignee: "auto"`. With the text go the candidates it chooses between (a keyword-ranked shortlist of up to 30 agents and 30 skills per request): agent names and descriptions (your project's `.claude/agents` and your user agents in `~/.claude/agents`), org role titles and responsibilities, and the names and descriptions of skills from your project (`.claude/skills`, `.claude/commands`), your user skills in `~/.claude/skills`, and the Org skill library. Each description is cut to 160 characters; skill bodies and agent prompts are never sent. Catalog skills (`monomind catalog`) are included only while this project's catalog state lists them active with `--target jev` and their stored package still verifies; with no readable catalog state, none are sent. `monomind doctor -c jev` sends one fixed probe sentence; the full `doctor` run sends nothing. | Unset `MONOMIND_JEV_URL` / `MONOMIND_JEV_HOSTED`, or set `MONOMIND_JEV=off` |

## Verdicts on hosts found during the audit that aren't in the table

- **`api.fallow.cloud`** (`packages/@monomind/monograph/src/{coverage/cloud-client.ts, coverage/upload-inventory.ts, upload-source-maps.ts, license/manager.ts}`) — **unreachable**. Nothing in this repo imports any of these files, they aren't re-exported from monograph's public entry point or any published subpath, and nothing inside monograph itself calls them either. Dead code; removing it is tracked separately as **i-097** and is out of scope here.
- **`monograph.dev`** (6 occurrences, all in `packages/@monomind/monograph/src/{init/project-detection.ts, config/schema-gen.ts, report/json-schema.ts, report/output-grouped.ts}`) — **not a network request**. Every occurrence is a JSON Schema `$id`/`$schema` identifier embedded in generated config/report output (a namespacing convention, not a URL monomind fetches). No code in this repo dereferences it.
- **`api.anthropic.com`** (`packages/@monomind/mcp/src/sampling.ts:322`, inside `createAnthropicProvider`) — **unreachable**. Zero callers of `createAnthropicProvider` and zero callers of `registerLLMProvider` anywhere outside this file's own definition/re-export; `sampling/createMessage` returns "No LLM provider available" rather than reaching this branch. Dead code, not a live leak.
- **`api.openai.com`** (`packages/@monomind/monograph/src/wiki/providers.ts:67`) — **unreachable in practice**. Its one caller, `wiki-generator.ts:156`, is gated on an `llmConfig` value that no non-test code path ever sets; the MCP `monograph_wiki_build` tool takes the local `claude --print` branch instead. Dead in the sense that nothing in this repo currently drives execution there — flagged here rather than removed, since a future caller supplying `llmConfig` would be a legitimate, user-configured use (same category as the external-provider bullet below), not a defect.
- **`github.com` (`api.version` update check)** (`packages/@monoes/monodesign/skill/scripts/context-update.mjs`'s `fetchLatestSkillVersion`) — **unreachable**. `computeUpdateDirective()` returns `null` unconditionally before this call is ever reached (an explicit `eslint-disable-next-line no-unreachable` marks the rest as a deliberate stub) — the monodesign skill's own update checking was disabled in favor of monomind's own update flow. Dead code, not a live leak.

## Install-time downloads

The table above covers what monomind does once installed. Installing it is
a separate matter: some dependencies run install scripts that download
binaries. Measured by installing this repository's packed tarballs (the
packages as they will be published, with `scripts/pack-workspace-closure.mjs`)
into an empty prefix on Linux x64 with Node 26 and npm 11, before and after
[#428](https://github.com/monoes/monomind/issues/428):

| Package (pulled in by) | Script | What it does |
|---|---|---|
| `onnxruntime-node` (via `@huggingface/transformers`, optional, for local embeddings) | `postinstall` | On Linux x64, downloads the CUDA execution-provider libraries from `api.nuget.org` (260 MB, on top of the 288 MB package). Skip with `ONNXRUNTIME_NODE_INSTALL=skip`; CPU embeddings still work. |
| `better-sqlite3` (via `@monoes/monograph` and `@monoes/memory`) | `install` | `prebuild-install` fetches a prebuilt native addon from the package's GitHub releases, and compiles it with `node-gyp` when no prebuilt matches. |
| `protobufjs` (via `onnxruntime-web`) | `postinstall` | Checks the version scheme of the packages that depend on it. No download. |
| `monomind` itself | `postinstall` | Deletes macOS `._*` resource-fork files under `node_modules` (skipped on Windows). No download. |

| Install | Packages | `node_modules` | Outside `node_modules` |
|---|---|---|---|
| Before #428 | 344 | 1.23 GB | 686 MB of Chrome in `~/.cache/puppeteer` (puppeteer's postinstall) |
| Now | 263 | 938 MB | nothing |
| Now, `ONNXRUNTIME_NODE_INSTALL=skip` | 263 | 665 MB | nothing |
| Now, `--omit=optional` | 188 | 135 MB | nothing |

The largest entries left are `onnxruntime-node` (548 MB with the CUDA
libraries) and `onnxruntime-web` (141 MB). `--omit=optional` drops local
embeddings, the memory, hooks, routing and MCP packages, and the AI-SDK
providers.

### Installed on first use

Two heavy dependencies are no longer part of the install. The feature that
needs one installs it the first time it runs, once per machine:

| What | Installed when | Size |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk`, pinned to the version monomind is tested with, and the native Claude binary it brings as a per-platform package | The first Claude org role, `agent exec --runtime claude` or `agent models --runtime claude` | about 300 MB; about 4 MB, without the binary, when an [installed Claude Code](#an-installed-claude-code) is used |
| `@puppeteer/browsers` (the downloader puppeteer itself uses), then Chrome for Testing | The first `monomind browse` command that launches a browser, or `design detect` of a URL, **only if** no Chrome, Chromium or Edge is installed. An installed browser is always used first | about 2 MB, then about 400 MB of Chrome |

Where and how:

- Everything goes into `~/.monomind/deps/` (`$MONOMIND_HOME/deps/` when that
  is set), one directory per package and version, for example
  `~/.monomind/deps/@anthropic-ai+claude-agent-sdk@0.3.289/`. Nothing is
  installed into your project, and your `package.json` and lockfile are
  never read or written.
- npm runs `npm ci` in a staging directory there, against a lockfile that
  ships with monomind (`packages/@monomind/cli/src/utils/optional-deps-locks.ts`),
  with `--ignore-scripts`. Every package, including the dependencies of
  `@puppeteer/browsers`, is pinned by that lockfile and must match its
  integrity hash, whatever registry `~/.npmrc` points at. One fetch attempt
  with a 15-second timeout, so an offline machine fails quickly. The
  directory is moved into place only once complete, and a lock keeps two
  processes from installing the same thing at once.
- Chrome comes from `storage.googleapis.com/chrome-for-testing-public` and
  is checked by HTTPS only: Chrome for Testing publishes no checksums.
- Org roles cannot write `~/.monomind/deps`, `~/.npmrc` or `~/.config/npm`:
  they are denied to the file tools and the Claude sandbox, and the deps
  directory is read-only inside the bubblewrap mask other roles run in. A
  role that needs a missing package gets an error asking the operator to
  install it. Before loading anything from the deps directory, monomind also
  refuses a tree that contains a symlink on the way in (or one leading out),
  a file owned by another user, or a group- or other-writable file. The
  SDK's entry file, the Claude binary it runs and monofence-ai's files must also match SHA-256
  hashes that ship with monomind, taken from the registry tarballs, so a
  file planted as your own user is refused too.
- A notice on stderr says what is being installed, where, and how large it
  is. stdout is left alone, so an MCP stdio session or `agent exec`'s NDJSON
  stays clean.
- Only these packages can be installed this way, at the versions pinned in
  `packages/@monomind/cli/src/utils/optional-deps.ts`.

To pre-install the Claude runtime, run `monomind deps install` or
`monomind agent models --runtime claude` (it installs the SDK and lists models
without sending a prompt), or run the command monomind prints when
auto-install is off.

Org roles cannot write `~/.monomind/deps` (#527), so the org runtime installs
the SDK on the host before it starts a role whose runtime is claude
([#559](https://github.com/monoes/monomind/issues/559)). Roles on other
runtimes trigger no download. `MONOMIND_NO_AUTO_INSTALL=1` turns this host
install off too, for offline or no-network use; a role that then needs the
SDK fails with a message to run `monomind deps install`, which installs it
even with `MONOMIND_NO_AUTO_INSTALL` set, since it is an explicit request. To opt out, set
`MONOMIND_NO_AUTO_INSTALL=1`: nothing is installed, and the feature fails
with the exact command to run by hand (a plain `npm install` of the pinned
version, without the lockfile), such as

```sh
npm install --prefix '/home/you/.monomind/deps/@anthropic-ai+claude-agent-sdk@0.3.289' --global=false --ignore-scripts --legacy-peer-deps --no-audit --no-fund --save-exact @anthropic-ai/claude-agent-sdk@0.3.289
```

To remove them, delete `~/.monomind/deps`.

#### An installed Claude Code

The Claude runtime runs a Claude Code that is already installed instead of
the copy bundled with the SDK, when it finds a usable one
([#522](https://github.com/monoes/monomind/issues/522)). The SDK is then
installed with `--omit=optional`: its JavaScript package only (about 4 MB),
still from the shipped lockfile. If that Claude Code later goes away, the
next run installs the full SDK over it. If it goes away while a process is
using it (an update pruned that version), that process's next Claude turn
fails with a message saying so, and the turn after that looks again.

monomind looks, in order, at `$MONOMIND_CLAUDE_PATH`, `claude` on `PATH`,
`~/.local/bin/claude` and `~/.claude/local/claude`, and uses the first one
that passes these checks:

- Its real path (symlinks resolved) is what runs.
- The real path must be named `claude` (`claude.exe`) or be the native
  installer's `versions/<x.y.z>`, and must not be a script (starting with
  `#!`): Claude Code 2.1.226 and later is a native binary, and a script
  would run whatever `PATH` finds. A shim that resolves to another program
  (mise's resolves to `mise`) is never run.
- Found on its own, it must be a system install: not under `$HOME`, a temp
  directory or the current directory, and the file and every directory
  above it owned by root and not writable by group or others. Org roles
  run as your user, and the bubblewrap mask leaves writable everything
  your user can write, so a binary your user owns could be replaced by a
  role and then run by the org daemon outside every sandbox. This rules
  out per-user installs such as the native installer's
  `~/.local/share/claude`, mise, nvm or Homebrew (see
  [#527](https://github.com/monoes/monomind/issues/527)). When monomind
  runs as root (a container), roles are root too and ownership proves
  nothing, so nothing is picked up on its own; set `MONOMIND_CLAUDE_PATH`.
  On Windows there are no uids to check, so nothing is picked up on its
  own there either.
- `MONOMIND_CLAUDE_PATH` is your explicit choice and is not held to the
  location rule: the file only has to be owned by you or root and not
  writable by group or others. On Windows even that is not checked (file
  ACLs are not inspected), so point it only at a file that org roles
  cannot write. When it is not a system install, monomind warns on stderr
  that org roles could replace it, and keeps it read-only for them: its
  real path is denied to the file tools and in the Claude sandbox, and
  read-only in the bubblewrap mask, where every directory between `$HOME`
  (or `/`) and the file is also pinned so none can be renamed aside. A
  role that runs with neither the sandbox nor the mask (sandbox off, or
  no bubblewrap, e.g. on macOS) is not held back, and on macOS the
  sandbox denies writes to the file but not renaming a directory above
  it. If the path fails a check, monomind says why on stderr and uses the
  SDK's bundled binary; it does not try the other locations.
  `MONOMIND_CLAUDE_PATH=bundled` always uses the bundled binary.
- Then `claude --version` runs once per process, with no shell and a
  5-second timeout. It must print `x.y.z (Claude Code)`, and the version
  must be 2.x and at least the Claude Code release the pinned SDK bundles
  (2.1.289 for SDK 0.3.289): the SDK passes that release's flags and
  control messages, which older CLIs reject.

When a Claude Code was found but not used, the install notice says which
and why.

`monomind design detect` of a URL uses the downloaded Chrome through the
monodesign detector. The monodesign skill's own scripts, run on their own,
do not install anything: without an installed browser they still need
`npm install puppeteer`.

## What's not in this table, on purpose

Monomind also makes network requests when *you* tell it to, using your own
credentials or your own explicit target — that's you directing the tool, not
the tool phoning home:

- `monomind browse <url>` drives a real browser to wherever you point it (the login-flow adapters under `packages/@monomind/cli/src/browser/adapters/` just recognize specific sites like Google/LinkedIn/X so the automation can handle their auth forms).
- Configuring an org role to run through an external AI provider (Grok, Qwen, Hermes, z.ai, Antigravity, GitHub Copilot, a self-hosted Ollama endpoint, etc.) routes that role's requests to the provider you chose, with the credentials or host you supplied.
- Distributed org coordination — a role's `endpoint.url`, `org_observe --remote`, cross-org forwarding, and the mastermind dashboard's controller connection all talk to a host and credential file **you configured** in your own org/role files, not a monomind-operated service. Locally these default to your own machine (`localhost`) and never leave it.
- A handful of commands send data to a target you supply as an argument or config value: `security redteam --target <url>` (your own endpoint, your own payloads), Monograph's URL ingest (`ingestUrl`, guarded by `validateUrl` against private/metadata IPs, re-checked after redirects) fetching a URL you passed it, and publishing a generated wiki page to a GitHub gist (your own token). Same category as `browse` above — you aimed it.
- `doctor`/`init` occasionally print a plain URL as human-readable install guidance (e.g. "Install Node.js from https://nodejs.org") — that text is never fetched, only shown.

# Documents Dashboard

> Covers the "Documents" tab of the existing web dashboard (`localhost:4242`) — what it is,
> how it starts, its two API routes, and its security model. This is **not** a new server or
> a CLI subcommand — it's a tab inside the same control-server UI that already hosts Now /
> Sessions / Projects / Orgs / Monograph, etc.

---

## 1. What It Is

A "Documents" nav item under the **Global** section of the dashboard's sidebar
([`src/ui/dashboard.html`](packages/@monomind/cli/src/ui/dashboard.html), alongside "Global Feed" and "Global Tokens",
[`dashboard.html`](packages/@monomind/cli/src/ui/dashboard.html)). It's a master/detail view: a filterable, sortable, category-chipped,
day-grouped list of markdown documents on the left, and a markdown viewer on the right.

It surfaces markdown that mastermind-family skills generate — plans, specs, reviews, reports,
wikis, decisions, ideas, improvements, and tasks — scanned from `docs/mastermind/**` (and a
few sibling `docs/*` conventions) across **every project** under `~/.claude/projects`, plus
the personal cross-project global brain directory. It does not read arbitrary files: only the
known mastermind output directories are scanned, and only `.md` files are ever served.

> **Naming trap.** `monomind tokens dashboard` ([`commands/tokens.ts → dashboardSubcommand`](packages/@monomind/cli/src/commands/tokens.ts#dashboardSubcommand)) is a
> completely different, unrelated terminal/TUI dashboard for token spend. It shares a name
> fragment with this feature and nothing else — don't confuse the two.

---

## 2. How a User Gets There

Start the dashboard server with `monomind ui` (alias `monomind dashboard`; `--no-open` skips the
browser). Check that it is up with `curl -s http://localhost:4242/api/identity`, which returns its
pid and project directory.

It can also start with every Claude Code session, but only when the project opted in: run
`monomind init --dashboard` (writes `{"autostart": true}` to `.monomind/dashboard.json`) or set
`MONOMIND_DASHBOARD_AUTOSTART=1`. `MONOMIND_DASHBOARD_AUTOSTART=0` turns it off again. Without an
opt-in the **SessionStart hook** does nothing and prints nothing
([#423](https://github.com/monoes/monomind/issues/423): one resident server per project piled up).
The per-prompt Second Brain lookup uses a running dashboard's semantic search and falls back to
keyword matching when none is running.

- [`.claude/helpers/control-start.cjs → main`](packages/@monomind/cli/.claude/helpers/control-start.cjs#main) — "Called from SessionStart hook — exits
  immediately after spawning." When opted in, it checks for an already-running, non-stale server
  first; otherwise it spawns `server.mjs` detached and writes `.monomind/control.json`.
- Default port **4242** ([`control-start.cjs → DEFAULT_PORT`](packages/@monomind/cli/.claude/helpers/control-start.cjs#DEFAULT_PORT), [`src/ui/server.mjs → startServer`](packages/@monomind/cli/src/ui/server.mjs#startServer)
  `startServer({ port = 4242, ... })`), auto-incrementing up to 10 times on collision. A start
  for a project whose dashboard already answers `/api/identity` (on that port or the one
  `control.json` records) prints that URL and exits 0 instead
  ([#477](https://github.com/monoes/monomind/issues/477)).
- A user opens `http://localhost:4242` and clicks **Documents** in the sidebar.

---

## 3. API Routes

Two read-only routes back the view (verified at HEAD):

| Route | Source | Behavior |
|---|---|---|
| `GET /api/global-docs` | [`server-routes-docs.mjs → handleRoutesDocs`](packages/@monomind/cli/src/ui/server-routes-docs.mjs#handleRoutesDocs) | Lists document **metadata** (path, project, category, title, preview, mtime, sizeBytes) across every known project root plus the global brain. Returns metadata only — no file content. |
| `GET /api/global-doc/read?path=...` | [`server-routes-docs.mjs → handleRoutesDocs`](packages/@monomind/cli/src/ui/server-routes-docs.mjs#handleRoutesDocs) | Returns the raw markdown body of one document, fetched on demand when a user opens it in the viewer. |

---

## 4. Security

This dashboard has a documented history of security fixes in this project, so the current
(already-fixed) state is worth being explicit about:

1. **Loopback bind + Host-header DNS-rebinding defense.** The server binds `127.0.0.1` only,
   but that alone is **not** a boundary against a browser
   ([`server-net.mjs → isAllowedHost`](packages/@monomind/cli/src/ui/server-net.mjs#isAllowedHost)): a page on `attacker.example` can point its own DNS at
   `127.0.0.1`, and the browser will treat the response as same-origin with
   `attacker.example` — letting a malicious script read the dashboard's auth token out of the
   page and drive every authenticated `/api/*` route. The real boundary is the `Host` header:
   the browser always sends the name from the URL bar, so a rebound request carries
   `Host: attacker.example` while a legitimate request carries a loopback name. Non-loopback
   `Host` values are rejected.
2. **Path containment on `/api/global-doc/read`.** The `path` query param is resolved with
   `fs.realpathSync` (so a symlink that lexically sits inside an allowed root but physically
   points outside it can't be used to escape), then checked for containment against the
   allowed project roots — `403` if outside, `400` if the resolved file doesn't end in `.md`
   ([`server-routes-docs.mjs → handleRoutesDocs`](packages/@monomind/cli/src/ui/server-routes-docs.mjs#handleRoutesDocs)). The symlink-resolution step was added in a follow-up fix after the initial ship (a
   symlink-escape report) — this section describes only the current, already-patched behavior.

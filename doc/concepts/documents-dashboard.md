# Documents Dashboard

> Covers the "Documents" tab of the existing web dashboard (`localhost:4242`) — what it is,
> how it starts, its two API routes, and how access to it is checked. This is **not** a new server or
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
the personal cross-project global brain directory. Only the known mastermind output directories
are scanned for the list.

> **Naming trap.** `monomind tokens dashboard` ([`commands/tokens.ts → dashboardSubcommand`](packages/@monomind/cli/src/commands/tokens.ts#dashboardSubcommand)) is a
> completely different, unrelated terminal/TUI dashboard for token spend. It shares a name
> fragment with this feature and nothing else — don't confuse the two.

---

## 2. How a User Gets There

Start the dashboard server with `monomind ui` (alias `monomind dashboard`; `--no-open` skips the
browser). Check that it is up with `curl -s http://localhost:4242/api/identity`, which returns its
pid and project directory.

`monomind org run` starts it too (see
[Org Runtime](org-runtime.md)). It can also start with every Claude Code session, but only when the project opted in: run
`monomind init --dashboard` (writes `{"autostart": true}` to `.monomind/dashboard.json`) or set
`MONOMIND_DASHBOARD_AUTOSTART=1`. `MONOMIND_DASHBOARD_AUTOSTART=0` turns it off again. Without an
opt-in the **SessionStart hook** does nothing and prints nothing
([#423](https://github.com/monoes/monomind/issues/423): one resident server per project piled up).
The per-prompt Second Brain lookup uses a running dashboard's semantic search and falls back to
keyword matching when none is running.

- [`.claude/helpers/control-start.cjs → main`](.claude/helpers/control-start.cjs#main) — "Called from SessionStart hook — exits
  immediately after spawning." When opted in, it checks for an already-running, non-stale server
  first; otherwise it spawns `server.mjs` detached and writes `.monomind/control.json`.
- Default port **4242** ([`control-start.cjs → DEFAULT_PORT`](.claude/helpers/control-start.cjs#DEFAULT_PORT), [`src/ui/server.mjs → startServer`](packages/@monomind/cli/src/ui/server.mjs#startServer)
  `startServer({ port = 4242, ... })`), auto-incrementing up to 10 times on collision. A start
  for a project whose dashboard already answers `/api/identity` (on that port or the one
  `control.json` records) prints that URL and exits 0 instead
  ([#477](https://github.com/monoes/monomind/issues/477)).
- A user opens the dashboard in a logged-in browser and clicks **Documents** in the sidebar.
  `monomind ui` opens such a tab itself (it carries a one-time login link); for a server that is
  already running, `monomind dashboard open` opens one. A bare `http://localhost:4242` visit
  without that login gets a login-required page.

---

## 3. API Routes

Two read-only routes back the view (verified at HEAD):

| Route | Source | Behavior |
|---|---|---|
| `GET /api/global-docs` | [`server-routes-docs.mjs → handleRoutesDocs`](packages/@monomind/cli/src/ui/server-routes-docs.mjs#handleRoutesDocs) | Lists document **metadata** (path, project, category, title, preview, mtime, sizeBytes) across every known project root plus the global brain. Returns metadata only — no file content. |
| `GET /api/global-doc/read?path=...` | [`server-routes-docs.mjs → handleRoutesDocs`](packages/@monomind/cli/src/ui/server-routes-docs.mjs#handleRoutesDocs) | Returns JSON `{ path, body }` for one document: its resolved path and its raw markdown body, fetched on demand when a user opens it in the viewer. |

---

## 4. Security

Every request to the dashboard server passes these checks
([`server-request-gate.mjs → checkRequestGate`](packages/@monomind/cli/src/ui/server-request-gate.mjs#checkRequestGate)):

1. **Loopback bind and Host check.** The server binds `127.0.0.1` only, and it rejects a request
   whose `Host` header names neither a loopback address nor a host listed in
   `MONOMIND_DASHBOARD_ALLOWED_HOSTS` (comma-separated) or the `allowedHosts` server option
   ([`server-net.mjs → isAllowedHost`](packages/@monomind/cli/src/ui/server-net.mjs#isAllowedHost)).
2. **Dashboard token.** Every `/api/*` route needs the per-start dashboard token, sent in the
   `x-monomind-token` header (`?token=` is accepted on GET and HEAD only). The exceptions are
   `/api/identity` and the monoes.me OAuth callback
   ([`server-auth.mjs → createAuthGate`](packages/@monomind/cli/src/ui/server-auth.mjs#createAuthGate)).
3. **Browser session.** The dashboard pages, which carry the token, are served only to a browser
   with the session cookie that a one-time login link sets (`monomind ui` and
   `monomind dashboard open` issue the link; see
   [`human-auth.mjs → issueLoginNonce`](packages/@monomind/cli/src/ui/human-auth.mjs#issueLoginNonce)).
4. **Same-origin mutations.** A non-GET request that carries a `Sec-Fetch-Site` header other than
   `same-origin` is rejected with `403`.
5. **Path containment on `/api/global-doc/read`.** The `path` query param is resolved with
   `fs.realpathSync`, so symlinks are followed before the check, then checked for containment
   against the known project roots and the global brain — `403` if outside, `400` if the resolved
   file doesn't end in `.md`
   ([`server-routes-docs.mjs → handleRoutesDocs`](packages/@monomind/cli/src/ui/server-routes-docs.mjs#handleRoutesDocs)).

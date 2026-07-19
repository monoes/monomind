---
name: monodesign-live
description: Interactive live variant mode — select elements in the browser, pick a design action, and get AI-generated HTML+CSS variants hot-swapped via the dev server's HMR. Iterate until the live result matches the design intent.
type: design-sub-command
argument-hint: "[target URL, route, or app path]"
user-invocable: true
---

# Monodesign: Live

Interactive live variant mode. This is a fully functional, script-driven flow — not a manual screenshot loop. Read `reference/live.md` from the monodesign skill directory for the full protocol and follow its contract exactly (boot, poll, generate, steer, accept/discard, exit).

## Prerequisites

- A running dev server with hot module replacement (Vite, Next.js, Bun, etc.), OR a static HTML file open in the browser.
- Node available on PATH (the flow runs the bundled live helper scripts).
- If `.monodesign/live/config.json` exists (written by `/monodesign init`), live boots straight into variant mode with no first-time setup detour.

## How it works (summary — the reference is authoritative)

1. **Boot**: run `live.mjs` (with `--target <path>` when the request names a specific file, route, or monorepo app). It starts the live helper server and injects the in-page toolbar.
2. **Open the app URL** that serves the page (the app's own dev-server URL — never the helper's `serverPort`).
3. **Poll loop**: long-poll with `live-poll.mjs` (default long timeout). The user selects elements in the browser and picks a design action from the toolbar.
4. **On `generate`**: read the screenshot if present, load the action's reference file, plan three distinct directions, write all variants in one edit, reply done, poll again.
5. **On `steer`**: handle the user's free-text instruction, reply, poll again.
6. **On `accept` / `discard`**: the accepted variant is committed to source (carbonize accepts have a cleanup step via `live-complete.mjs`); discards roll back.
7. **If interrupted**: run `live-status.mjs` or `live-resume.mjs` — the durable journal replays unacknowledged work.
8. **On `exit`**: run the cleanup steps at the bottom of the reference.

## Guidelines

- Never pass a short poll timeout; restart the poll immediately after every event.
- Variants are written as real source edits hot-swapped by HMR — deliver code that can be committed, not browser-only overrides.
- Manual in-browser edits are captured and can be committed or discarded via `live-commit-manual-edits.mjs` / `live-discard-manual-edits.mjs`.

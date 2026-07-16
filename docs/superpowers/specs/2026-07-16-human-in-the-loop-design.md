# Global Human-in-the-Loop for Org Runtime

**Date:** 2026-07-16
**Status:** Approved (pending spec review)

## Problem

Roles running inside a `monomind org run` org have no way to pause and ask a human a question when they hit a decision that genuinely needs human judgment. Today the only "approval" concept is a bash-polling skill (`mastermind:approve`) that mutates a JSON file the typed org runtime never reads, and a dashboard "Approvals" tab whose buttons already call `/api/org/:org/approvals*` endpoints that don't exist anywhere in this codebase. There's no `BusEvent` type for a question, no daemon hook, and no path for a human's answer to reach a live agent session.

## Goals

1. Any role can call a tool to ask a free-form question and pause (end its turn) until a human answers.
2. A human can see and answer every pending question from every running org in one place — a global inbox — not scattered per-org.
3. The org chart (built in the recent activity-animation feature) shows a persistent indicator on any role currently waiting for a human answer.
4. Answering wakes the waiting role immediately, not on its next naturally-scheduled turn.
5. Works whether the target org is still running or has since stopped.

## Non-goals

- No policy-gated/pre-configured approval triggers (e.g. auto-flagging risky tool calls) — this is agent-initiated only, not a rules engine. That's a separate, disconnected system (the existing `-approvals.json`/skill) left as-is.
- No rich-text/multi-turn Q&A UI — a single free-text answer per question.
- No change to the existing binary running-dot or the activity-bubble's normal (non-question) behavior.

## Architecture overview

Four pieces, each mirroring an existing, already-tested subsystem in this codebase — a human's answer is structurally identical to a cross-org message (`org_send` → `daemon.deliver()` → `broker.ts` lookup → `/api/xdeliver` → `mailbox.push()`), just from a "human" sender instead of another org. Confirmed from `mailbox.ts`: `mailbox.push()` is picked up by a live session's `mailbox.stream()` async generator on its very next tick — no polling or explicit "wake" primitive is needed for the common (org still running) case.

1. **`ask_human` tool** (new, in `packages/@monomind/cli/src/orgrt/session.ts`) — sibling to the existing `org_send` tool (same file, same `createSdkMcpServer` block). Schema `{ question: z.string() }`. Calls a new `askHuman` callback (parallel to the existing `deliver` callback already threaded through `SessionOpts`), returns a receipt string immediately (never blocks). `buildRolePrompt()` gains one line: "If you call ask_human, end your turn immediately after — you'll receive the human's answer as a new message when it arrives."

2. **`daemon.askHuman()`** (new, in `packages/@monomind/cli/src/orgrt/daemon.ts`) — sibling to `daemon.deliver()`. On call:
   - Generates a `questionId` (same random-suffix style already used for `run` ids in `startOrg()`).
   - Appends `{ questionId, role, question, ts, answer: null, answeredAt: null }` to `.monomind/orgs/<org>/questions.json` (read-modify-write, mirroring the tmp+rename atomic pattern already used in `broker.ts`'s `registerOrg()`).
   - Emits `bus.emit({ type: 'question', from: role.id, data: { questionId, question } })` — flows through the already-fixed `forwarder.ts` → dashboard SSE like every other event today, no forwarder changes needed beyond the type addition (its `default` case already forwards unknown types raw as `org:<type>`, but we add `'question'` as a first-class case in `translate()` alongside `'message'`/`'chat'`/etc. so it renders with `type: 'org:question'`).

3. **Answer delivery, org still running** — a new `POST /api/answer-question` endpoint on `packages/@monomind/cli/src/orgrt/server.ts`, sibling to the existing `/api/xdeliver` handler. Body: `{ org, role, questionId, answer }`. Calls into a new `daemon.answerQuestion(org, role, questionId, answer)` method: marks the question answered in `questions.json`, then `mailbox.push(answer)` on that role's live mailbox exactly as `receiveRemote()` does today.

4. **Answer delivery, org stopped** — `daemon.answerQuestion()` checks `this.orgs.get(org)` first; if absent, falls back to the exact pattern `deliver()`/`receiveRemote()` already use for an offline target: `queueMessage(this.root, org, {...})` (existing `inbox.ts`) + `this.autoWake(org)` (existing private method). The role sees the answer as its first message when the org restarts, same as any other queued cross-org message today.

## Dashboard side

- **Global inbox panel** — new top-level tab in `dashboard.html` (sibling to the existing per-org "Approvals" tab, but cross-org), populated entirely from the SSE stream `server.mjs` already broadcasts via `broadcastMm()` — no new polling. Lists `{org, role, question, ts}` rows with a free-text answer box + submit button per row.
- **Answering** — submit POSTs to a new `server.mjs` endpoint `POST /api/questions/:id/answer`. That handler uses `broker.ts`'s existing `lookupOrg(org)` to find which process currently hosts the target org, and forwards the answer to that process's `/api/answer-question` (item 3 above) — or, if `lookupOrg` misses, still forwards (item 4's offline fallback triggers inside `daemon.answerQuestion()` once the request reaches *some* process that has the org's def on disk; if genuinely no process anywhere has it, report the error rather than silently drop). On success, mark the question answered in `server.mjs`'s own index and broadcast an SSE update so every connected dashboard removes it from the pending list immediately.
- **Chart indicator** — reuses the activity-bubble feature (already shipped): a role with an unanswered question gets a distinct bubble state — different color/icon (amber "?" vs the normal green activity dot) — showing a truncated version of the question. Unlike a normal status bubble, this one does **not** auto-fade after 5s; it persists until answered. Clicking it jumps to that question in the global inbox panel.

## Data model

One new `BusEvent.type` value: `'question'`, added to the closed union in `packages/@monomind/cli/src/orgrt/types.ts:66`. Payload carried via the existing `data?: Record<string, unknown>` field: `{ questionId: string, question: string }` on ask; a second `status`-style event (`type: 'status', msg: 'question answered'`) on resolution, matching how session-lifecycle transitions are already reported.

Persisted per-org at `.monomind/orgs/<org>/questions.json`: `{ questions: [{ questionId, role, question, ts, answer: string | null, answeredAt: number | null }] }` — same location/shape convention as the existing (currently disconnected) `-approvals.json`, but this one is actually read and written by the typed runtime.

`server.mjs` keeps its own in-memory index for fast global-inbox rendering, rebuilt from the SSE/event-log on restart (matching how it already reconstructs other dashboard state); the per-org file is the durable source of truth an org process reads back after its own restart.

## Error handling

- Answer submitted for an org with no running process and no saved definition on disk (`hasOrgDef` false): report a clear error to the dashboard, matching `deliver()`'s existing "unknown recipient" error path — never silently drop.
- Double-submit (question already answered, e.g. two browser tabs): second submit is a no-op, response indicates "already answered."
- Org stopped while a question is pending: answer is queued via `inbox.ts` and delivered on next `autoWake`/manual restart, identical to any other queued cross-org message today.

## Testing

Following this codebase's existing `__tests__/orgrt/*.test.ts` convention (real `OrgDaemon`/`OrgBus`/`Mailbox` instances against a temp dir, no mocks — see `forwarder.test.ts`, `daemon.test.ts`):

- `ask_human` → `daemon.askHuman()` persists the question to `questions.json` and emits the `question` `BusEvent`.
- An answer POST to a running org's `/api/answer-question` delivers via `mailbox.push()`, and the waiting session's mailbox stream yields it as the next message.
- The offline-org fallback path (queue + `autoWake`) delivers the answer once the org restarts, mirroring the existing `receiveRemote`/offline-`deliver` test coverage.

Dashboard-side (`server.mjs`, `dashboard.html`) is verified manually against a real running org, per this project's established pattern for those files — no test harness exists for them (confirmed in the recent SSE-transport-fix work).

## Open questions

None — all resolved during brainstorming (see conversation).

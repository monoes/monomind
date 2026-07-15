# Org Chart Live Activity Animation

**Date:** 2026-07-15
**Status:** Approved (pending spec review)

## Problem

The org dashboard's org chart (`v2RenderOrgChart()`, `packages/@monomind/cli/dist/src/ui/dashboard.html` ~line 5995) shows each role as a static SVG node with only a binary running/not-running dot (`.v2-chart-running-dot`, `v2UpdateChartRunningDots()` ~line 6269). There's no way to see, at a glance, *what* a role is currently doing, or *when* roles are communicating with each other. This makes the live chart feel static even while an org is actively running.

## Goals

1. When a role is actively working, show a speech-bubble with a short live status text near its node.
2. When one role sends a message/event to another, animate a small "letter" icon flying from the source node to the destination node along the org chart edges.
3. No backend/runtime changes — derive everything from the SSE event stream already flowing into the dashboard.

## Non-goals

- No new backend event types or payload fields.
- No persistent activity history/log UI (the existing chat feed already covers that).
- No changes to the binary running-dot indicator, which stays as-is.

## Data flow

All events already delivered via SSE (`/api/orgs/:name/runs/current/stream`) and consumed by `_odtHandleLiveEvent` / `_odtAppendEvent` (~line 8011) get a second consumer: `v2OrgActivity`, a small client-side module that watches role-scoped events and derives two independent things — status text and letter events — purely from existing event payloads.

### Status text derivation

Live org events reaching the dashboard are produced by `forwarder.ts`'s `translate()` (`packages/@monomind/cli/src/orgrt/forwarder.ts:105-152`), which maps the runtime's internal `BusEvent` (`orgrt/types.ts:65-77`, `type: 'message'|'xorg'|'tool'|'asset'|'chat'|'status'|'audit'|'usage'`) into the dashboard-native event vocabulary. The event types below are what actually arrive over SSE for a running org (superseding the `domain:dispatch`/`agent:usage` types referenced in dashboard.html's older `_odtAppendEvent` switch, which belong to a different/legacy code path and are never emitted by org-runtime-v2):

| Event type | Fields used | Template |
|---|---|---|
| `org:tool` | `from`, `tool` | `"running {tool}"` |
| `org:checkpoint` | `from`, `progress` | `"{progress}"` (truncated to ~40 chars) |
| `org:comms` | `from`, `to`, `msg` | `"messaging {toRoleName}"` (resolve `to` against `d.roles` for display name; if `to === 'all'`, `"broadcasting"`) |
| `org:artifact` | `from`, `artifact.label` | `"writing {artifact.label}"` |
| anything else (`org:usage`, `org:agent:online/offline`, `org:start/complete`, etc.) | `from` only | `"active"` (generic fallback) |

This is a pure function: `(eventType, payload, roles) => statusText | null`. Testable in isolation. Events with no `from` field (e.g. `org:start`, `org:complete`) produce no status text and are ignored by the bubble module entirely.

### Letter event derivation

- `org:comms {from, to, msg}` → direct letter from `from` to `to` (skip if `to === 'all'` or `to` is missing — no single destination node to animate toward).
- `org:checkpoint` and `org:artifact` (both only carry `from`) → implicit letter from `from` to that role's leader/boss (`_v2OrgIsLeader`), matching the existing "report" edge direction/semantics already drawn for these roles.
- All other event types (`org:tool`, `org:usage`, `org:agent:online/offline`, `org:start/complete`) drive the status bubble only (if applicable) — no letter, since there's no meaningful second party.

## Activity bubble (per role)

- Each `.v2oc-node` gets a sibling `<foreignObject>` positioned via the node's existing `cx`/`cy` (offset above it), containing an HTML div styled as a rounded speech bubble with a tail pointing at the node.
- On any activity event for that role: update the bubble's text, animate it in with GSAP (`gsap.fromTo(bubbleEl, {scale:0.8, autoAlpha:0}, {scale:1, autoAlpha:1, duration:0.3, ease:'back.out(1.7)'})` — per the monomotion skill, GSAP owns all motion in this codebase, not CSS transitions/keyframes), and (re)start a 5s idle timer for that role.
- If no new event arrives for that role within 5s, the bubble fades out via `gsap.to(bubbleEl, {autoAlpha:0, duration:0.4, ease:'power2.in'})`.
- One bubble per role — a new event always replaces the current text rather than stacking/queueing bubble content. If a fade-out is in flight when a new event arrives, kill the pending fade tween before starting the fade-in.

## Flying letter (per message)

- On a letter event, spawn a one-shot SVG group (small envelope icon) with `<animateMotion>` bound via `<mpath>` to the edge path between the two roles (reusing the existing static command-edge particle path if that edge already exists in `d.communication`; synthesizing a straight/curved path otherwise) — this matches the existing native-SVG motion-path technique already used for command-edge particles (~lines 6164-6169) rather than GSAP's MotionPath plugin, since that plugin isn't available in this codebase (GSAP club-only) and the native primitive is already proven here.
- Entrance/exit of the envelope icon itself (scale-in at spawn, scale-out+fade before removal) uses GSAP per monomotion (`gsap.fromTo(letterEl, {scale:0, autoAlpha:0}, {scale:1, autoAlpha:1, duration:0.15})`), keeping GSAP as the single owner of all non-path-following motion.
- Animation duration ~700-900ms; the spawned group is removed from the DOM on `animationend` of the `<animateMotion>`.
- If multiple letters fire within ~150ms of each other, each subsequent one gets an incremental start delay (~80ms), set via the `begin` attribute on `<animateMotion>`, so they're visually distinguishable instead of overlapping exactly.
- This mirrors the existing always-looping command-edge particle technique (~lines 6129-6171, 6241-6264) but as dynamically created/destroyed one-shot elements instead of a permanent loop.

## Testing

- Unit tests for the pure derivation functions (status text template map, letter direction inference) covering each event type and the fallback case.
- Manual verification via `agent-browser-testing` skill (or `monomind browse`) against a running org: confirm bubbles appear/fade correctly, confirm letters animate along the correct edge direction, confirm staggering under a burst of simultaneous events.

## Open questions

None — all resolved during brainstorming (see conversation).

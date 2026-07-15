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

A per-event-type template map produces a short human-readable phrase for the *acting* role:

| Event type | Template |
|---|---|
| `domain:dispatch` | `"working on: {task}"` |
| `agent:usage` / tool-use events | `"running {tool}"` |
| `org:comms` | `"messaging {toRoleName}"` |
| unrecognized shape | `"active"` (generic fallback) |

This is a pure function: `(eventType, payload) => statusText | null`. Testable in isolation.

### Letter event derivation

Any event with a distinguishable `from`/`to` role pair becomes a letter event:

- `org:comms {from, to, msg}` → direct.
- `domain:dispatch` → dispatcher → assignee.
- `domain:complete` → assignee → dispatcher (reverse direction).

Events with no resolvable `from`/`to` pair (e.g. solo tool calls) drive the status bubble only, not a letter.

## Activity bubble (per role)

- Each `.v2oc-node` gets a sibling `<foreignObject>` positioned via the node's existing `cx`/`cy` (offset above it), containing an HTML div styled as a rounded speech bubble with a tail pointing at the node.
- On any activity event for that role: update the bubble's text, show it (`.v2-bubble-visible` class, CSS fade+scale transition reusing existing `cv-in`-style easing), and (re)start a 5s idle timer for that role.
- If no new event arrives for that role within 5s, the bubble fades out.
- One bubble per role — a new event always replaces the current text rather than stacking/queueing bubble content.

## Flying letter (per message)

- On a letter event, spawn a one-shot SVG group (small envelope icon) with `<animateMotion>` bound via `<mpath>` to the edge path between the two roles (reusing the existing static command-edge particle path if that edge already exists in `d.communication`; synthesizing a straight/curved path otherwise).
- Animation duration ~700-900ms; the spawned group is removed from the DOM on `animationend`.
- If multiple letters fire within ~150ms of each other, each subsequent one gets an incremental start delay (~80ms) so they're visually distinguishable instead of overlapping exactly.
- This mirrors the existing always-looping command-edge particle technique (GSAP + `<animateMotion>`/`<mpath>`, ~lines 6129-6171, 6241-6264) but as dynamically created/destroyed one-shot elements instead of a permanent loop.

## Testing

- Unit tests for the pure derivation functions (status text template map, letter direction inference) covering each event type and the fallback case.
- Manual verification via `agent-browser-testing` skill (or `monomind browse`) against a running org: confirm bubbles appear/fade correctly, confirm letters animate along the correct edge direction, confirm staggering under a burst of simultaneous events.

## Open questions

None — all resolved during brainstorming (see conversation).

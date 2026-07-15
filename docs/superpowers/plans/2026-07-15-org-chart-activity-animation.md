# Org Chart Live Activity Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the org dashboard's org chart (`v2RenderOrgChart()`) show a live status bubble above each active role and animate a small "letter" icon flying along the org chart edges whenever roles communicate.

**Architecture:** A new client-side module inside `dashboard.html`'s single inline `<script>` block derives status text and letter (message) events from the SSE event stream already flowing into `_odtHandleLiveEvent`, purely from existing event payloads — no backend changes. Status bubbles are HTML `<foreignObject>` elements anchored to each node's existing SVG coordinates; letters are one-shot SVG groups riding `<animateMotion>`/`<mpath>` along the existing (or a synthesized) edge path. GSAP owns all non-path-following motion (bubble/letter fade+scale) per the monomotion skill; native SVG `<animateMotion>` owns path-following motion, matching the existing command-edge particle technique already in this file.

**Tech Stack:** Plain JS inside `packages/@monomind/cli/dist/src/ui/dashboard.html` (no build step — this file is hand-edited directly in `dist/`, per `docs/adrs/org-dashboard-v2-design.md`). GSAP (already loaded via CDN `<script>` at line 1529). No new dependencies.

## Global Constraints

- No backend/runtime changes — do not touch `packages/@monomind/cli/src/orgrt/forwarder.ts` or any `BusEvent` emitter.
- GSAP owns all fade/scale/entrance/exit motion; do not add new CSS `@keyframes` or `transition` rules for this feature (per the monomotion skill — existing `blink`/`v2nodeIn` keyframes predate this rule and are left as-is).
- Path-following motion (letter traveling along an edge) uses native SVG `<animateMotion>`/`<mpath>`, matching the existing command-edge particle code (~lines 6164-6169) — GSAP's MotionPath plugin is a paid club plugin not available in this codebase.
- This file has no unit-test harness (no Jest/jsdom wired to inline `<script>` globals). Verification follows the project's established pattern for this exact file (see `docs/adrs/org-dashboard-v2-design.md` lines 751-798): POST a synthetic event to the local control server's event endpoint and confirm the dashboard reacts, using the `agent-browser-testing` skill (native `monomind browse` CDP client) for visual confirmation — never Playwright/Puppeteer/Selenium/`mcp__claude-in-chrome__*` (per this package's `CLAUDE.md`).
- One bubble per role (new event replaces text, never stacks). Bubble auto-fades after 5s idle. Letters within ~150ms of each other stagger by ~80ms.

---

### Task 1: Layout cache + pure event-derivation helpers

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard.html` (add new functions right after `v2RenderOrgChart`, i.e. after line 6265, before `v2UpdateChartRunningDots` at line 6269)

**Interfaces:**
- Produces:
  - `_v2ChartLayout` (module-level object, reassigned each `v2RenderOrgChart()` call): `{ pos: Record<roleId, {x:number,y:number}>, edgeIdByPair: Map<string, string> }` — `edgeIdByPair` keys are `from-to` pairs joined with an arrow, values are the SVG path element id (e.g. `v2ep3`).
  - `v2DeriveActivityText(ev, roles)` returns a string or null
  - `v2DeriveLetterTarget(ev, roles)` returns `{ from, to }` or null

Both derivation functions are pure — no DOM access — so they can be exercised in a plain Node snippet during manual verification; no new test framework is introduced.

- [ ] Step 1: Add the layout cache, populated at the end of v2RenderOrgChart

Insert immediately before the closing brace of v2RenderOrgChart (right before line 6264's closing, after the CSS-fallback else block, so it runs on every render regardless of the GSAP/CSS-fallback branch):

```js
  const edgeIdByPair = new Map();
  comms.forEach((edge, ei) => {
    if (edge.from === edge.to) return;
    edgeIdByPair.set(edge.from + '->' + edge.to, 'v2ep' + ei);
  });
  _v2ChartLayout = { pos, edgeIdByPair };
  v2OrgActivityReset();
```

Declare the module-level variable near the other org-chart globals (line 5786, right after the existing org-data declaration):

```js
let _v2ChartLayout = { pos: {}, edgeIdByPair: new Map() };
```

- [ ] Step 2: Add the pure derivation functions

Insert after v2RenderOrgChart's closing brace, before function v2UpdateChartRunningDots at line 6269:

```js
function _v2RoleName(id, roles) {
  const r = (roles || []).find(x => x.id === id);
  return r ? (r.name || r.title || r.id) : id;
}

function v2DeriveActivityText(ev, roles) {
  if (!ev || !ev.from) return null;
  const type = ev.type || '';
  if (type === 'org:tool') return ev.tool ? ('running ' + ev.tool) : 'active';
  if (type === 'org:checkpoint') {
    const p = ev.progress || '';
    return p ? (p.length > 40 ? p.slice(0, 39) + '...' : p) : 'active';
  }
  if (type === 'org:comms') {
    if (!ev.to || ev.to === 'all') return 'broadcasting';
    return 'messaging ' + _v2RoleName(ev.to, roles);
  }
  if (type === 'org:artifact') {
    const label = ev.artifact && ev.artifact.label;
    return label ? ('writing ' + label) : 'active';
  }
  return 'active';
}

function v2DeriveLetterTarget(ev, roles) {
  if (!ev || !ev.from) return null;
  const type = ev.type || '';
  if (type === 'org:comms') {
    if (!ev.to || ev.to === 'all') return null;
    return { from: ev.from, to: ev.to };
  }
  if (type === 'org:checkpoint' || type === 'org:artifact') {
    const leader = (roles || []).find(_v2OrgIsLeader);
    if (!leader || leader.id === ev.from) return null;
    return { from: ev.from, to: leader.id };
  }
  return null;
}
```

- [ ] Step 3: Verify the pure functions by hand with node -e

These functions have zero DOM dependency, so they can be pasted into a scratch check. Run from repo root, defining a minimal roles fixture and a stub leader check, then call both derivation functions directly with sample event objects for org:tool, org:comms, and org:checkpoint, confirming the returned strings/objects match the mapping table in the design spec (e.g. an org:tool event with a tool field of "Bash" returns "running Bash"; an org:comms event with a to field resolves to "messaging <name>"; an org:checkpoint event resolves to a letter target pointed at the leader role).

Expected: no error, and the two derivation functions return the templated strings and letter-target objects described in the design spec's mapping table.

- [ ] Step 4: Commit

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard.html
git commit -m "feat(dashboard): add org-chart activity layout cache and event-derivation helpers"
```

---

### Task 2: Activity bubble - DOM scaffold, show/hide, idle timer

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard.html`

**Interfaces:**
- Consumes: `_v2ChartLayout.pos` (Task 1), the existing `esc()` helper (line 10458).
- Produces: `v2OrgActivityReset()`, `v2ShowActivityBubble(roleId, text)`, `_v2BubbleTimers` (module-level Map of role id to idle-timeout handle).

- [ ] Step 1: Add a foreignObject bubble placeholder per node

In the node-building loop inside v2RenderOrgChart (around line 6199-6207), extend the template literal for each node group to also emit a bubble placeholder as a sibling inside the same group, positioned above the node and initially hidden:

```js
      <foreignObject class="v2-activity-bubble" data-bubble-for="ROLEID" x="-70" y="YPOS" width="140" height="34" style="overflow:visible;pointer-events:none;visibility:hidden;opacity:0">
        <div class="v2-bubble-inner"></div>
      </foreignObject>
```

Where `ROLEID` is `${esc(role.id)}` and `YPOS` is `${-R - 46}` (46px above the node's top edge), substituted the same way the surrounding template literal already substitutes `role.id`, `nameY`, etc. The inner div needs the XHTML namespace attribute for foreignObject content to render: `xmlns` set to the XHTML namespace URL.

- [ ] Step 2: Add bubble CSS (static styling only - no keyframes/transitions, GSAP owns motion)

Insert near the existing org-chart rules (around line 430, after the `.org-chart-svg` rule):

```css
.v2-bubble-inner {
  background: oklch(18% 0.01 55 / 0.95);
  border: 1px solid oklch(72% 0.18 75 / 0.4);
  border-radius: 8px;
  padding: 4px 8px;
  font: 500 9.5px 'Inter', system-ui, sans-serif;
  color: oklch(88% 0.01 75);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] Step 3: Add v2OrgActivityReset, v2ShowActivityBubble, and the idle-timer map

Insert alongside the Task 1 derivation functions (after v2DeriveLetterTarget):

```js
let _v2BubbleTimers = new Map();

function v2OrgActivityReset() {
  _v2BubbleTimers.forEach(t => clearTimeout(t));
  _v2BubbleTimers = new Map();
}

function v2ShowActivityBubble(roleId, text) {
  const fo = document.querySelector('.v2-activity-bubble[data-bubble-for="' + CSS.escape(roleId) + '"]');
  if (!fo) return;
  const inner = fo.querySelector('.v2-bubble-inner');
  inner.textContent = text;
  if (typeof gsap !== 'undefined') {
    gsap.killTweensOf(fo);
    fo.style.visibility = 'visible';
    gsap.fromTo(fo, { scale: 0.8, autoAlpha: 0 }, {
      scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(1.7)',
      transformOrigin: '50% 100%',
    });
  } else {
    fo.style.visibility = 'visible';
    fo.style.opacity = '1';
  }
  const existing = _v2BubbleTimers.get(roleId);
  if (existing) clearTimeout(existing);
  _v2BubbleTimers.set(roleId, setTimeout(function() {
    if (typeof gsap !== 'undefined') {
      gsap.to(fo, { autoAlpha: 0, duration: 0.4, ease: 'power2.in', onComplete: function() { fo.style.visibility = 'hidden'; } });
    } else {
      fo.style.opacity = '0';
      fo.style.visibility = 'hidden';
    }
    _v2BubbleTimers.delete(roleId);
  }, 5000));
}
```

- [ ] Step 4: Verify via the agent-browser-testing skill

Start the dashboard against any saved org (`org run`, or the already-running control server on port 4242 per this session). Per this package's mandatory rule, invoke the agent-browser-testing skill and use the native browse client to:
1. Open the dashboard, select a running (or previously-run) org, switch to the org chart tab.
2. In the browser console, call `v2ShowActivityBubble` with a real role id from the chart and a test string.
3. Confirm a bubble pops in above that node with the test text, and fades out about 5 seconds later without manual intervention.

- [ ] Step 5: Commit

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard.html
git commit -m "feat(dashboard): add per-role activity bubble with GSAP show/fade"
```

---

### Task 3: Wire live SSE events into the activity bubble

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard.html` around line 8155-8168 (`_odtHandleLiveEvent`, right after the dedup check)

**Interfaces:**
- Consumes: `v2DeriveActivityText`, `v2ShowActivityBubble` (Tasks 1-2), `_v2OrgData.roles`, `_v2SelOrg`.

- [ ] Step 1: Add the hook call

In `_odtHandleLiveEvent` (starting line 8155), insert right after the dedup-set bookkeeping (after the `_odtChatSeenKeys.size > 2000` pruning block) and before the `ev?.org && ev?.runId` routing block:

```js
  if (ev && ev.org === _v2SelOrg) {
    const roles = Array.isArray(_v2OrgData && _v2OrgData.roles) ? _v2OrgData.roles : [];
    const text = v2DeriveActivityText(ev, roles);
    if (text && ev.from) v2ShowActivityBubble(ev.from, text);
  }
```

- [ ] Step 2: Verify with a synthetic event, following the ADR's established pattern

With the control server running (port 4242 per this session's status) and an org open in the dashboard on its org chart tab, POST a synthetic event to the same local endpoint the ADR already demonstrates for this system (docs/adrs/org-dashboard-v2-design.md lines 751-766):

```bash
curl -s -X POST http://localhost:4242/api/mastermind/event \
  -H 'Content-Type: application/json' \
  -d '{"type":"org:tool","org":"<org-name>","runId":"verify-activity-001","from":"<role-id>","tool":"Bash","ts":1799999999999}'
```

Expected: the target role's node shows a bubble reading "running Bash" within about a second, fading after 5 seconds. Use the agent-browser-testing skill to observe this.

- [ ] Step 3: Commit

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard.html
git commit -m "feat(dashboard): wire live org events into the org-chart activity bubble"
```

---

### Task 4: Flying letter animation

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard.html`

**Interfaces:**
- Consumes: `_v2ChartLayout` (Task 1), `v2DeriveLetterTarget` (Task 1).
- Produces: `v2SpawnLetter(fromId, toId)`, wired into `_odtHandleLiveEvent` alongside the Task 3 hook.

- [ ] Step 1: Add an SVG group for letters, alongside the particles group

In v2RenderOrgChart's assembled HTML (around line 6232, right after the particles group), add an empty sibling group:

```html
        <g id="v2oc-letters"></g>
```

- [ ] Step 2: Add the letter-spawning function

Insert alongside the other activity functions (after v2ShowActivityBubble from Task 2):

```js
let _v2LetterBurst = { lastTs: 0, count: 0 };

function v2SpawnLetter(fromId, toId) {
  const layout = _v2ChartLayout;
  const fp = layout.pos[fromId], tp = layout.pos[toId];
  if (!fp || !tp) return;
  const group = document.getElementById('v2oc-letters');
  if (!group) return;

  const now = Date.now();
  if (now - _v2LetterBurst.lastTs < 150) _v2LetterBurst.count++;
  else _v2LetterBurst.count = 0;
  _v2LetterBurst.lastTs = now;
  const delay = (_v2LetterBurst.count * 0.08).toFixed(2);

  const svgNS = 'http://www.w3.org/2000/svg';
  let pathId = layout.edgeIdByPair.get(fromId + '->' + toId);
  let synthesizedPath = null;
  if (!pathId) {
    pathId = 'v2lp' + Math.random().toString(36).slice(2, 9);
    synthesizedPath = document.createElementNS(svgNS, 'path');
    synthesizedPath.setAttribute('id', pathId);
    synthesizedPath.setAttribute('d', 'M' + fp.x + ',' + fp.y + ' L' + tp.x + ',' + tp.y);
    synthesizedPath.setAttribute('fill', 'none');
    synthesizedPath.setAttribute('stroke', 'none');
    document.getElementById('v2oc-edges').appendChild(synthesizedPath);
  }

  const letter = document.createElementNS(svgNS, 'g');
  const circ = document.createElementNS(svgNS, 'circle');
  circ.setAttribute('r', '6');
  circ.setAttribute('fill', 'oklch(85% 0.16 85)');
  circ.setAttribute('stroke', 'oklch(30% 0.02 55)');
  circ.setAttribute('stroke-width', '1');
  letter.appendChild(circ);
  const flap = document.createElementNS(svgNS, 'path');
  flap.setAttribute('d', 'M-3.5,-2 L0,1 L3.5,-2');
  flap.setAttribute('stroke', 'oklch(30% 0.02 55)');
  flap.setAttribute('stroke-width', '1');
  flap.setAttribute('fill', 'none');
  letter.appendChild(flap);

  const anim = document.createElementNS(svgNS, 'animateMotion');
  anim.setAttribute('dur', '0.8s');
  anim.setAttribute('begin', delay + 's');
  anim.setAttribute('fill', 'freeze');
  const mpath = document.createElementNS(svgNS, 'mpath');
  mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + pathId);
  anim.appendChild(mpath);
  letter.appendChild(anim);
  group.appendChild(letter);

  if (typeof gsap !== 'undefined') {
    gsap.fromTo(letter, { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.15, delay: Number(delay), ease: 'back.out(1.7)' });
  }

  const totalMs = (Number(delay) + 0.8) * 1000;
  setTimeout(function() {
    function cleanup() {
      letter.remove();
      if (synthesizedPath) synthesizedPath.remove();
    }
    if (typeof gsap !== 'undefined') {
      gsap.to(letter, { autoAlpha: 0, duration: 0.15, onComplete: cleanup });
    } else cleanup();
  }, totalMs);
}
```

- [ ] Step 3: Wire letter derivation into _odtHandleLiveEvent

Extend the Task 3 hook block (same location) to also spawn letters:

```js
  if (ev && ev.org === _v2SelOrg) {
    const roles = Array.isArray(_v2OrgData && _v2OrgData.roles) ? _v2OrgData.roles : [];
    const text = v2DeriveActivityText(ev, roles);
    if (text && ev.from) v2ShowActivityBubble(ev.from, text);
    const letterTarget = v2DeriveLetterTarget(ev, roles);
    if (letterTarget) v2SpawnLetter(letterTarget.from, letterTarget.to);
  }
```

- [ ] Step 4: Verify with synthetic message events, including a rapid burst

Using the same synthetic-event POST approach as Task 3 Step 2:

```bash
curl -s -X POST http://localhost:4242/api/mastermind/event \
  -H 'Content-Type: application/json' \
  -d '{"type":"org:comms","org":"<org-name>","runId":"verify-letter-001","from":"<role-a>","to":"<role-b>","msg":"status update","ts":1799999999999}'
```

Confirm (via the agent-browser-testing skill) that a small envelope icon travels from role-a's node to role-b's node along the existing edge (or a straight line if no static edge exists between them), then disappears on arrival. Then fire the same command three times in quick succession (within roughly 100ms of each other, varying the runId or msg per call) and confirm three visually distinct, staggered envelopes appear rather than one overlapping blob.

- [ ] Step 5: Commit

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard.html
git commit -m "feat(dashboard): animate flying letter along org-chart edges on message events"
```

---

### Task 5: Full end-to-end pass against a real running org

**Files:** None modified — verification only.

- [ ] Step 1: Run a real (not synthetic) org

Pick or create a small saved org (2-3 roles) and start it with the org run command.

- [ ] Step 2: Observe via agent-browser-testing

Open the dashboard, select the running org, watch the org chart tab for the duration of one or two agent turns. Confirm:
- Bubbles appear above whichever role is currently active, with plausible text (a running-tool phrase, a checkpoint excerpt, or a messaging phrase), and fade after about 5 seconds of that role's silence.
- Letters fly along edges whenever the boss/leader dispatches or a role reports/messages another, in the correct direction (source to destination).
- No console errors introduced by the new code (spot-check via the skill's console-read capability).

- [ ] Step 3: Report results

Summarize pass/fail per bullet above. If any bullet fails, return to the relevant task above and fix before considering the feature complete — do not commit a workaround for a known issue without discussing with the user first.

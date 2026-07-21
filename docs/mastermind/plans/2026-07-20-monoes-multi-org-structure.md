# Monoes Multi-Org Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up three independent Org Runtime v2 orgs — `monomind-dev`, `monoagent-dev` (which also runs monomind's growth function), `monoesp-landing-dev` — plus (deferred) future orgs for monoclip/monotask, each owning its own project's development, wired together via the existing `org_send` inter-org messaging primitive so a change in one project can trigger real work in another (docs updates, marketing content, feature requests).

**Architecture:** Hub-independent, mesh-capable — no single coordinating "Growth org"; `monoagent-dev` itself fills the growth role for monomind through one internal specialist, not through its point of contact. Each org keeps its own goal, roles, budget, and memory namespace (`org:<name>`) — full ownership isolation, no shared org state. Cross-org coordination happens exclusively through `org_send({to: "<orgName>:<roleId>", subject, message})`, delivered into the target role's mailbox (same-process direct push, or HTTP `POST /api/xdeliver` when orgs run in separate processes/hosts via `--cross-process`). There is no cross-org goal-linking field in the schema — goal alignment is achieved by convention (each org's goal references the others by name) plus the message contract defined in Task 5, not by a shared data structure.

**Org shape (revised):** every dev org is addressed at exactly one role, `lead` — the same role that sets priorities internally. There is no separate "communications" role and no growth-flavored framing on the contact point: `lead` is a generic engineering-team-lead, and any growth-specific work lives in its own specialist (`growth-engineer`, only in `monoagent-dev`) who is never the one other orgs talk to. A `researcher` role gives every org a place to gather context, internal (codebase, monograph, org memory) or external (`WebSearch`/`WebFetch` for prior art, library docs, competitive/trend intel), before a decision gets made rather than after. A `reviewer` role is a real quality gate on both code and UI, not a rubber stamp.

**Tech Stack:** Org Runtime v2 (`packages/@monomind/cli/src/orgrt/`), `monomind org` CLI (`create`, `validate`, `run --cross-process`, `serve --cross-process`, `test-loop`, `logs`, `questions`/`answer`), `org_send`/mailbox messaging, per-org SQLite memory (`org:<name>` namespace) + global brain (`~/.monomind/global-brain`) for read-only cross-project doc search.

## Global Constraints

- Every org config lives at `.monomind/orgs/<name>.json` and must pass `monomind org validate <name>` before it is run.
- Exactly one role per org has `reports_to: null` and `type: "boss"` — the schema requires this. Its `id` is `lead` and its `title` is `"Tech Lead"` in every org config in this plan — not `"CEO"` and not `"boss"` as a display name. The schema's `type` field stays `"boss"` internally (required), but nothing in `title`/`responsibilities` should read like a corporate-org-chart joke; this is a working engineering team.
- `lead` is the **only** role any other org addresses. It receives every inbound `org_send`, triages, delegates internally to the right specialist, and is accountable for the reply. This replaces the earlier per-org "liaison" role entirely — there is no `docs-liaison`/`growth-ops`/`site-liaison` id in this revision.
- Growth-specific work (social posting, trend/competitor crawling, drafting) lives only in `monoagent-dev`'s `growth-engineer` specialist. It is never the org's point of contact, and no other org's contact-point role carries growth framing.
- `memory_namespace` defaults to `org:<name>` and must stay unique per org — no shared namespace between orgs (that is what `org_send` and the global brain are for, not `memory_namespace`).
- Do not set `status: "running"` in a config by hand — orgs are started via `monomind org run <name> --cross-process`, never by editing `status` in the JSON.
- All cross-org communication goes through `org_send`; do not invent a shared file, shared board, or shared goal field — none exists in the current schema (confirmed: goals are strictly per-org, no `linked_org_goal` field).
- Every `frontend-dev` role's `responsibilities` must state, verbatim in spirit: invoke `Skill("monodesign")` before shipping any visual/UI change, and `Skill("monomotion")` before shipping any animation/motion change. Not optional — the same "no exceptions" rule from this repo's own CLAUDE.md applies to every org's frontend role.
- Every `reviewer` role's `responsibilities` must cover **both** code review (`backend-dev`'s output: correctness, security, quality) and design review (`frontend-dev`'s output, via `monodesign critique`/`monodesign audit`). It blocks handoff to `qa-tester` on any P0/P1 finding, and its block is final — `lead` does not overrule it to hit a deadline.
- Every `qa-tester` role's `responsibilities` must state it verifies shipped UI via `Skill("agent-browser-testing")` / `monomind browse` (the monobrowse CDP client) before marking a UI task done — never by reading code alone.
- Every `researcher` role's `responsibilities` must state it checks internal context first (monograph, codebase, org memory) and reaches for `WebSearch`/`WebFetch` when the answer isn't there — prior art, library documentation, competitor/trend signal, or verifying a claim before the team builds on it. It has no `fileWrite` scope; it informs decisions, it doesn't make them.
- `lead`'s responsibilities include holding the line on scope and quality: no unrequested scope creep, no bypassing `reviewer`'s gate, decisions grounded in what `researcher` actually found rather than guessed.
- This is a **planning-only** deliverable. No `monomind org run` command in this plan is to be executed until the user has reviewed and approved this document.

---

### Task 1: Goal hierarchy and role roster design (decision record)

**Files:**
- Create: `docs/mastermind/plans/2026-07-20-monoes-multi-org-structure.md` (this file — Task 1's "deliverable" is the table below, already part of the plan)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: the goal strings and role rosters that Tasks 2–4 embed verbatim into their org configs. Later tasks must reuse these exact `goal` strings and role `id`s — do not paraphrase.

- [ ] **Step 1: Record the goal-per-org table**

| Org | `goal` (verbatim, used in Task 2–4 configs) | Primary responsibility |
|---|---|---|
| `monomind-dev` | `Ship monomind CLI/MCP/hooks features and fixes; answer cross-org requests for changelog, docs content, and feature status` | Core product development for monomind |
| `monoagent-dev` | `Build and operate monoagent (social + web-crawl product) while running monomind's growth function through a dedicated specialist: turn monomind's shipped features into social content and competitive/trend intel` | monoagent product dev **and** monomind growth ops (same org, two responsibilities — see Task 4) |
| `monoesp-landing-dev` | `Build and maintain the monoesp umbrella landing site for monoagent/monoclip/monotask/monomind, weighted toward monomind's capabilities; fulfill page/docs requests from other orgs` | Landing site development, docs page fulfillment |
| `monoclip-dev` / `monotask-dev` (deferred) | Not created in this plan — Task 7 documents the exact repeat of Task 2's steps for these later | Future — same pattern as `monomind-dev` |

- [ ] **Step 2: Record the role roster per org**

Every dev org gets the **same six-role shape** — `lead`, `researcher`, `backend-dev`, `frontend-dev`, `reviewer`, `qa-tester`. `monoagent-dev` adds one more, `growth-engineer`, since it alone carries the growth-for-monomind function. This is deliberately uniform so Task 7 (future orgs) is a mechanical repeat, not a redesign — and deliberately does **not** have a separate communications/liaison role: `lead` is the single address every org uses.

`monomind-dev` roles:
- `lead` (type `boss`, reports_to `null`, title `"Tech Lead"`) — single point of contact for `monomind-dev`; receives every inbound `org_send` regardless of subject, triages and delegates to the right specialist below, sets priority, has final say, and is accountable for the reply
- `researcher` (type `specialist`, reports_to `lead`) — gathers context before `lead` or `backend-dev`/`frontend-dev` commit to an approach: internal (codebase, monograph, org memory) first, `WebSearch`/`WebFetch` when internal context is insufficient (prior art, library docs, how another project solved the same problem)
- `backend-dev` (type `specialist`, reports_to `lead`) — implements CLI/MCP/hooks features and fixes in the monomind repo
- `frontend-dev` (type `specialist`, reports_to `lead`) — implements the monomind dashboard UI (`packages/@monomind/cli/src/ui`); invokes `Skill("monodesign")` for any visual work and `Skill("monomotion")` for any animation work
- `reviewer` (type `specialist`, reports_to `lead`) — reviews `backend-dev`'s code for correctness/security/quality and `frontend-dev`'s UI via `monodesign critique`/`audit`; blocks handoff to `qa-tester` on any P0/P1 finding
- `qa-tester` (type `specialist`, reports_to `lead`) — verifies shipped UI live via `Skill("agent-browser-testing")` before a UI task is marked done

`monoagent-dev` roles:
- `lead` (type `boss`, reports_to `null`, title `"Tech Lead"`) — single point of contact for `monoagent-dev`; same responsibilities as above, for monoagent's own product AND the growth function (delegated to `growth-engineer`, never handled by `lead` directly posing as a growth role)
- `researcher` (type `specialist`, reports_to `lead`) — same as above, scoped to monoagent's own product decisions
- `backend-dev` (type `specialist`, reports_to `lead`) — builds monoagent itself (social/crawl product backend)
- `frontend-dev` (type `specialist`, reports_to `lead`) — builds monoagent's own UI; invokes `Skill("monodesign")` and `Skill("monomotion")` per the Global Constraints
- `reviewer` (type `specialist`, reports_to `lead`) — reviews `backend-dev`'s code and `frontend-dev`'s UI before either ships
- `qa-tester` (type `specialist`, reports_to `lead`) — verifies shipped monoagent UI via `Skill("agent-browser-testing")`
- `growth-engineer` (type `specialist`, reports_to `lead`) — the growth-for-monomind role: sends `changelog-request` to `monomind-dev:lead` to learn what shipped, drafts social posts, sends `docs-page-request` to `monoesp-landing-dev:lead` when a feature needs a landing-page section. Not addressable by other orgs directly — inbound requests about growth status still land on `monoagent-dev:lead`, which delegates to `growth-engineer` and relays the answer back

`monoesp-landing-dev` roles:
- `lead` (type `boss`, reports_to `null`, title `"Tech Lead"`) — single point of contact for `monoesp-landing-dev`
- `researcher` (type `specialist`, reports_to `lead`) — same as above, scoped to site/content decisions
- `backend-dev` (type `specialist`, reports_to `lead`) — builds/maintains the site's build pipeline and content plumbing
- `frontend-dev` (type `specialist`, reports_to `lead`) — builds the site's pages and components; invokes `Skill("monodesign")` and `Skill("monomotion")` per the Global Constraints — the highest-frontend-load org in the plan since the site IS the product
- `reviewer` (type `specialist`, reports_to `lead`) — the most consequential review gate in the plan: the umbrella site is monoes's most visible surface
- `qa-tester` (type `specialist`, reports_to `lead`) — verifies every shipped page/section live via `Skill("agent-browser-testing")`

- [ ] **Step 3: Commit the decision record**

```bash
git add docs/mastermind/plans/2026-07-20-monoes-multi-org-structure.md
git commit -m "docs: revise monoes multi-org structure — lead as sole contact, add researcher/reviewer, decouple growth from comms"
```

---

### Task 2: Create `monomind-dev` org config

**Files:**
- Create: `.monomind/orgs/monomind-dev.json`

**Interfaces:**
- Consumes: goal string and role roster from Task 1, Step 2
- Produces: an org named `monomind-dev` with roles `lead`, `researcher`, `backend-dev`, `frontend-dev`, `reviewer`, `qa-tester` — `monomind-dev:lead` is the single addressing target other orgs use (Task 4, Task 5)

- [ ] **Step 1: Scaffold from the dev-team template**

```bash
monomind org create monomind-dev --template dev-team --goal "Ship monomind CLI/MCP/hooks features and fixes; answer cross-org requests for changelog, docs content, and feature status"
```

- [ ] **Step 2: Rename the scaffold's default roles to `lead` and `backend-dev`**

```bash
jq '.roles[].id' .monomind/orgs/monomind-dev.json
```
Expected: `dev-team` template roles include one `type: "boss"` role (typically `id: "boss"`) and one `specialist` (typically `id: "dev"`). Rename both — `boss` reads as a corporate-org-chart title and isn't what this role does here (it's the team's single external contact point, not an executive):

```bash
jq '(.roles[] | select(.type == "boss") | .id) = "lead" | (.roles[] | select(.type == "boss") | .title) = "Tech Lead" | (.roles[] | select(.id == "dev") | .id) = "backend-dev"' .monomind/orgs/monomind-dev.json > /tmp/monomind-dev.json && mv /tmp/monomind-dev.json .monomind/orgs/monomind-dev.json
```
If the template's specialist id is already something other than `"dev"`, adjust the `select(.id == "dev")` filter to match before running. Then append to `lead`'s `responsibilities` array (it likely starts empty or template-generic):

```bash
jq '(.roles[] | select(.id == "lead") | .responsibilities) = [
  "Single point of contact for monomind-dev — receive every inbound org_send from any org, regardless of subject",
  "Triage each inbound message and delegate to researcher, backend-dev, frontend-dev, reviewer, or qa-tester as appropriate",
  "Set priority and scope for the backlog; final say, but never overrule reviewer'\''s P0/P1 block to hit a deadline",
  "Reply to the originating org via org_send once the delegated work (or the direct answer) is ready",
  "Ground decisions in what researcher actually found, not assumptions"
]' .monomind/orgs/monomind-dev.json > /tmp/monomind-dev.json && mv /tmp/monomind-dev.json .monomind/orgs/monomind-dev.json
```

- [ ] **Step 3: Add `researcher`, `frontend-dev`, `reviewer`, and `qa-tester`**

Edit `.monomind/orgs/monomind-dev.json`, appending each of these to the `roles` array:

```json
{
  "id": "researcher",
  "title": "Researcher",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Check internal context first — codebase, monograph, org memory — before reaching for external sources",
    "Use WebSearch/WebFetch when internal context is insufficient: prior art, library documentation, how comparable projects solved the same problem, or verifying a claim before the team builds on it",
    "Report findings with sources back to lead (or directly to backend-dev/frontend-dev when the ask was implementation-specific)",
    "No file-write access — informs decisions, does not make them"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
},
{
  "id": "frontend-dev",
  "title": "Frontend Developer",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Implement the monomind dashboard UI (packages/@monomind/cli/src/ui)",
    "Invoke Skill(\"monodesign\") before shipping any visual/UI change — no exceptions",
    "Invoke Skill(\"monomotion\") before shipping any animation/motion change — no exceptions",
    "Hand off finished UI work to reviewer before it is considered done"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": ["src/ui/**"], "fileRead": ["**"] }
},
{
  "id": "reviewer",
  "title": "Reviewer",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Review backend-dev's code for correctness, security, and quality before it ships",
    "Run monodesign critique and monodesign audit against frontend-dev's shipped output",
    "Block handoff to qa-tester on any P0/P1 finding from either review; return specific, actionable notes",
    "Approve and hand off to qa-tester once findings are resolved or explicitly waived by lead — never self-waived"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
},
{
  "id": "qa-tester",
  "title": "QA Tester",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Verify every shipped UI change live via Skill(\"agent-browser-testing\") / monomind browse — never by reading code alone",
    "File a structured pass/fail/warn report per change; block release on fail",
    "Escalate to lead if a change cannot be verified (e.g. missing dev server)"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
}
```

- [ ] **Step 4: Validate the config**

```bash
monomind org validate monomind-dev
```
Expected: `monomind-dev: valid` (exit code 0). If it fails, the error names the offending field — fix it before proceeding; do not run the org until this passes.

- [ ] **Step 5: Commit**

```bash
git add .monomind/orgs/monomind-dev.json
git commit -m "feat(orgrt): add monomind-dev org config"
```

---

### Task 3: Create `monoesp-landing-dev` org config

**Files:**
- Create: `.monomind/orgs/monoesp-landing-dev.json`

**Interfaces:**
- Consumes: goal string from Task 1; addresses `monomind-dev:lead` and `monoagent-dev:lead` (produced by Task 2 and Task 4) in its `lead` responsibilities text
- Produces: an org named `monoesp-landing-dev` with roles `lead`, `researcher`, `backend-dev`, `frontend-dev`, `reviewer`, `qa-tester` — `monoesp-landing-dev:lead` is the addressing target Task 5's message contract uses

- [ ] **Step 1: Scaffold from the dev-team template**

```bash
monomind org create monoesp-landing-dev --template dev-team --goal "Build and maintain the monoesp umbrella landing site for monoagent/monoclip/monotask/monomind, weighted toward monomind's capabilities; fulfill page/docs requests from other orgs"
```

- [ ] **Step 2: Rename the scaffold's default roles to `lead` and `backend-dev`**

```bash
jq '.roles[].id' .monomind/orgs/monoesp-landing-dev.json
jq '(.roles[] | select(.type == "boss") | .id) = "lead" | (.roles[] | select(.type == "boss") | .title) = "Tech Lead" | (.roles[] | select(.id == "dev") | .id) = "backend-dev"' .monomind/orgs/monoesp-landing-dev.json > /tmp/monoesp-landing-dev.json && mv /tmp/monoesp-landing-dev.json .monomind/orgs/monoesp-landing-dev.json
jq '(.roles[] | select(.id == "lead") | .responsibilities) = [
  "Single point of contact for monoesp-landing-dev — receive every inbound org_send from any org, regardless of subject",
  "Triage each inbound message and delegate to researcher, backend-dev, frontend-dev, reviewer, or qa-tester as appropriate",
  "Set priority and scope for the site backlog; final say, but never overrule reviewer'\''s P0/P1 block to hit a deadline",
  "Reply to the originating org via org_send once the delegated work is ready",
  "Ground decisions in what researcher actually found, not assumptions"
]' .monomind/orgs/monoesp-landing-dev.json > /tmp/monoesp-landing-dev.json && mv /tmp/monoesp-landing-dev.json .monomind/orgs/monoesp-landing-dev.json
```

- [ ] **Step 3: Add `researcher`, `frontend-dev`, `reviewer`, and `qa-tester`**

Edit `.monomind/orgs/monoesp-landing-dev.json`, appending each of these to `roles`:

```json
{
  "id": "researcher",
  "title": "Researcher",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Check internal context first — the site's own content/config, monograph, org memory",
    "Use WebSearch/WebFetch for external research: competitor landing pages, copywriting/positioning prior art, current best practice for the section being built",
    "Report findings with sources back to lead or directly to frontend-dev when the ask is page-specific",
    "No file-write access — informs decisions, does not make them"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
},
{
  "id": "frontend-dev",
  "title": "Frontend Developer",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Build and maintain the site's pages and components — the highest-frontend-load role in the plan since the site IS the product",
    "Invoke Skill(\"monodesign\") before shipping any visual/UI change — no exceptions",
    "Invoke Skill(\"monomotion\") before shipping any animation/motion change — no exceptions",
    "Keep the monomind section weighted as flagship: more prominent placement and more detail than monoagent/monoclip/monotask sections",
    "Hand off finished pages to reviewer before they are considered done"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": ["src/**", "content/**"], "fileRead": ["**"] }
},
{
  "id": "reviewer",
  "title": "Reviewer",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Review backend-dev's build/content pipeline changes for correctness and quality",
    "Run monodesign critique and monodesign audit against every shipped page — the umbrella site is the most visible surface across all of monoes, so this gate matters most here",
    "Block handoff to qa-tester on any P0/P1 finding",
    "Approve and hand off to qa-tester once findings are resolved or explicitly waived by lead"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
},
{
  "id": "qa-tester",
  "title": "QA Tester",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Verify every shipped page/section live via Skill(\"agent-browser-testing\") / monomind browse before it's marked done",
    "File a structured pass/fail/warn report per page; block release on fail",
    "Pay special attention to the monomind section given its flagship weighting"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
}
```

- [ ] **Step 4: Validate**

```bash
monomind org validate monoesp-landing-dev
```
Expected: `monoesp-landing-dev: valid`.

- [ ] **Step 5: Commit**

```bash
git add .monomind/orgs/monoesp-landing-dev.json
git commit -m "feat(orgrt): add monoesp-landing-dev org config"
```

---

### Task 4: Create `monoagent-dev` org config (dev + growth-for-monomind)

**Files:**
- Create: `.monomind/orgs/monoagent-dev.json`

**Interfaces:**
- Consumes: goal string from Task 1; addresses `monomind-dev:lead` (Task 2) and `monoesp-landing-dev:lead` (Task 3)
- Produces: an org named `monoagent-dev` with roles `lead`, `researcher`, `backend-dev`, `frontend-dev`, `reviewer`, `qa-tester`, `growth-engineer` — `monoagent-dev:lead` is the addressing target other orgs use for anything, including growth-status questions, which `lead` delegates internally to `growth-engineer`

- [ ] **Step 1: Scaffold from the dev-team template**

```bash
monomind org create monoagent-dev --template dev-team --goal "Build and operate monoagent (social + web-crawl product) while running monomind's growth function through a dedicated specialist: turn monomind's shipped features into social content and competitive/trend intel"
```

- [ ] **Step 2: Rename the scaffold's default roles to `lead` and `backend-dev`**

```bash
jq '.roles[].id' .monomind/orgs/monoagent-dev.json
jq '(.roles[] | select(.type == "boss") | .id) = "lead" | (.roles[] | select(.type == "boss") | .title) = "Tech Lead" | (.roles[] | select(.id == "dev") | .id) = "backend-dev"' .monomind/orgs/monoagent-dev.json > /tmp/monoagent-dev.json && mv /tmp/monoagent-dev.json .monomind/orgs/monoagent-dev.json
jq '(.roles[] | select(.id == "lead") | .responsibilities) = [
  "Single point of contact for monoagent-dev — receive every inbound org_send from any org, regardless of subject",
  "Triage each inbound message and delegate to researcher, backend-dev, frontend-dev, reviewer, qa-tester, or growth-engineer as appropriate",
  "Growth-status questions from other orgs are delegated to growth-engineer internally, then answered by lead — lead itself carries no growth framing",
  "Set priority and scope for monoagent'\''s own product backlog; final say, but never overrule reviewer'\''s P0/P1 block to hit a deadline",
  "Ground decisions in what researcher actually found, not assumptions"
]' .monomind/orgs/monoagent-dev.json > /tmp/monoagent-dev.json && mv /tmp/monoagent-dev.json .monomind/orgs/monoagent-dev.json
```

- [ ] **Step 3: Add `researcher`, `frontend-dev`, `reviewer`, `qa-tester`, and `growth-engineer`**

Edit `.monomind/orgs/monoagent-dev.json`, appending each of these to `roles`:

```json
{
  "id": "researcher",
  "title": "Researcher",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Check internal context first — monoagent's own codebase, monograph, org memory",
    "Use WebSearch/WebFetch for external research: prior art for monoagent's own product features, plus factual grounding growth-engineer needs (competitor moves, trend verification) before it's turned into a claim in a post",
    "Report findings with sources back to lead, backend-dev/frontend-dev, or growth-engineer depending on who asked",
    "No file-write access — informs decisions, does not make them"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
},
{
  "id": "frontend-dev",
  "title": "Frontend Developer",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Build monoagent's own product UI",
    "Invoke Skill(\"monodesign\") before shipping any visual/UI change — no exceptions",
    "Invoke Skill(\"monomotion\") before shipping any animation/motion change — no exceptions",
    "Hand off finished UI work to reviewer before it is considered done"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": ["src/ui/**"], "fileRead": ["**"] }
},
{
  "id": "reviewer",
  "title": "Reviewer",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Review backend-dev's code for correctness, security, and quality",
    "Run monodesign critique and monodesign audit against frontend-dev's shipped output",
    "Block handoff to qa-tester on any P0/P1 finding",
    "Approve and hand off to qa-tester once findings are resolved or explicitly waived by lead"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
},
{
  "id": "qa-tester",
  "title": "QA Tester",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Verify every shipped monoagent UI change live via Skill(\"agent-browser-testing\") / monomind browse before it's marked done",
    "File a structured pass/fail/warn report per change; block release on fail"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
},
{
  "id": "growth-engineer",
  "title": "Growth Engineer",
  "type": "specialist",
  "reports_to": "lead",
  "responsibilities": [
    "Not the org's point of contact — inbound growth-status questions arrive at lead and are delegated here, never addressed to growth-engineer directly",
    "Send changelog-request messages to monomind-dev:lead on a schedule (see run_config.schedule) to learn what shipped",
    "Draft social posts from the returned changelog summaries, fact-checked against researcher's findings, using monoagent's own social-posting capability",
    "When a shipped feature needs a public-facing landing page section, send a docs-page-request message to monoesp-landing-dev:lead",
    "Use monoagent's web-crawl capability to gather competitor/trend intel; do not use it to scrape monoes's own properties"
  ],
  "adapter_config": { "model": "claude-sonnet-5" },
  "provider": { "kind": "subscription" },
  "policy": { "denyTools": [], "fileWrite": [], "fileRead": ["**"] }
}
```
Note `fileWrite: []` on `researcher`, `reviewer`, `qa-tester`, and `growth-engineer` — none of these commit code to any repo; only `backend-dev` and `frontend-dev` have `fileWrite` scopes.

- [ ] **Step 4: Set the growth polling schedule and concurrency**

Edit `run_config` in `.monomind/orgs/monoagent-dev.json`: raise `max_concurrent_agents` from the template default of 4 to 7 (one per role — this org has seven), and set `schedule` to `"2h"` so `growth-engineer`'s changelog polling runs on a fixed cadence rather than only on manual wake:

```json
"run_config": {
  "max_concurrent_agents": 7,
  "budget_tokens": 1000000,
  "memory_namespace": "org:monoagent-dev",
  "max_turns_per_message": 30,
  "idle_minutes": 10
},
"schedule": "2h"
```
Apply the equivalent concurrency bump to `monomind-dev.json` and `monoesp-landing-dev.json` (Tasks 2 and 3) — both have six roles, not seven, so use `6`:
```bash
jq '.run_config.max_concurrent_agents = 6' .monomind/orgs/monomind-dev.json > /tmp/monomind-dev.json && mv /tmp/monomind-dev.json .monomind/orgs/monomind-dev.json
jq '.run_config.max_concurrent_agents = 6' .monomind/orgs/monoesp-landing-dev.json > /tmp/monoesp-landing-dev.json && mv /tmp/monoesp-landing-dev.json .monomind/orgs/monoesp-landing-dev.json
```

- [ ] **Step 5: Validate**

```bash
monomind org validate monoagent-dev
```
Expected: `monoagent-dev: valid`.

- [ ] **Step 6: Commit**

```bash
git add .monomind/orgs/monoagent-dev.json
git commit -m "feat(orgrt): add monoagent-dev org config with growth-engineer role"
```

---

### Task 5: Document and smoke-test the inter-org message contract

**Files:**
- Create: `docs/orgrt/inter-org-message-contract.md`

**Interfaces:**
- Consumes: `lead` role ids from Tasks 2–4 (`monomind-dev:lead`, `monoesp-landing-dev:lead`, `monoagent-dev:lead`)
- Produces: three message `subject` strings (`changelog-request`, `docs-page-request`, `feature-request`) that every org's role `responsibilities` already reference by name. The contract is written as a convention any monoes org can adopt — always addressed to the target org's `lead`, never to a named growth or comms role — so Task 7's future orgs plug into it unchanged.

- [ ] **Step 1: Write the contract doc**

```markdown
# Inter-Org Message Contract — monoes orgs

All messages use `org_send({ to: "<orgName>:<roleId>", subject, message })`.
Every dev org exposes exactly one role, `lead`, as its external contact point.
There is no growth-specific or comms-specific contact role — `lead` receives
everything and delegates internally. Any specialist role (e.g. growth-engineer)
may *originate* a message using its own org_send call, but replies and inbound
requests always target the recipient org's `lead`.

## `changelog-request`
- Sender: any role, on behalf of its org (today: `monoagent-dev:growth-engineer`)
- Recipient: `<targetOrg>:lead` (today: `monomind-dev:lead`)
- `message` body: `{"since": "<ISO8601 date>"}`
- Expected reply: `org_send` back to the exact sending role with subject
  `changelog-response`, body `{"items": [{"title": str, "summary": str, "prLink": str}]}`

## `docs-page-request`
- Sender: any role, on behalf of its org (today: `monoagent-dev:growth-engineer` or `monomind-dev:lead`)
- Recipient: `<targetOrg>:lead` (today: `monoesp-landing-dev:lead`)
- `message` body: `{"feature": str, "summary": str, "priority": "flagship" | "standard"}`
  (`priority: "flagship"` is used for monomind features per the weighting requirement —
  the landing org's `lead` has `frontend-dev` place these above monoagent/monoclip/monotask content)
- Expected reply: `org_send` back to the exact sending role with subject `docs-page-response`,
  body `{"url": str, "status": "published" | "queued"}`

## `feature-request`
- Sender: any role, on behalf of its org
- Recipient: `<targetOrg>:lead`, which triages internally (optionally looping in `researcher`
  before committing) rather than forwarding to a separate strategist role — this plan does
  not have one
- `message` body: `{"title": str, "description": str, "priority": "flagship" | "standard", "requestedBy": "<orgName>"}`
- Expected reply: `org_send` back to the exact sending role with subject
  `feature-request-response`, body `{"status": "queued" | "in_progress" | "declined", "ticketRef": str | null, "note": str}`
- This is the general "build/change something in another project" channel — e.g.
  monoesp-landing-dev's `lead` asking monomind-dev's `lead` to expose a new API field
  a page needs, or a future monoclip-dev asking monomind-dev for a feature.
```

- [ ] **Step 2: Commit the doc**

```bash
git add docs/orgrt/inter-org-message-contract.md
git commit -m "docs(orgrt): define changelog-request/docs-page-request/feature-request contract, lead-only addressing"
```

- [ ] **Step 3: Dry-run each org individually (no live delivery yet)**

```bash
monomind org run monomind-dev --dry-run
monomind org run monoagent-dev --dry-run
monomind org run monoesp-landing-dev --dry-run
```
Expected: each prints its resolved role list and goal with no errors, and does not start a daemon (dry-run only validates + prints the execution plan).

---

### Task 6: End-to-end cross-org flow verification (deferred to explicit user approval)

**Files:**
- Modify: none (this task only runs existing orgs; it creates no new files besides logs)

**Interfaces:**
- Consumes: the three org configs from Tasks 2–4 and the contract from Task 5
- Produces: a verified live run demonstrating the flow: `monomind-dev` ships a feature → `monoagent-dev:growth-engineer` sends `changelog-request` to `monomind-dev:lead` → gets `changelog-response` → drafts a post → sends `docs-page-request` to `monoesp-landing-dev:lead` → that `lead` delegates to `frontend-dev`/`reviewer`/`qa-tester` → gets `docs-page-response`

- [ ] **Step 1: Start all three orgs cross-process**

```bash
monomind org run monomind-dev --cross-process &
monomind org run monoagent-dev --cross-process &
monomind org run monoesp-landing-dev --cross-process &
```
**Do not run this step until the user has reviewed and approved Tasks 1–5.** This is the first step in the plan that actually starts live, budget-consuming agents.

- [ ] **Step 2: Trigger the flow via `test-loop`**

```bash
monomind org test-loop monoagent-dev -n 1
```
Expected: one full heartbeat of `monoagent-dev`, during which `growth-engineer` should emit a `changelog-request` (visible via Step 3).

- [ ] **Step 3: Inspect the message trail**

```bash
monomind org logs monomind-dev --role lead --follow
monomind org logs monoagent-dev --role growth-engineer --follow
monomind org logs monoesp-landing-dev --role lead --follow
```
Expected: `monomind-dev:lead` log shows an inbound `changelog-request` and an outbound `changelog-response`; `growth-engineer` log shows the same request/response plus an outbound `docs-page-request`; `monoesp-landing-dev:lead` log shows the inbound `docs-page-request` and its internal delegation to `frontend-dev`.

- [ ] **Step 4: Stop the orgs**

```bash
monomind org stop monomind-dev
monomind org stop monoagent-dev
monomind org stop monoesp-landing-dev
```

- [ ] **Step 5: Commit any log/report artifacts worth keeping**

```bash
monomind org report monoagent-dev --run <run-id> > docs/orgrt/2026-07-20-first-cross-org-run-report.md
git add docs/orgrt/2026-07-20-first-cross-org-run-report.md
git commit -m "docs(orgrt): record first monomind<->monoagent<->monoesp-landing cross-org run"
```

---

### Task 7: Deferred rollout — monoclip-dev and monotask-dev

**Files:**
- Create (future, not in this plan's scope): `.monomind/orgs/monoclip-dev.json`, `.monomind/orgs/monotask-dev.json`

**Interfaces:**
- Consumes: the exact pattern from Task 2 (scaffold → rename to `lead`/`backend-dev` → add `researcher`/`frontend-dev`/`reviewer`/`qa-tester` → validate → commit)
- Produces: nothing yet — this task is a placeholder recording the repeat steps for later, not something to execute now

- [ ] **Step 1: Record the repeat instruction**

When ready, repeat Task 2's steps for `monoclip-dev` and `monotask-dev`, each getting the same six-role shape (`lead`, `researcher`, `backend-dev`, `frontend-dev`, `reviewer`, `qa-tester`). Because the Task 5 contract always targets `<org>:lead`, `monoesp-landing-dev:lead` and `monoagent-dev:growth-engineer` can address the new orgs' `lead` the same way they address `monomind-dev:lead`, with no change to their own configs. No plan changes needed — this is Task 2's template applied twice more.

---

## Self-Review Notes

- **Spec coverage:** each project (monomind, monoesp-landing, monoagent) gets its own org+dev team (Tasks 2–4); monoagent's growth-for-monomind responsibility lives in a dedicated `growth-engineer` specialist, decoupled from the org's point of contact (Task 4, Step 3); inter-org talk is the `changelog-request`/`docs-page-request`/`feature-request` contract, uniformly addressed to `lead` (Task 5); the end-to-end example is exercised in Task 6; monoclip/monotask are explicitly deferred (Task 7).
- **Communications role decoupled from growth:** the earlier revision had `monoagent-dev`'s contact point be `growth-ops` — a role whose name and framing were about growth. That's now split: `lead` is the generic, org-agnostic contact point (identical role, identical responsibilities, across all three orgs), and `growth-engineer` is a pure internal specialist that `lead` delegates to. No org's external-facing role carries product-specific framing.
- **Boss renamed and repurposed:** `type: "boss"` stays (schema requirement) but `id`/`title` changed from `boss`/`"CEO"` to `lead`/`"Tech Lead"`, and its responsibilities now explicitly include being the message receiver — this was the user's own suggestion, and it removes the need for a separate liaison role entirely (one role, one job: receive, triage, delegate, prioritize, reply).
- **Professional development, not corporate-org-chart humor:** every title in this roster (Tech Lead, Researcher, Backend/Frontend Developer, Reviewer, QA Tester, Growth Engineer) describes a real function on a real engineering team. `researcher` is new: it gives every org a place to do actual investigation (internal context first, `WebSearch`/`WebFetch` when needed) before a decision or an implementation choice gets made, rather than guessing. `reviewer` (renamed from `design-critic`) now covers code review as well as design critique, not just UI.
- **Open to future orgs:** `lead` is documented as accepting `org_send` from any org name, and the Task 5 contract is written as a convention (subject/body shape, always addressed to `lead`) rather than a fixed sender-recipient table, so Task 7's `monoclip-dev`/`monotask-dev` — or any org not yet conceived — plug in without touching the three configs built here.
- **No shared goal object:** confirmed via research — goals are per-org only, so alignment is carried by convention (goal text referencing other orgs) plus the message contract, not a schema field.
- **Memory:** `memory_namespace` stays per-org (`org:<name>`); no task shares a namespace between orgs, per the Global Constraints.
- **Budget:** Task 6 is the only step that starts live, token-consuming agents, and it's explicitly gated on user approval given the budget spike flagged earlier in this session. Six or seven roles per org versus the template's three roughly doubles the concurrent-agent ceiling needed — `max_concurrent_agents` is bumped to 6 (monomind-dev, monoesp-landing-dev) and 7 (monoagent-dev) in Task 4, Step 4.

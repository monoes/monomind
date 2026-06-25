# Mastermind Commands Reference

> All `/mastermind:*` slash commands for autonomous agent orchestration, building, reviewing, and business operations. Invoke inside Claude Code.

---

## Overview

Mastermind is a command namespace for high-level autonomous operations. Each command follows a common pattern:

1. **Brain Load** — loads context from LanceDB (`mastermind:*` namespace) via the _protocol.md Brain Load Procedure
2. **Intake** — optional 5-question intake if the prompt is vague
3. **Skill execution** — delegates to the corresponding skill file
4. **Brain Write** — saves results and context back to LanceDB
5. **Repeat Postamble** — handles `--tillend`/`--repeat` loop scheduling

### Universal Flags

| Flag | Purpose |
|---|---|
| `--tillend` | Repeat until empty round (no findings, no actions) |
| `--repeat <N>` | Repeat exactly N times |
| `--wait <seconds>` | Minimum seconds between repeats (default: 60) |
| `--maxruns <N>` | Safety cap for `--tillend` (default: 50) |
| `--auto` | Mode: auto (no confirmation prompts) |
| `--confirm` | Mode: confirm (ask before each action) |

---

## `/mastermind` (no namespace)

**Purpose:** Swarm and hive-mind topology picker.

Shows all 11 modes (6 swarm topologies + 5 hive-mind modes), asks for task description, gives ONE concrete recommendation with ready-to-use launch commands.

```
/mastermind
/mastermind build a feature with 8 agents
```

---

## Core Engineering

### `/mastermind:autodev`

**Purpose:** Autonomous research → build → review loop.

Researches the project, picks the single best improvement, builds it, reviews until clean — then repeats.

```
/mastermind:autodev                    # 1 improvement (default)
/mastermind:autodev 3                  # 3 improvements in sequence
/mastermind:autodev 3 --tillend        # 3 per session, repeat until done
/mastermind:autodev --focus security   # bias toward security improvements
/mastermind:autodev --focus dx         # bias toward developer experience
/mastermind:autodev --newfeature 5     # discover & fully deliver 5 brand-new features
```

**Phases (per improvement):**
1. **Research** — parallel: git log, file scan, package.json, README, TODO/FIXME grep, monograph god nodes + suggest, memory search for already-built items
2. **Selection** — ranked list of 3–5 candidates; picks by feasibility + blast radius + focus alignment; stores selection to memory
3. **Build** — invokes `mastermind:build` with concrete spec, acceptance criteria, blast radius guard
4. **Review** (inline loop, max 5 iterations) — invokes `mastermind:review` until zero findings
5. **Log** — records completion to memory; continues to next improvement if count > 1

**Leading integer = number of improvements** per session. `--tillend` keeps scheduling new sessions until an empty round.

#### `--newfeature N` — Feature Discovery Mode

Switches from improvement mode to a full end-to-end feature delivery pipeline. Instead of fixing or improving existing code, it discovers the N best genuinely-new capabilities the project is missing and delivers each one completely.

```
/mastermind:autodev --newfeature 3               # discover and deliver 3 new features
/mastermind:autodev --newfeature 5 --confirm     # review shortlist before building
/mastermind:autodev --newfeature 3 --focus dx    # bias discovery toward DX features
```

**Pipeline (per feature):**

| Phase | What happens |
|---|---|
| **FP-0 Discovery** | Researches the project (git log, monograph, memory dedup) and produces a ranked shortlist of N genuinely-new features — not bugfixes, not refactors |
| **Phase A — Build** | Invokes `mastermind:build` with a detailed spec: declared file list, acceptance criteria (3–5), blast radius guard, test requirements |
| **Phase B — Review** | Inline review loop (max 5 iterations) until clean; uses before/after snapshots to track only files this phase touches |
| **Phase C — Documentation** | Generates inline docstrings, README bullet, and CHANGELOG entry (only if CHANGELOG.md already exists) |
| **Phase D — Delivery** | Stages only this feature's files — never `git add --all`; prints a suggested commit message |
| **FP-End** | Summary table with per-feature status (`staged` / `no-op` / `skipped`), tmp cleanup, and staged count |

**Notes:**
- `--newfeature` is **incompatible with `--tillend`** — the flag is silently stripped if both are present
- Features are capped at 10 per session (parse-time enforcement)
- Nothing is committed — staging only; the user runs `git commit`
- `--confirm` shows the ranked shortlist and waits for approval before building anything

---

### `/mastermind:build`

**Purpose:** Build a specific feature or improvement.

```
/mastermind:build add pagination to the users API endpoint
/mastermind:build --confirm implement OAuth2 flow
```

**What it does:**
1. Takes the brief and runs intake if vague
2. Creates a monotask board with subtasks
3. Spawns specialist agents (architect → coder → tester → reviewer)
4. Tracks progress to completion

---

### `/mastermind:review`

**Purpose:** Iterative code review until clean.

```
/mastermind:review review the auth module
/mastermind:review --tillend --auto    # keep reviewing until clean
/mastermind:review --tillend --maxruns 10 --wait 120
```

**What it does:**
- Runs Code Reviewer + Security Engineer + Reality Checker in parallel
- Auto-fixes findings
- Writes human-in-loop items to `humaninloopreview-YYYY-MM-DD.md` for decisions requiring human input
- Repeats until zero findings (with `--tillend`)

---

### `/mastermind:architect`

**Purpose:** System architecture and design.

```
/mastermind:architect design the notification service
/mastermind:architect review current architecture and suggest improvements
```

---

### `/mastermind:research`

**Purpose:** Deep research on a topic with structured output.

```
/mastermind:research best practices for distributed rate limiting
/mastermind:research competitive analysis of similar tools
```

---

### `/mastermind:techport`

**Purpose:** Technical portfolio — assess and document the technical state of the project.

```
/mastermind:techport
/mastermind:techport security posture
```

---

## Business & Strategy

### `/mastermind:idea`

**Purpose:** Idea generation and evaluation for the project.

```
/mastermind:idea what features would drive the most growth?
/mastermind:idea improve developer onboarding
```

---

### `/mastermind:goals` / `/mastermind:ops`

**Purpose:** Operations planning and tracking.

```
/mastermind:ops weekly review
/mastermind:ops what needs attention this week?
```

---

### `/mastermind:finance`

**Purpose:** Financial modeling and analysis (for business applications).

```
/mastermind:finance analyze burn rate
/mastermind:finance pricing model for the SaaS tier
```

---

### `/mastermind:marketing`

**Purpose:** Marketing strategy and content.

```
/mastermind:marketing create launch messaging for the new feature
/mastermind:marketing competitive positioning
```

---

### `/mastermind:sales`

**Purpose:** Sales strategy and pipeline.

```
/mastermind:sales identify expansion opportunities in current accounts
```

---

### `/mastermind:content`

**Purpose:** Content creation and strategy.

```
/mastermind:content blog post about the new hook system
/mastermind:content documentation for the memory API
```

---

## Organization Management

### `/mastermind:createorg`

**Purpose:** Create and configure an organization structure.

```
/mastermind:createorg
```

---

### `/mastermind:runorg`

**Purpose:** Run organization-level tasks and workflows.

```
/mastermind:runorg weekly stand-up synthesis
```

---

### `/mastermind:release`

**Purpose:** Manage a software release.

```
/mastermind:release prepare v1.11.0 release
/mastermind:release changelog from last 20 commits
```

---

### `/mastermind:master`

**Purpose:** High-level project master control — run all major workflows.

```
/mastermind:master
```

---

## `--tillend` Loop Mechanics

The `--tillend` flag enables continuous autonomous operation using `ScheduleWakeup`:

```
Session 1: runs command → schedules wakeup (--wait seconds later)
Session 2: wakeup fires → checks staleness guard → runs command → ...
Session N: empty round (zero findings AND zero actions) → stops
```

**Staleness guard:** If a manual run fires AND the original ScheduleWakeup also fires, the second execution checks that its `--rep N` matches the loop state file's `currentRep`. If `N < currentRep`, the wakeup is stale and skips silently.

**Loop state files:** `.monomind/loops/{loop-id}.json` — tracks currentRep, lastRunAt, nextRunAt, status.

**Dashboard events emitted:** `loop:start`, `loop:tick`, `loop:complete`, `loop:hil`.

**Stop a loop:**
```bash
touch .monomind/loops/{loop-id}.stop
```

**Human-in-loop:** If a run generates items requiring human decisions, a `{loop-id}-hil.md` file is written. The loop pauses and re-polls every `min(wait, 300)` seconds. Fill in the `> ` response lines to resume.

---

## Brain Protocol

Each mastermind command loads/saves brain context:

**Brain Load** (at session start):
- Searches LanceDB namespace `mastermind:{domain}` for recent context
- Three memory tiers: raw records (last 7 days) → weekly summaries → principles
- Combines into a `BRAIN CONTEXT` block injected into the skill

**Brain Write** (at session end):
- Stores key decisions, findings, and outcomes to LanceDB
- Updates weekly summaries and principles over time

---

## Delegation

When a mastermind command receives a query that better fits another command, `_delegation.md` routes it automatically:

| Trigger | Routes to |
|---|---|
| "build", "implement", "create feature" | `mastermind:build` |
| "review", "check", "audit code" | `mastermind:review` |
| "research", "investigate", "analyze" | `mastermind:research` |
| "architecture", "design system" | `mastermind:architect` |
| "release", "version", "publish" | `mastermind:release` |
| "idea", "suggest improvements" | `mastermind:idea` |

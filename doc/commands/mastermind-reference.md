# Mastermind Commands Reference

> All `/mastermind:*` slash commands for autonomous agent orchestration, building, reviewing, and business operations. Invoke inside Claude Code.

---

## Overview

Mastermind is a command namespace for high-level autonomous operations. Each command follows a common pattern:

1. **Brain Load** — loads context from the monomind memory store (`mastermind:*` namespace) via the _protocol.md Brain Load Procedure
2. **Intake** — optional 5-question intake if the prompt is vague
3. **Skill execution** — delegates to the corresponding skill file
4. **Brain Write** — saves results and context back to the memory store
5. **Repeat Postamble** — handles `--tillend`/`--repeat` loop scheduling

### Universal Flags

| Flag | Purpose |
|---|---|
| `--tillend` | Repeat until empty round (no findings, no actions) |
| `--repeat <N>` | Repeat exactly N times |
| `--wait <seconds>` | Minimum seconds between repeats (default: 60) |
| `--maxruns <N>` | Safety cap for `--tillend` (default: 50) |

Mode flags (`--auto` / `--confirm`) are parsed per command, not universally — e.g. `review`, `plan`, `execute`, `debug`, `createorg`.

---

## `/mastermind` (no namespace)

**Purpose:** Monoswarm topology picker.

Shows all monoswarm modes (topologies + vote strategies), asks for task description, gives ONE concrete recommendation with ready-to-use launch commands.

```
/mastermind
/mastermind build a feature with 8 agents
```

---

## Core Engineering

### `/mastermind:review`

**Purpose:** Iterative code review until clean.

```
/mastermind:review review the auth module
/mastermind:review --tillend --auto    # keep reviewing until clean
/mastermind:review --tillend --maxruns 10 --wait 120
```

**What it does:**
- Runs reviewer + Security Engineer + Reality Checker in parallel
- Auto-fixes findings
- Writes human-in-loop items to `humaninloopreview-YYYY-MM-DD.md` for decisions requiring human input
- Repeats until zero findings (with `--tillend`)

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

### `/mastermind-goals` / `/mastermind:ops`

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

**Purpose:** Define and save an autonomous agent organization for the Org Runtime daemon. Configs written by this command use the current config format (no legacy `topology`/`board_id`/`communication` fields) and are started with `/mastermind:runorg`.

```
/mastermind:createorg
```

---

### `/mastermind:runorg`

**Purpose:** Start a saved org through the Org Runtime daemon (`monomind org run`/`serve`). Every role runs as a live SDK session, and the daemon forwards dashboard events itself (no boss agent, no monotask board, no manual curl emissions).

```
/mastermind:runorg --org content-team
/mastermind:runorg --org content-team --task "Publish the Q2 product roundup post by Friday"
```

**What it does:**
1. Resolves and validates the named org (`monomind org validate <name>`)
2. If the config file is in the legacy format (`topology`, `board_id`, `loop`), converts it first via `monomind org migrate <name>` — the original file is preserved as `<name>.v1.json`
3. Starts it: `monomind org run <name>` (one-shot) or ensures `monomind org serve` is up (scheduled orgs)
4. Confirms liveness (`monomind org status <name>`) and surfaces the dashboard link and `monomind org logs <name> --follow`

Approve or deny a role's pending tool request with `monomind org approve <org> <role> "<tool>"` / `monomind org deny <org> <role> "<tool>"`, or from the dashboard's Human Input tab.

---

### `/mastermind:release`

**Purpose:** Manage a software release.

```
/mastermind:release prepare v2.0.0 release
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

## Second Brain & OKF

The Second Brain is Monomind's document knowledge base. During `monomind init`, the directory scanner auto-detects document files and ingests them — chunking, deduplicating, and storing them in the memory store for retrieval.

### CLI — `monomind doc`

| Command | Description |
|---|---|
| `doc ingest <path>` | Index a file or directory into the knowledge base |
| `doc search -q "query"` | Search over indexed documents (`--limit`, `--scope`, `--min-score`) |
| `doc list` | List indexed documents with chunk counts and sizes |
| `doc export -o <dir>` | Export as OKF bundle (Markdown + YAML frontmatter) |

### `/mastermind:okf-export`

**Purpose:** Export the Second Brain as a portable OKF (Open Knowledge Format) bundle.

```
/mastermind:okf-export
/mastermind:okf-export -o ./my-bundle
/mastermind:okf-export -o ./my-bundle -s private
```

| Option | Description |
|---|---|
| `-o`, `--output <dir>` | Output directory (default: `.monomind/knowledge-export`) |
| `-s`, `--scope <name>` | Knowledge scope (default: `shared`) |

### `/mastermind:okf-import`

**Purpose:** Import an OKF bundle into the Second Brain.

```
/mastermind:okf-import ./their-knowledge
/mastermind:okf-import ./bundle -s private
```

| Option | Description |
|---|---|
| positional arg | Bundle directory path (required) |
| `-s`, `--scope <name>` | Knowledge scope (default: `shared`) |

### OKF Format

Each exported document becomes a Markdown file with YAML frontmatter:

```yaml
---
type: Document
title: design-spec
description: "Extracted from design-spec.pdf"
resource: docs/design-spec.pdf
tags: ["document", "pdf"]
timestamp: "2026-07-08T12:00:00.000Z"
contentHash: "a1b2c3..."
chunkCount: 12
---

(document content)
```

An `index.md` links all exported documents. Use OKF to move knowledge between projects, share with teammates, or back up your Second Brain.

---

## Brain Protocol

Each mastermind command loads/saves brain context:

**Brain Load** (at session start):
- Searches the memory store namespace `mastermind:{domain}` for recent context
- Three memory tiers: raw records (last 7 days) → weekly summaries → principles
- Combines into a `BRAIN CONTEXT` block injected into the skill

**Brain Write** (at session end):
- Stores key decisions, findings, and outcomes to the memory store
- Updates weekly summaries and principles over time

---

## Delegation

When a mastermind command receives a query that better fits another command, `_delegation.md` routes it automatically:

| Trigger | Routes to |
|---|---|
| "review", "check", "audit code" | `mastermind:review` |
| "research", "investigate", "analyze" | `mastermind:research` |
| "release", "version", "publish" | `mastermind:release` |
| "idea", "suggest improvements" | `mastermind:idea` |

# monomind:idea — Idea-to-Task Pipeline

**Date:** 2026-04-25
**Status:** Approved
**Slash command:** `/monomind:idea <prompt>`

## Overview

A slash command that takes a single prompt, researches it with a mesh swarm to generate ideas, evaluates them against the project's purpose, elaborates unclear ones, and decomposes approved ideas into actionable subtasks — all tracked on monotask boards.

## Prerequisites

### monotask CLI

The command checks for `monotask` in `$PATH` on every invocation. If missing, it installs it:

```bash
# Check
which monotask

# Install (Rust binary via cargo)
cargo install monotask
```

If `cargo` is also missing, the skill prints an error with install instructions and exits.

## Monotask Board Setup

### Space Detection

1. Derive repo name: `git remote get-url origin` → extract repo name (e.g. `monomind`). Fallback: current directory basename.
2. `monotask space list` → check if a space with that name exists.
3. If not: `monotask space create "<repo-name>"`.

### Idea Board (`monomind-idea`)

Check if a board titled `monomind-idea` exists in the space. If not, create it with these columns (in order):

| Column | Purpose |
|---|---|
| **New** | Raw ideas from research swarm |
| **Evaluated** | Ideas deemed doable, with value context added |
| **Elaborated** | Ideas with edge cases and technical notes added |
| **Tasked** | Ideas fully decomposed into subtasks |
| **Iced** | Ideas that are unclear, need feedback, or paused |
| **Rejected** | Ideas that are useless for the current project |

### Task Board (`monomind-task`)

Created lazily by the Task Decomposer (Stage 4). Columns:

| Column | Purpose |
|---|---|
| **Backlog** | Subtasks waiting to be prioritized |
| **Todo** | Prioritized, ready to start |
| **In Progress** | Actively being worked on |
| **Review** | Completed, awaiting review |
| **Human in Loop** | Needs human decision or input |
| **Done** | Completed and verified |

## Context Gathering

Before any agent runs, the skill collects project context:

1. **README.md** — first 200 lines
2. **package.json** (or equivalent project manifest) — name, description, keywords
3. **Graphify** — `mcp__monobrain__graphify_suggest` with the user's prompt (if graph is built)
4. **Monomind memories** — `mcp__monobrain__memory_search` for relevant project context

All bundled into a `PROJECT_CONTEXT` string passed to every agent.

## Pipeline Stages

### Stage 1: Research Swarm

- **Topology:** mesh (divergent brainstorming benefits from peer-to-peer)
- **Agents:** 3-5 `researcher` agents
- **Input:** User's prompt + `PROJECT_CONTEXT`
- **Job:** Generate ideas. Each idea has a `title` and `description`. The swarm decides how many ideas based on topic richness — no hard cap.
- **Output:** JSON array of ideas
- **Monotask action:** Create a card in the **New** column for each idea (title = idea title, card body via comment = idea description)

### Stage 2: Evaluator Agent

- **Agent type:** `Product Manager` (single agent)
- **Input:** Each card from **New** + `PROJECT_CONTEXT`
- **Verdicts per idea:**

- **Scoring:** For each idea (except rejected), the evaluator assigns an **impact** score (0-10, how much value it adds) and an **effort** score (0-10, how much work it requires) using `monotask card set-impact` and `monotask card set-effort`.
- **Verdicts per idea:**

| Verdict | Action |
|---|---|
| Doable + clear | Set impact/effort, add value statement as comment, move to **Evaluated**, mark `skipElaboration: true` |
| Doable + needs elaboration | Set impact/effort, add value statement as comment, move to **Evaluated**, mark `skipElaboration: false` |
| Unclear / needs feedback | Set impact/effort estimates, comment the specific question, move to **Iced** |
| Not useful for project | Comment reason, move to **Rejected** |

### Stage 3: Elaborator Agent (conditional)

- **Agent types:** Two agents spawned in parallel:
  1. `feature-dev:code-explorer` — traces execution paths, maps dependencies, and surfaces internal codebase constraints relevant to each idea
  2. `researcher` (with WebSearch) — searches the internet for prior art, external edge cases, and technical pitfalls
- **Runs only for:** Cards in **Evaluated** where `skipElaboration: false`
- **Job:** Merge findings from both agents. Add edge cases, codebase constraints, technical considerations, and missing context as comments on the card
- **Monotask action:** Move card to **Elaborated**
- **Skip path:** Cards with `skipElaboration: true` move directly from **Evaluated** → **Elaborated**

### Stage 4: Task Decomposer Agent

- **Agent type:** `Software Architect` (single agent)
- **Input:** Each card in **Elaborated** + `PROJECT_CONTEXT`
- **Job:**
  1. Ensure `monomind-task` board exists in the space (create with template columns if not)
  2. For each idea, break it into concrete subtasks. For each subtask, recommend the best **agent type** for implementation (e.g., `backend-dev`, `Frontend Developer`, `coder`, `Security Engineer`) based on the subtask's domain
  3. Create each subtask as a card in the **Backlog** column of `monomind-task`, with the assigned agent type written on the card
  4. Add a comment on the idea card listing all created subtask titles with their assigned agent types
- **Monotask action:** Move the idea card to **Tasked**
- **Doubt handling:** If decomposition reveals ambiguity → comment question on the idea card, move to **Iced**, skip to next

## Icing Protocol

Applies at **every stage**. When any agent encounters ambiguity, doubt, or an unclear requirement:

1. Add a comment on the card describing the specific question or concern
2. Move the card to **Iced**
3. Continue processing the next card

Iced cards can be revisited manually or in a future `/monomind:idea` run.

## Data Contracts

```typescript
interface Idea {
  title: string;
  description: string;
  cardId: string;
}

interface EvaluatedIdea extends Idea {
  verdict: "evaluated" | "iced" | "rejected";
  valueStatement: string;
  skipElaboration: boolean;
  impact: number;  // 0-10
  effort: number;  // 0-10
}

interface ElaboratedIdea extends EvaluatedIdea {
  edgeCases: string[];
  technicalNotes: string;
}

interface Subtask {
  title: string;
  description: string;
  agentType: string;
  cardId: string;
  parentIdeaCardId: string;
}
```

## User Experience

### Invocation

```
/monomind:idea improve developer onboarding experience
```

### Progress Output

```
Checking monotask CLI... OK
Setting up monotask space "monomind" and idea board...
  Space: monomind (existing)
  Board: monomind-idea (created)

Researching ideas with mesh swarm (3-5 agents)...
  Generated 6 ideas → New column

Evaluating ideas...
  Interactive CLI tutorial        → Evaluated (clear)
  Starter templates               → Evaluated (needs elaboration)
  AI-powered error explanations   → Evaluated (needs elaboration)
  Video walkthrough series        → Iced (question: target audience?)
  Remove install step             → Rejected (not feasible)
  Plugin quickstart generator     → Evaluated (clear)

Elaborating 2 ideas...
  Starter templates               → Elaborated
  AI-powered error explanations   → Elaborated

Decomposing 4 ideas into tasks...
  Creating monomind-task board...

┌─────────────────────────────────┬────────────┐
│ Idea                            │ Status     │
├─────────────────────────────────┼────────────┤
│ Interactive CLI tutorial        │ Tasked (4) │
│ Starter templates               │ Tasked (3) │
│ AI-powered error explanations   │ Tasked (5) │
│ Plugin quickstart generator     │ Tasked (2) │
│ Video walkthrough series        │ Iced       │
│ Remove install step             │ Rejected   │
└─────────────────────────────────┴────────────┘

14 subtasks created in monomind-task backlog.
```

### Edge Cases

- **No ideas generated:** Report "No ideas generated for this prompt" and exit
- **All ideas rejected:** Report summary table with all rejected, no task board touched
- **monotask CLI missing:** Install via `cargo install monotask`; if cargo missing, print instructions and exit
- **monotask command fails:** Catch error, report which command failed, continue to next card
- **Empty prompt:** Show usage: `Usage: /monomind:idea <prompt>`
- **Graph not built:** Skip graphify context, proceed with README + memories only

## File Location

```
.claude/commands/monomind-idea.md
```

This is a Claude Code slash command (markdown with YAML frontmatter). All orchestration logic — monotask setup, agent spawning, card management — is described declaratively in the command file. Agents are spawned via the `Agent` tool.

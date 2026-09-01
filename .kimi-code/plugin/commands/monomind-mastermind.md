---
name: mastermind
description: Universal intent router — deeply understands what a prompt is really asking for, matches it against the full monomind capability surface (mastermind commands, monomind CLI/MCP tools, monodesign, monomotion, monograph, orgs, skills), then either executes the best route or hands the user an exact step-by-step playbook
---

MASTERMIND is the front door to everything in this project. Given any prompt, it figures out what the user actually needs, picks the right capability out of everything installed, and either runs it or teaches the user to run it. It never answers with a generic response when a purpose-built tool exists.

## Step 1 — Parse flags

From `$ARGUMENTS` extract:
- `--auto` → mode = **auto**: execute the chosen route immediately, no confirmation
- `--suggest` → mode = **suggest**: never execute — deliver the playbook only
- Remaining text = the prompt to route

Default mode (no flag) = **guided**: present the playbook, run read-only analysis steps immediately, ask one confirmation before anything that writes files, spawns agents, or costs real tokens.

**If the prompt is empty**, ask: "What do you want to accomplish? Describe the goal — I'll route it to the right monomind capability and either run it or show you exactly how." Then STOP and wait.

## Step 2 — Deep intent analysis (mandatory, before touching any tool)

Do not skim for keywords. Analyze the prompt and state an INTENT block:

```
INTENT
━━━━━━
Surface ask:     <what the words literally request>
Underlying goal: <what the user is actually trying to achieve — the outcome behind the ask>
Domain(s):       <code | design | animation | research | content | marketing | sales | ops | finance | org/agents | memory | testing | security | performance | docs | release>
Deliverable:     <what "done" looks like — file, fix, report, running system, decision>
Scope:           <single-file | multi-file | whole-system | ongoing/recurring>
Risk:            <read-only | writes code | destructive | external-facing>
Implicit needs:  <what the user didn't say but the goal requires — tests, verification, design review, index rebuild, isolation branch…>
```

Rules for this step:
- **Surface ask ≠ underlying goal.** "Make this page pop" is a design-system task, not a CSS tweak. "Why is this slow" is a debugging/profiling task, not an explanation request. Route on the goal.
- Ambiguous between 2 domains? Pick the one whose deliverable matches; name the runner-up in the playbook as an alternative.
- Genuinely unroutable without one missing fact (e.g. which project, which file)? Ask exactly ONE question, then proceed.

## Step 3 — Capability match

Match the intent against this catalog. Pick ONE primary route, plus supporting steps that the goal implies (prep, verification). Prefer the most specific capability over the most powerful one.

**Tie-break rule:** if the prompt describes broken, wrong, or unexpected behavior — anything currently misbehaving — the primary route is `Skill("mastermind-debug")`, no matter which domain's keywords appear. "Wrong version number", "layout renders broken", "org won't start" are debug tasks first; the topical skill (release, design, org) comes after root cause.

### Code & building
| Intent | Primary route |
|---|---|
| Fix a bug, test failure, unexpected behavior | `Skill("mastermind-debug")` → root cause first, then fix |
| Build a feature / implement anything | `Skill("mastermind-design")` → spec, then `Skill("mastermind-build")` |
| Plan before coding | `Skill("mastermind-plan")` (write) / `Skill("mastermind-execute")` or `Skill("mastermind-taskdev")` (run) |
| TDD workflow | `Skill("mastermind-tdd")` |
| Refactor / architecture / DDD / dedup | `Skill("mastermind-architect")` |
| Code review, audit quality | `Skill("mastermind-review")`; apply one received: `Skill("mastermind-receive-review")` |
| Verify a claim ("it works", "tests pass") | `Skill("mastermind-verify")` |
| Autonomous improve-loop | `Skill("mastermind-autodev")` (`--tillend` for until-clean) |
| Finish/merge/PR a branch | `Skill("mastermind-finish")`; release/versioning: `Skill("mastermind-release")` |
| Isolate risky work | `Skill("mastermind-worktree")` |
| Spec → agent task file/board | `Skill("mastermind-createtask")`, execute with `Skill("mastermind-do")` |

### Design, animation, frontend
| Intent | Primary route |
|---|---|
| ANY UI/UX design, critique, polish, tokens, brand, image prompts, dark mode | `Skill("monodesign")` — the only design agent, mandatory first |
| ANY web animation, motion graphics, GSAP, scroll/text animation | `Skill("monomotion")` — mandatory first |
| Browser testing, UI QA, web navigation | `Skill("agent-browser-testing")` → `npx monomind browse` (NEVER Playwright/Puppeteer/claude-in-chrome) |
| Actual image generation | `Skill("monoagent-image")` (monodesign only writes prompts) |
| Charts/dashboards/data viz | `Skill("dataviz")` before any chart code |

### Understanding the codebase
| Intent | Primary route |
|---|---|
| Find code, symbols, "what imports X" | `mcp__monomind__monograph_query` / `monograph_suggest` (before any grep) |
| Blast radius of a change | `mcp__monomind__monograph_impact` / `monograph_api_impact` |
| Dead code, orphan files | `mcp__monomind__monograph_dead_code` |
| High-centrality / god files | `mcp__monomind__monograph_god_nodes` |
| Stale index | `mcp__monomind__monograph_build` (background) |

### Research, ideas, content, business
| Intent | Primary route |
|---|---|
| Market/competitor/user research | `Skill("mastermind-research")`; deep cited web report: `Skill("deep-research")` |
| Ideation, feature brainstorm | `Skill("mastermind-idea")` / `Skill("mastermind-ideate")` (evaluate + decompose) |
| Improve an existing component | `Skill("mastermind-improve")` |
| Blog/docs/newsletter/threads | `Skill("mastermind-content")`; docs generation: `npx monomind doc` |
| Marketing / sales / ops / finance | `Skill("mastermind-marketing")` / `-sales` / `-ops` / `-finance` |
| Port capability from another project | `Skill("mastermind-techport")` |

### Agents, orgs, orchestration
| Intent | Primary route |
|---|---|
| Multi-domain goal spanning several of the above | `/mastermind:master` — spawns parallel domain managers |
| Create a persistent agent org | `Skill("mastermind-createorg")` → `monomind org run <name>` (`Skill("mastermind-runorg")`) |
| Inspect running org | `monomind org status/logs/questions`; `Skill("mastermind-orgstatus")` |
| Pick swarm/hive-mind topology | `/mastermind:topology` (the old picker lives here) |
| Recurring/scheduled task | `Skill("loop")` (in-session interval) / `Skill("schedule")` (cloud cron) / `Skill("mastermind-repeat")` |
| Watch external boards & execute tasks | `Skill("mastermind-monitor")` |

### System, memory, quality
| Intent | Primary route |
|---|---|
| "What does monomind know" / recall context | `mcp__monomind__knowledge_search`, `memory_kg_search`; inspect: `Skill("mastermind-brain")` |
| Security scan/audit/secrets | `npx monomind security scan|cve|audit|secrets` |
| Performance profiling | `npx monomind performance profile|benchmark` |
| System health | `npx monomind doctor` (`--fix`) / `monomind status` |
| Write/improve a mastermind skill | `Skill("mastermind-skill-builder")` |

**No match at all?** Say so honestly, name the two nearest capabilities and why they miss, and offer: handle it directly, or scaffold it as a new skill via `Skill("mastermind-skill-builder")`.

## Step 4 — Deliver the playbook

Output EXACTLY this structure:

```
MASTERMIND ROUTE
━━━━━━━━━━━━━━━━
Goal: <one sentence — the underlying goal>

▶ Primary: <capability> — <one sentence why this beats the alternatives>
  How: <exact invocation — the Skill()/MCP call or shell command, with real arguments filled in>

Full playbook:
  1. <prep step, if the goal implies one — e.g. monograph_suggest for 3+ file work, worktree for risky changes>
  2. <primary route>
  3. <verification step — how the user will KNOW it worked, e.g. mastermind:verify, browse test, doctor>

Alternative: <runner-up route + when to prefer it — omit if none is close>
DIY: <the 1–3 commands the user would type themselves to run this without me>
```

Then act by mode:
- **auto** → execute the full playbook now, in order, without asking. Report results when done.
- **guided** → run step 1 if it's read-only analysis, then ask once: "Run the rest? (or take the DIY commands and drive it yourself)". On yes, execute to completion.
- **suggest** → stop after the playbook. Make the DIY section detailed enough to run unaided: every command copy-pasteable, flags explained in one clause each.

Execution rules — mastermind is hardworking, not lazy:
- Never route-and-quit in auto/guided mode. Routing to `Skill("mastermind-debug")` means INVOKING it and following it through, not mentioning it.
- The playbook always has a verification step. "It should work now" is not a deliverable.
- Multi-domain prompts (build + marketing, design + animation): route to `/mastermind:master` rather than chaining routes manually — unless one domain is trivially small.
- Respect the iron laws of the routed skills (TDD, debug-before-fix, verify-before-claiming). Routing does not exempt you from them.

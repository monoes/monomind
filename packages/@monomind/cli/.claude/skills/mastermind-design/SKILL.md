---
name: mastermind-design
description: "MUST use before any creative work — creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements, and design through collaborative dialogue before any implementation."
type: domain-skill
default_mode: confirm
---

# Mastermind Design

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY request regardless of perceived simplicity.
</HARD-GATE>

---

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every feature goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" tasks are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple requests), but you MUST present it and get approval.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via mastermind-protocol/SKILL.md brain load)
- `prompt`: the idea or request to design
- `project_name`: project context
- `mode`: auto | confirm

---

## Checklist

Complete these items in order:

1. **Explore project context** — check files, docs, recent commits
2. **Offer the visual companion just-in-time** — NOT upfront. The first time a question would genuinely be clearer shown than described, offer it then (its own message, not combined with a clarifying question). If no visual question ever arises, never offer it. See the Visual Companion section below.
3. **Ask clarifying questions** — one at a time; understand purpose, constraints, success criteria
4. **Propose 2-3 approaches** — with trade-offs and your recommendation
5. **Present design** — in sections scaled to their complexity; get user approval after each section
6. **Write design doc** — save to `docs/mastermind/specs/YYYY-MM-DD-<topic>-design.md`
7. **Spec self-review** — inline check for placeholders, contradictions, ambiguity, scope (see below)
8. **User reviews written spec** — ask user to review before proceeding
9. **Transition to planning** — invoke `Skill("mastermind-plan")` to create the implementation plan

---

## Process Flow

```
Explore project context
        ↓
Ask clarifying questions (one at a time)
    (a question is clearer shown than described?
     → offer Visual Companion just-in-time — own message, no other content)
        ↓
Propose 2-3 approaches
        ↓
Present design sections → User approves? → no: revise → loop
        ↓ yes
Write design doc
        ↓
Spec self-review (fix inline)
        ↓
User reviews spec? → changes requested → Write design doc
        ↓ approved
Invoke Skill("mastermind-plan")  ← TERMINAL STATE
```

**The terminal state is invoking `Skill("mastermind-plan")`.** Do NOT invoke mastermind:build or any other implementation skill directly. The ONLY next step after design is plan.

---

## The Process

### Understanding the idea

- Check current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems, flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order to build? Then design the first sub-project through the normal flow. Each sub-project gets its own spec → plan → implementation cycle.
- For appropriately-scoped projects, ask questions one at a time
- Prefer multiple-choice questions when possible; open-ended is fine too
- Only one question per message — if a topic needs more exploration, break it into multiple messages
- Focus on: purpose, constraints, success criteria

### Exploring approaches

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with the recommended option and explain why

### Presenting the design

- Once you understand what you're building, present the design
- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

### Design for isolation and clarity

- Break the system into smaller units with one clear purpose each, communicating through well-defined interfaces
- For each unit, answer: what does it do, how do you use it, what does it depend on?
- Can someone understand a unit without reading its internals? Can internals change without breaking consumers? If not, the boundaries need work.
- Smaller, well-bounded units are easier to reason about and test

### Working in existing codebases

- Explore the current structure before proposing changes. Follow existing patterns.
- Where existing code has problems affecting the work, include targeted improvements as part of the design.
- Do not propose unrelated refactoring. Stay focused on the current goal.

---

## After the Design

### Documentation

- Write the validated design (spec) to `docs/mastermind/specs/YYYY-MM-DD-<topic>-design.md`
  - User preferences for spec location override this default
- Commit the design document to git

### Spec Self-Review

After writing the spec document, review it with fresh eyes:

1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections, or vague requirements? Fix them.
2. **Internal consistency:** Do any sections contradict each other? Does the architecture match the feature descriptions?
3. **Scope check:** Is this focused enough for a single implementation plan, or does it need decomposition?
4. **Ambiguity check:** Could any requirement be interpreted two different ways? If so, pick one and make it explicit.

Fix any issues inline. No need to re-review — just fix and move on.

### User Review Gate

**In confirm mode (default):** Ask the user to review the written spec before proceeding:

> "Spec written and committed to `<path>`. Please review it and let me know if you want any changes before we start writing the implementation plan."

Wait for the user's response. If they request changes, make them and re-run the spec self-review. Only proceed once the user approves.

**In auto mode:** Skip the wait. Proceed directly to `Skill("mastermind-plan")`.

### Transition to Planning

- Invoke `Skill("mastermind-plan")` to create a detailed implementation plan
- Do NOT invoke any other skill. `mastermind:plan` is the only next step.

---

## Key Principles

- **One question at a time** — do not overwhelm with multiple questions
- **Multiple choice preferred** — easier to answer than open-ended when possible
- **YAGNI ruthlessly** — remove unnecessary features from all designs
- **Explore alternatives** — always propose 2-3 approaches before settling
- **Incremental validation** — present design, get approval before moving on
- **Be flexible** — go back and clarify when something doesn't make sense

---

## Visual Companion

A browser-based companion for showing mockups, diagrams, and visual options during design sessions. Available as a tool — not a mode. Accepting the companion means it's available for questions that benefit from visual treatment; it does NOT mean every question goes through the browser.

**Offering the companion (just-in-time):** Do NOT offer it upfront. Wait until a question would genuinely be clearer shown than told — a real mockup / layout / diagram question, not merely a UI *topic*. The first time that happens, offer it then, as its own message:

> "This next part might be easier if I show you — I can put together mockups, diagrams, and comparisons in a browser tab as we go. It's still new and can be token-intensive. Want me to? I'll open it for you."

**This offer MUST be its own message.** Only the offer — no clarifying question, summary, or other content. Wait for the user's response. If they decline, continue text-only and don't offer again unless they raise it.

**Per-question decision:** Even after the user accepts, decide FOR EACH QUESTION whether to use the browser or the terminal. The test: **would the user understand this better by seeing it than reading it?**

- **Use the browser** for content that IS visual — mockups, wireframes, layout comparisons, architecture diagrams, side-by-side visual designs
- **Use the terminal** for content that is text — requirements questions, conceptual choices, tradeoff lists, A/B/C/D text options, scope decisions

A question about a UI topic is not automatically a visual question. "What does personality mean in this context?" is a conceptual question — use the terminal. "Which wizard layout works better?" is a visual question — use the browser.

If they agree to the companion, use `Skill("mastermind-worktree")` to set up an isolated workspace, then invoke `Skill("agent-browser-testing")` to open the browser.

---

## Integration

**Skills used by this skill:**
- `Skill("mastermind-plan")` — creates the implementation plan after design is approved (terminal state)
- `Skill("mastermind-worktree")` — isolated workspace for visual companion work

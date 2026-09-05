---
name: pair:modes
description: Pair programming collaboration modes — driver, navigator, TDD, review, and debug modes with effective prompts for each
---

# Pair Programming Modes

Different collaboration patterns for different goals. Choose based on what you're trying to accomplish.

## Driver Mode — You Write, Claude Reviews

You do the coding. Claude watches, suggests, and catches issues in real time.

**Start it:**
> "I'm implementing [feature]. Watch what I'm building and review each piece as I share it. Point out issues, security problems, and improvements."

**Best for:**
- Learning new patterns (you get hands-on + feedback)
- Implementing features you understand but want reviewed
- Debugging when you have a hypothesis to test

**Effective prompts during driver mode:**
- "Here's what I wrote — what do you think?"
- "I'm about to add validation here. Any pitfalls?"
- "Is this the right pattern for this situation?"
- "Review this function before I move on."

---

## Navigator Mode — Claude Writes, You Guide

Claude does the coding. You provide direction, review output, and control architecture decisions.

**Start it:**
> "Implement [feature]. I'll guide the direction and review each section before you move on. Start with [specific first piece]."

**Best for:**
- Rapid prototyping
- Boilerplate and scaffolding
- Exploring approaches you haven't used before
- Getting unstuck quickly

**Effective prompts during navigator mode:**
- "Implement X. Use [pattern/library]."
- "That's good but change [specific thing]."
- "Before writing the next piece, explain your approach."
- "Show me an alternative approach to this."

---

## TDD Mode — Tests First

Write failing tests, then implement just enough to pass, then refactor.

**Start it:**
> "We're doing TDD for [feature]. Write the failing tests first, explain what each test covers, then I'll implement. We refactor together after tests pass."

**The cycle:**
1. Claude writes a failing test — you understand it
2. You implement minimal passing code
3. Claude reviews the implementation
4. Together you refactor
5. Repeat

**Invoke the TDD skill for full workflow:**
```
Skill("superpowers:test-driven-development")
```

---

## Review Mode — Quality Focus

Work through existing code with Claude as reviewer.

**Start it:**
> "Review the changes in `src/auth/`. Focus on [security / correctness / performance]. Be specific about issues — give file, line, and explanation."

**Structured review request:**
> "Review this PR diff. Rate it on: (1) correctness, (2) security, (3) readability, (4) test coverage. List issues by severity."

**Invoke the review skill:**
```
Skill("superpowers:requesting-code-review")
```

---

## Debug Mode — Problem Solving

Systematic debugging as a pair.

**Start it:**
> "We have a bug: [describe symptom]. Let's debug together. Start by asking me questions to narrow down the cause."

**Invoke the debugging skill:**
```
Skill("superpowers:systematic-debugging")
```

---

## Switching Modes

You can switch modes at any point just by redirecting:

> "Let's switch — now you drive. Implement the auth middleware based on what we've discussed."

> "Actually let me write this part. Review as I go."

> "Stop implementing — let's do TDD for the rest of this."

## Mode Selection Guide

| Goal | Mode |
|---|---|
| Learning + control | Driver |
| Speed + generation | Navigator |
| Quality from the start | TDD |
| Fix existing code | Review |
| Fix a bug | Debug |
| Long complex feature | Switch (start navigator, finish driver) |

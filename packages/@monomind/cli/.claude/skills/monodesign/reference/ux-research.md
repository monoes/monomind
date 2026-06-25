# UX Research

Validate design decisions with evidence. Research before redesigning; test before shipping.

## When to Research

| Signal | Method |
|---|---|
| "We don't know if users want this" | User interviews (5–8 participants) |
| "We don't know if users can do this" | Usability testing (5 tasks, think-aloud) |
| "We don't know which version is better" | A/B testing (statistical significance required) |
| "We don't know who our users are" | Survey + analytics segmentation |
| "We're redesigning a live product" | Contextual inquiry + session recording analysis |

## Study Plan

Before any research session:

```markdown
## Research Plan: [Feature/Product Name]

**Research question**: [One clear question this study answers]
**Method**: [Interview / Usability test / Survey / A/B test]
**Participants**: [N=X; criteria: role, experience, age range; how recruited]
**Timeline**: [Dates for recruiting, sessions, synthesis, readout]
**Success**: [What finding would change a product decision]

### Session protocol
- [Task 1]: [Goal — what we want to observe, not prescribe]
- [Task 2]: ...
- Post-task questions: "How difficult was that? Why?"
- Closing: "What surprised you? What would you change?"
```

## User Persona Template

Personas are empirical — built from interview synthesis, not imagination. A persona without a source citation is a fiction.

```markdown
## [Persona Name] — [One-line description]

**Source**: [N interviews + X survey responses, Month Year]

### Context
- Role: [job title, team size, seniority]
- Environment: [device, OS, when/where they use the product]
- Technical fluency: [1–5 scale with evidence]

### Goals
Primary: [What they're actually trying to accomplish]
Secondary: [Nice-to-have outcomes]

### Frustrations (direct quotes where possible)
- "[Their words]" — quote from interview participant
- [Observed behavior that contradicts stated preference]

### Mental model
[How they currently think about the problem domain — diagram if useful]

### Decision triggers
[What causes them to start using, stop using, recommend, or abandon]
```

## Usability Test Protocol

5 participants reveals 85% of usability issues (Nielsen's rule). Run moderated think-aloud tests before major launches.

```markdown
## Usability Test: [Feature Name]

**Prototype/build**: [URL or Figma link]
**Tasks** (state goal, not steps):
1. "Find a plan that fits your budget" ← correct
   "Click Pricing, then select Pro" ← wrong (leads the user)
2. ...

**Observation sheet** (one per participant):
| Task | Completed? | Time | Errors | Quotes / Observations |
|------|-----------|------|--------|----------------------|
| T1   |           |      |        |                      |

**Severity scale**:
- P0: Blocks task completion — fix before launch
- P1: Causes errors or frustration — fix this sprint
- P2: Causes hesitation — fix next sprint
- P3: Polish issue — backlog
```

## Synthesis

After 5+ sessions, synthesize before drawing conclusions. Affinity mapping is the default method.

Steps:
1. Transcribe or note-take immediately after each session
2. Write observations on individual cards ("User tried X before Y")
3. Group cards by theme across participants
4. Count frequency: "4/5 users misread the CTA as navigation"
5. Map to product decisions: what changes, what validates current design

**Red flags that invalidate a finding:**
- Only one participant showed this behavior
- Observation conflicts with analytics data — investigate before concluding
- "Users said they would do X" (stated preference ≠ behavior)

## A/B Testing Standards

Don't A/B test unless:
- You have enough traffic for statistical significance (use a calculator — typically n=1,000+ per variant)
- The test runs ≥2 weeks to account for weekly cycles
- You have a pre-registered hypothesis ("Changing CTA copy will increase conversion by 10%")
- You have a single primary metric per test

**What to test**: CTAs, headlines, onboarding steps, form field count, pricing page layout.  
**What not to test**: Navigation structure, brand identity, accessibility requirements.

## Research Repository

After each study, file a one-page summary:

```markdown
## Research Summary: [Study Name] — [Date]

**Question**: [What we set out to learn]
**Method + participants**: [Brief]
**Top 3 findings**:
1. [Finding with evidence — quote or count]
2. ...
3. ...
**Recommended changes** (linked to findings):
- Design: [What to change]
- Product: [What to consider]
**Follow-up questions this surfaced**: [What to research next]
```

Store in `docs/research/` or equivalent. Link from design decisions so future teammates understand why choices were made.

## Inclusive Research

- Recruit participants with disabilities in every study (not just accessibility-specific studies)
- Test on real devices users own — not just latest iPhone/MacBook
- Account for non-native language users if the product has international reach
- Analyze session recordings for accessibility errors: keyboard traps, screen reader failures, zoom breakage
- Don't use "average user" — disaggregate findings by user segment

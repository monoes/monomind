---
name: monodesign-onboard
description: Design or improve user onboarding — first-run experiences, empty states, progressive disclosure, setup wizards, and the "aha moment" path for new users.
type: design-sub-command
argument-hint: "[target product or feature to onboard]"
user-invocable: true
---

# Monodesign: Onboard

Design or improve user onboarding. Read `reference/onboard.md` from the monodesign skill directory for the full protocol.

## Onboarding Philosophy

The goal of onboarding is not to explain the product. It's to get the user to their first moment of value as fast as possible. Everything that doesn't serve that goal is a liability.

## The Aha Moment Map

Before designing anything, identify:
1. **What is the first moment of genuine value for a new user?** (Not "they understand the product" — what specific thing makes them say "oh, this is useful")
2. **What is the shortest path to that moment?** (Every step that isn't required is a step where the user can drop off)
3. **What does the user need to know before they can get there?** (Only these things — nothing more)

## Onboarding Patterns

**Empty state onboarding**
The most overlooked opportunity. When a user first arrives at a feature with no data, the empty state is their first experience of that feature. It should:
- Describe what will appear here (not be blank)
- Show a CTA to add the first item
- Optionally show a preview of what it will look like when populated

**Progressive disclosure onboarding**
Start with the minimal useful version of the product. Reveal additional features only when the user's behavior signals readiness (they've used the basic feature N times, or they've hit a limitation).

**Contextual tooltips**
Not a tour. Tooltips that appear at the right moment (user hovers a new feature, user completes an action) and disappear when dismissed. Never a forced 10-step tour.

**Setup wizard**
When the product genuinely requires configuration before it's useful (API keys, workspace settings, integrations), a wizard is appropriate. Keep it short: 3 steps max, each with a clear benefit statement ("After this, you can...").

## Copy Principles for Onboarding

- Frame every step as a benefit: "Connect your calendar to automatically block focus time" not "Calendar integration step 2 of 3"
- Progress indicators: show how far they've come, not how far they have to go
- Skip options: always provide a way to skip or come back later
- No dead ends: every empty state has an action, every error has a recovery path

## Output

Design decisions + code for the specific onboarding surface: empty states, tooltip content, wizard steps, or first-run flow — with copy, layout, and interaction states.

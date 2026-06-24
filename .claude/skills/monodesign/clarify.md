---
name: monodesign-clarify
description: Fix confusing, ambiguous, or hard-to-understand UI — improve information architecture, navigation labels, empty states, error messages, and cognitive load without a full redesign.
type: design-sub-command
argument-hint: "[target page, flow, or interaction]"
user-invocable: true
---

# Monodesign: Clarify

Fix confusing or ambiguous UI. Read `reference/clarify.md` and `reference/cognitive-load.md` from the monodesign skill directory for the full protocol.

## Diagnosis: What's Confusing?

**Navigation and labeling**
- Labels that describe what something IS instead of what it DOES ("Analytics" vs. "See how your campaigns are performing")
- Navigation items with scope too broad (everything is "Settings")
- Tabs and menus that require trying each option to understand them

**Information architecture**
- Related things that aren't grouped together
- Same concept appearing in multiple places with slightly different names
- Forms that ask for information before explaining why it's needed

**Feedback and state**
- Actions without confirmation that they worked
- Loading states that don't indicate progress or expected duration
- Errors that describe what happened technically, not what the user should do next
- Empty states that are blank (not "nothing here yet", just nothing)

**Cognitive load**
- Too many choices presented simultaneously without hierarchy
- Options that require domain knowledge to distinguish
- Visual complexity that masks the primary action

## Clarification Techniques

**Labels**
- Action-oriented labels on buttons ("Save changes" not "OK")
- Descriptive labels on navigation ("Payment history" not "Payments")
- Contextual tooltips on technical terms (hover, not always-visible)

**Progressive disclosure**
- Show the most common case first; reveal complexity on demand
- Advanced settings behind a clear "Show advanced" toggle
- Multi-step flows that reveal the next step only after the current one

**Feedback patterns**
- Inline validation as the user types, not only on submit
- Clear success/error states with next-step guidance
- Progress indicators for multi-step processes

**Copy**
- Error messages: [what happened] + [why] + [what to do]
- Empty states: [what will appear here] + [how to add it]
- Confirm dialogs: [what will happen] + primary action + escape

## Output

Specific code changes that reduce confusion:
- Updated labels with rationale
- Added/improved empty states
- Better error messages
- Simplified information architecture

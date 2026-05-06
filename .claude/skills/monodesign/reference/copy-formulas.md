# Copy Formulas

Persuasive writing frameworks for UI copy — CTAs, empty states, error messages, onboarding, landing sections, and confirmations. Use during `clarify` workflows.

---

## Core Frameworks

### PAS (Problem → Agitate → Solution)

**Best for:** Error messages, empty states, pain-point sections.

```
Problem:  Name the specific issue.
Agitate:  Show the consequence if unresolved.
Solution: Offer the direct fix.
```

**Template:** "[Pain point]? Without [solution], [consequence]. [Action] to fix this."

**UI examples:**
- Empty state: "No data yet. Without a connected account, nothing here will populate. Connect your first account →"
- Error: "Payment failed. Your card may have been declined or expired. Try a different card →"

---

### AIDA (Attention → Interest → Desire → Action)

**Best for:** CTAs, landing hero copy, onboarding headlines.

```
Attention: Bold statement or provocative question.
Interest:  The relevant benefit detail.
Desire:    Proof or stakes.
Action:    The direct CTA.
```

**Template:** "[Bold statement]. [Benefit]. [Proof/stakes]. [CTA]."

**UI examples:**
- Hero: "Ship faster. 10,000+ teams cut deploy time in half. Start free →"
- Onboarding: "Your workspace is ready. Connect your tools and invite your team to see everything in one place. Get started →"

---

### FAB (Feature → Advantage → Benefit)

**Best for:** Feature callouts, tooltip copy, product UI explanations.

```
Feature:   What it does.
Advantage: Why that matters.
Benefit:   What the user gains.
```

**Template:** "[Feature] lets you [advantage], so you can [benefit]."

**UI examples:**
- Tooltip: "Batch export sends all files at once, so you spend less time waiting."
- Feature highlight: "Auto-save preserves your work every 30 seconds, so you never lose a draft."

---

### BAB (Before → After → Bridge)

**Best for:** Onboarding flows, upgrade prompts, transformation moments.

```
Before: The current pain state.
After:  The desired state.
Bridge: Your feature is the path between them.
```

**Template:** "[Pain before]. [Desired state after]. [Feature] is how you get there."

---

### Cost of Inaction

**Best for:** Upgrade prompts, warning states, deadline-driven copy.

```
Status quo: What happens if nothing changes.
Loss:       Quantify or qualify the cost.
Time:       The consequence compounds.
```

**Template:** "Without [action], you're losing [cost] every [timeframe]."

---

## UI Copy Patterns by Surface

| Surface | Primary formula | Tone | Key rule |
|---------|-----------------|------|----------|
| Empty state | PAS | Helpful | Give an action, not just a message |
| Error message | PAS | Direct | State cause + how to fix |
| CTA button | AIDA (action only) | Active | Imperative verb first |
| Onboarding headline | AIDA | Confident | No "welcome to" openers |
| Feature tooltip | FAB | Informative | One sentence max |
| Confirmation dialog | Direct | Neutral | Restate what will happen |
| Success feedback | Direct | Warm | Specific, not generic ("Saved!" not "Done") |
| Upgrade prompt | BAB | Aspirational | Show the after, not just the price |
| Destructive warning | Direct + Cost of Inaction | Serious | Name the exact thing being deleted |

---

## Headline Patterns

### Action-forward
- "Stop [bad thing]"
- "Get [desired result] in [timeframe]"
- "The [adjective] way to [action]"
- "[Number] [things] in [timeframe]"

### Contrast
- "[Old way] is [problem]. [New way] is [benefit]."
- "Don't [bad action] — [good action] instead."
- "From [pain state] to [desired state]."

### Social proof
- "[N]+ teams use [product] to [outcome]"
- "Trusted by [category] at [notable company]"

---

## UI Copy Anti-Patterns

**Never:**
- Start a CTA with "Click here" or "Learn more" — be specific about the outcome
- Use passive voice in error messages ("An error was encountered") — say what happened
- Hedge: "This might help", "You may want to", "Perhaps consider" — be direct
- Restate the heading in the first sentence of body copy
- Use em dashes — use commas, colons, or periods instead (monodesign rule)
- Write "Successfully saved" when "Saved" says the same thing in half the words
- Put error messages only at the top of a form — repeat them near the field

**Destructive action dialogs — exact pattern:**
```
Heading:   Delete "[specific item name]"?
Body:      This will permanently delete the project and all its files. This cannot be undone.
Buttons:   [Cancel]   [Delete project]  ← destructive verb, not just "OK" or "Confirm"
```

---

## Copy Length Rules

| Element | Max words |
|---------|-----------|
| CTA button label | 5 |
| Alert/toast message | 15 |
| Empty state description | 25 |
| Error message (cause + fix) | 30 |
| Tooltip / helper text | 20 |
| Confirmation dialog body | 40 |
| Feature callout subtitle | 20 |
| Onboarding step description | 30 |

Short copy is a skill. Every word that isn't earning its place is costing user attention.

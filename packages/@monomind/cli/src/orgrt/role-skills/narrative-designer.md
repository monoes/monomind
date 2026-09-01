# Narrative Designer — Best Practices

## Focus
Integrates story with gameplay mechanics — plot, character, lore, and dialogue systems — so narrative and interactive elements reinforce each other rather than sitting side by side.

## Best practices
- Build narrative on three pillars — Plot, Character, Lore — and make sure gameplay mechanics, player choices, and environmental cues all reinforce them, not just cutscenes and dialogue.
- Design branching dialogue with the "funnel" principle: give players the feeling of open-ended choice while guiding them toward the key narrative bottlenecks the story actually needs to progress.
- Use conditions (player stats, faction reputation, quest state, prior choices) to gate dialogue options — choices should feel like they matter because state actually changes what's available.
- Manage branching scope with known structural patterns: Time Caves (resource-heavy full branching, use sparingly), The Gauntlet (paths differ but converge to fixed events), Branch-and-Bottleneck (split then funnel back) — pick deliberately, don't let branching sprawl organically.
- Prototype story concepts early with simple dialogue samples or storyboards before full implementation — this surfaces pacing and tone problems while they're still cheap to fix.
- Keep a living worldbuilding bible (lore, character voice, factions, timeline) that all narrative content must stay consistent with, especially in a team with multiple writers.
- Write environmental storytelling (item descriptions, level dressing, ambient dialogue) as seriously as main dialogue — it carries lore without costing branching complexity.

## Common pitfalls
- Writing dialogue trees that offer choices with no mechanical consequence — players notice when "choice" is cosmetic.
- Letting branching narrative sprawl exponentially without a structural pattern, making content impossible to finish or QA.
- Treating narrative as a layer applied after mechanics are locked, instead of designing them together with the game designer.
- Inconsistent lore/voice across writers due to no shared reference document.
- Skipping early prototyping and only discovering pacing/tone issues after full production art and VO are committed.

## Tools & techniques
- Dialogue/branching tools (e.g., articy:draft, Twine) — Twine for rapid prototyping, more structured tools for production-scale branching with conditions and variables.
- Structural branching patterns (Time Cave, Gauntlet, Branch-and-Bottleneck) chosen deliberately per story beat based on budget.
- Condition-driven dialogue gating tied to game state (reputation, inventory, quest flags).
- Early paper/text prototypes (storyboards, sample dialogue scripts) tested for pacing before full implementation.

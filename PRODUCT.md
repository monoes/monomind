# Product

## Register

brand

## Users

Senior developers and technical teams who use Claude Code daily and want to extend it into an autonomous, multi-agent orchestration layer. Users are comfortable with CLI tools, understand concepts like swarms, memory backends, and keyword routing, and expect a tool that operates at their level — precise, composable, and non-patronizing. They are evaluating whether Monomind can replace manual agent coordination and improve over time through outcome measurement.

## Product Purpose

Monomind is an orchestration layer for Claude Code. It wraps Claude Code's raw agent power with persistent memory, multi-agent swarm topologies, a knowledge graph, keyword routing with outcome measurement, and a command system that can run autonomously for hours. Success looks like: an engineer types `/mastermind:autodev --tillend` and walks away while Monomind researches, builds, reviews, and loops until the codebase is clean.

## Brand Personality

Precise. Autonomous. Generative.

The brand voice is terse and confident — it shows rather than explains. It never hypes. It trusts the user to be smart. Documentation and UI copy reads like something a senior engineer wrote for themselves.

## Anti-references

- SaaS gradient blob marketing sites (Notion, Linear landing pages — too warm, too "human")
- Green-on-black hacker terminals (too retro, too theatrical)
- Vercel/minimal-white developer tools (too cold, too featureless)
- Purple AI startup branding (over-indexed on "magic", undercuts precision)
- Dashboard-as-hero (metrics soup instead of narrative)

## Design Principles

1. **Show the machine working** — animated agent networks, live counters, typewriter terminals communicate capability without a word
2. **Precision over warmth** — dark surfaces, tight typography, muted color builds trust before delight
3. **Hierarchy earns attention** — the page has one thing to say per scroll unit; nothing competes
4. **Intelligence is structural** — color, spacing, and motion encode meaning (accent = action, amber = intelligence, violet = memory)
5. **Density respects expertise** — the audience reads tables and code; don't hide information behind progressive disclosure

## Accessibility & Inclusion

WCAG AA. `prefers-reduced-motion` respected — all GSAP animations must be conditional on `window.matchMedia('(prefers-reduced-motion: no-preference)')`. Keyboard navigation for sidebar and command search. Sufficient contrast on all text against dark backgrounds.

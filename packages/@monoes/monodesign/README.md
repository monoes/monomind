<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/monodesign.png" alt="@monoes/monodesign" width="600" />
</p>

# @monoes/monodesign

[![npm version](https://img.shields.io/npm/v/@monoes/monodesign?style=flat-square)](https://www.npmjs.com/package/@monoes/monodesign)
[![license](https://img.shields.io/npm/l/@monoes/monodesign?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

**Frontend design intelligence for AI agents** — design tokens, CSS antipattern detection, and the monodesign skill. The unified design agent for the Monomind ecosystem.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

## Install

```bash
npm install @monoes/monodesign
```

## What's inside

| Export | Purpose |
|---|---|
| `tokens` | Design token definitions (colors, spacing, typography, breakpoints) |
| `rules` | Antipattern detection rules for CSS and component structure |
| `antipatterns` | Detect and report common frontend antipatterns |

## Design tokens

```typescript
import { tokens } from '@monoes/monodesign';

// Access design system values
tokens.colors.primary     // brand colors
tokens.spacing.md         // spacing scale
tokens.typography.body    // font stacks and sizes
tokens.breakpoints.tablet // responsive breakpoints
```

## Antipattern detection

```typescript
import { detectAntipatterns } from '@monoes/monodesign';

const issues = detectAntipatterns(cssSource);
// [{ rule: 'no-magic-numbers', line: 42, message: '...' }, ...]
```

## The monodesign skill

In Claude Code, monodesign is available as `/monodesign` — the single design agent handling UI/component systems, brand strategy, UX research, visual storytelling, CSS architecture, design critique, and more. This package provides the runtime intelligence that skill draws from.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT

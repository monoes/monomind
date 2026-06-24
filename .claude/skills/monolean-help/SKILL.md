---
name: monolean-help
description: >
  Quick-reference card for all monolean modes, skills, and commands.
  One-shot display, not a persistent mode. Trigger: /monolean-help,
  "monolean help", "what monolean commands", "how do I use monolean".
---

# Monolean Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | `/monolean lite` | Build what's asked, name the lazier alternative in one line. |
| **Full** | `/monolean` | The ladder enforced: YAGNI → stdlib → native → one line → minimum. Default. |
| **Ultra** | `/monolean ultra` | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

Level sticks until changed or session end.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **monolean** | `/monolean` | Lean mode itself. Simplest solution that works. |
| **monolean-review** | `/monolean-review` | Over-engineering review: `L42: yagni: factory, one product. Inline.` |
| **monolean-audit** | `/monolean-audit` | Whole-repo audit for over-engineering. Ranked findings. |
| **monolean-debt** | `/monolean-debt` | Harvest `monolean:` comments into a debt ledger. |
| **monolean-help** | `/monolean-help` | This card. |

Claude Code uses the slash-command forms above.

## Deactivate

Say "stop monolean" or "normal mode". Resume anytime with `/monolean`.
`/monolean off` also works.

## Configure Default Mode

Default mode = `full`, auto-active every session. Change it:

**Environment variable** (highest priority):
```bash
export MONOLEAN_DEFAULT_MODE=ultra
```

**State file** (`.monomind/state/monolean-mode`):
Write the mode name to this file. Monomind reads it on session start.

Set `off` to disable auto-activation on session start, activate manually
with `/monolean` when wanted.

Resolution: env var > state file > `full`.

## More

Monomind docs: https://github.com/monoes/monomind

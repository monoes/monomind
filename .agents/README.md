# .agents Directory

This directory contains skill definitions for Monobrain.

## Structure

```
.agents/
  skills/         # Skill definitions
    skill-name/
      SKILL.md    # Skill instructions
      scripts/    # Optional scripts
      docs/       # Optional documentation
  README.md       # This file
```

## Skills

Skills are invoked using `$skill-name` syntax. Each skill has:
- YAML frontmatter with metadata
- Trigger and skip conditions
- Commands and examples

## Documentation

- Monobrain: https://github.com/nokhodian/monobrain

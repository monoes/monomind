---
name: automation:workflow-select
---

# workflow-select

Run a predefined workflow template for common tasks.

## Usage

```bash
npx monomind workflow run [options]
```

## Options

- `--template, -t <name>` - Workflow template name
- `--task <description>` - Task description (for template selection)
- `--parallel` - Enable parallel agent execution
- `--max-agents <n>` - Max agents to spawn (default: 4)
- `--dry-run` - Preview workflow without executing

## Examples

### List available templates

```bash
npx monomind workflow template list
```

### Run a template

```bash
npx monomind workflow run --template feature-development --task "Add OAuth login"
```

### Preview without executing

```bash
npx monomind workflow run --template deploy --dry-run
```

### Run in parallel

```bash
npx monomind workflow run --template code-review --parallel --max-agents 6
```

## Workflow Status

```bash
npx monomind workflow list
npx monomind workflow status --watch
```

## See Also

- `auto-agent` — spawn agents without a template
- `smart-spawn` — auto-select agents from task description
- `swarm init` — manual swarm initialization

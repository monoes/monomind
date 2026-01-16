# workflow-execute

Execute saved workflows.

## Usage
```bash
npx monobrain workflow execute [options]
```

## Options
- `--name <name>` - Workflow name
- `--params <json>` - Workflow parameters
- `--dry-run` - Preview execution

## Examples
```bash
# Execute workflow
npx monobrain workflow execute --name "deploy-api"

# With parameters
npx monobrain workflow execute --name "test-suite" --params '{"env": "staging"}'

# Dry run
npx monobrain workflow execute --name "deploy-api" --dry-run
```

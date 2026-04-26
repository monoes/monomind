# workflow-execute

Execute saved workflows.

## Usage
```bash
npx monomind workflow execute [options]
```

## Options
- `--name <name>` - Workflow name
- `--params <json>` - Workflow parameters
- `--dry-run` - Preview execution

## Examples
```bash
# Execute workflow
npx monomind workflow execute --name "deploy-api"

# With parameters
npx monomind workflow execute --name "test-suite" --params '{"env": "staging"}'

# Dry run
npx monomind workflow execute --name "deploy-api" --dry-run
```

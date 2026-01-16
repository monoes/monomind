# workflow-create

Create reusable workflow templates.

## Usage
```bash
npx monobrain workflow create [options]
```

## Options
- `--name <name>` - Workflow name
- `--from-history` - Create from history
- `--interactive` - Interactive creation

## Examples
```bash
# Create workflow
npx monobrain workflow create --name "deploy-api"

# From history
npx monobrain workflow create --name "test-suite" --from-history

# Interactive mode
npx monobrain workflow create --interactive
```

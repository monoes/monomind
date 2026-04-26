# workflow-create

Create reusable workflow templates.

## Usage
```bash
npx monomind workflow create [options]
```

## Options
- `--name <name>` - Workflow name
- `--from-history` - Create from history
- `--interactive` - Interactive creation

## Examples
```bash
# Create workflow
npx monomind workflow create --name "deploy-api"

# From history
npx monomind workflow create --name "test-suite" --from-history

# Interactive mode
npx monomind workflow create --interactive
```

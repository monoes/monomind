# workflow-export

Export workflows for sharing.

## Usage
```bash
npx monobrain workflow export [options]
```

## Options
- `--name <name>` - Workflow to export
- `--format <type>` - Export format
- `--include-history` - Include execution history

## Examples
```bash
# Export workflow
npx monobrain workflow export --name "deploy-api"

# As YAML
npx monobrain workflow export --name "test-suite" --format yaml

# With history
npx monobrain workflow export --name "deploy-api" --include-history
```

# model-update

Update neural models with new data.

## Usage
```bash
npx monomind training model-update [options]
```

## Options
- `--model <name>` - Model to update
- `--incremental` - Incremental update
- `--validate` - Validate after update

## Examples
```bash
# Update all models
npx monomind training model-update

# Specific model
npx monomind training model-update --model agent-selector

# Incremental with validation
npx monomind training model-update --incremental --validate
```

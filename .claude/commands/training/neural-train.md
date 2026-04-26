# neural-train

Train neural patterns from operations.

## Usage
```bash
npx monomind training neural-train [options]
```

## Options
- `--data <source>` - Training data source
- `--model <name>` - Target model
- `--epochs <n>` - Training epochs

## Examples
```bash
# Train from recent ops
npx monomind training neural-train --data recent

# Specific model
npx monomind training neural-train --model task-predictor

# Custom epochs
npx monomind training neural-train --epochs 100
```

# neural-train

Train neural patterns from operations.

## Usage
```bash
npx monobrain training neural-train [options]
```

## Options
- `--data <source>` - Training data source
- `--model <name>` - Target model
- `--epochs <n>` - Training epochs

## Examples
```bash
# Train from recent ops
npx monobrain training neural-train --data recent

# Specific model
npx monobrain training neural-train --model task-predictor

# Custom epochs
npx monobrain training neural-train --epochs 100
```

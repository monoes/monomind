# memory-persist

Persist memory across sessions.

## Usage
```bash
npx monomind memory persist [options]
```

## Options
- `--export <file>` - Export to file
- `--import <file>` - Import from file
- `--compress` - Compress memory data

## Examples
```bash
# Export memory
npx monomind memory persist --export memory-backup.json

# Import memory
npx monomind memory persist --import memory-backup.json

# Compressed export
npx monomind memory persist --export memory.gz --compress
```

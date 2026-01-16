# memory-search

Search through stored memory.

## Usage
```bash
npx monobrain memory search [options]
```

## Options
- `--query <text>` - Search query
- `--pattern <regex>` - Pattern matching
- `--limit <n>` - Result limit

## Examples
```bash
# Search memory
npx monobrain memory search --query "authentication"

# Pattern search
npx monobrain memory search --pattern "api-.*"

# Limited results
npx monobrain memory search --query "config" --limit 10
```

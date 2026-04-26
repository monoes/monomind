# memory-search

Search through stored memory.

## Usage
```bash
npx monomind memory search [options]
```

## Options
- `--query <text>` - Search query
- `--pattern <regex>` - Pattern matching
- `--limit <n>` - Result limit

## Examples
```bash
# Search memory
npx monomind memory search --query "authentication"

# Pattern search
npx monomind memory search --pattern "api-.*"

# Limited results
npx monomind memory search --query "config" --limit 10
```

# cache-manage

Manage operation cache for performance.

## Usage
```bash
npx monobrain optimization cache-manage [options]
```

## Options
- `--action <type>` - Action (view, clear, optimize)
- `--max-size <mb>` - Maximum cache size
- `--ttl <seconds>` - Time to live

## Examples
```bash
# View cache stats
npx monobrain optimization cache-manage --action view

# Clear cache
npx monobrain optimization cache-manage --action clear

# Set limits
npx monobrain optimization cache-manage --max-size 100 --ttl 3600
```

# Video Recording


Capture browser automation as video for debugging, documentation, or CI evidence.

**Related**: [monomind:browse](../browse.md) for full reference.

## Basic Recording

```bash
npx monomind browse record start ./demo.webm

# Perform actions
npx monomind browse open https://example.com
npx monomind browse snapshot -i
npx monomind browse click @e1
npx monomind browse fill @e2 "test input"

npx monomind browse record stop
```

## Commands

```bash
npx monomind browse record start ./output.webm    # start recording to file
npx monomind browse record stop                   # stop current recording
npx monomind browse record restart ./take2.webm   # stop current + start new
```

## Patterns

### Debug a failed automation

```bash
npx monomind browse record start ./debug-$(date +%Y%m%d-%H%M%S).webm

npx monomind browse open https://app.example.com
npx monomind browse snapshot -i
npx monomind browse click @e1 || { echo "Click failed"; monomind browse record stop; exit 1; }

npx monomind browse record stop
```

### CI/CD test evidence

```bash
mkdir -p ./test-recordings
npx monomind browse record start ./test-recordings/e2e-$(date +%s).webm

# run tests...

npx monomind browse record stop
```

### Combine with screenshots

```bash
npx monomind browse record start ./flow.webm

npx monomind browse open https://example.com
npx monomind browse screenshot ./screenshots/step1.png

npx monomind browse click @e1
npx monomind browse screenshot ./screenshots/step2.png

npx monomind browse record stop
```

## Best Practices

1. **Add pauses** — `wait 500` after clicks lets viewers see results
2. **Descriptive filenames** — include date/context: `login-flow-2026-05-17.webm`
3. **Trap cleanup** — always stop recording on exit:
   ```bash
   cleanup() { monomind browse record stop 2>/dev/null || true; }
   trap cleanup EXIT
   ```

## Output Format

- Default: WebM (VP8/VP9) — compatible with all modern browsers
- Adds slight overhead to automation
- Large recordings consume significant disk space

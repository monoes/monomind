---
name: monomind:browse
description: State-of-the-art browser automation skill for UI testing, web scraping, and agent-driven navigation using monomind browse (built-in TypeScript CDP client). Token-optimized with ref-based element selection, batch execution, KV-cache prompt ordering, on-demand screenshots, and full monomind memory integration.
version: 2.0.0
triggers:
  - /browse
  - monomind:browse
  - browse the web
  - test the UI
  - browser automation
  - open the browser
  - navigate to
  - click on the website
  - fill out the form
  - test login
  - take a screenshot
  - check the page
  - web vitals
  - react tree
  - scrape
  - crawl
tools:
  - Bash
requires:
  - monomind >= 1.0.0
---

# monomind:browse

State-of-the-art browser automation using monomind browse. Optimized for minimal token consumption, maximum test coverage, and deep monomind integration.

---

## Setup (Run Once)

```bash
# Install
# monomind browse is built-in — no install needed

# Download Chrome (first time only)
# no install needed

# Verify
npx monomind browse --version   # should be >= 0.25.4
npx monomind browse doctor      # check all systems
```

---

## Token Efficiency Rules (ALWAYS FOLLOW)

These rules are non-negotiable. Violating them wastes tokens and degrades performance.

1. **Batch multi-step flows** — Use `monomind browse batch` to execute sequences in a single process invocation. Eliminates per-command startup overhead.
2. **Snapshot with `-i` flag** — Interactive-only snapshots are 93% smaller than full trees. Never call `monomind browse snapshot` without `-i` unless you need to understand full page structure.
3. **Reuse refs** — After a snapshot, refs (`@e1`, `@e2`) are stable for the current page. Do NOT re-snapshot unless the page changed. One snapshot per page-state.
4. **On-demand screenshots only** — Screenshots add ~800ms and ~1500 tokens as images. Only call `monomind browse screenshot` when: element not in a11y tree, visual verification is required, or the task explicitly needs visual proof.
5. **Use batch for read-only chains** — `npx monomind browse open url` then `snapshot -i` is two process starts. `monomind browse batch "open url" "snapshot -i"` is one.
6. **Scope snapshots** — When testing a form or component, use `monomind browse snapshot -i "#form-id"` to scope to that subtree only.
7. **Prefer `wait --text` over polling** — Never sleep and re-snapshot. Use `monomind browse wait --text "Expected"` or `wait --url "**pattern"`.

---

## Core Loop

```
OPEN → SNAPSHOT -i → ACT (by ref) → SNAPSHOT -i (if page changed) → VERIFY → REPEAT
```

### Minimal golden-path example

```bash
# Batch: open + snapshot in one call
npx monomind browse batch "open https://app.example.com/login" "snapshot -i"
# → snapshot output: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Sign In" [ref=e3]

npx monomind browse fill @e1 "user@test.com"
npx monomind browse fill @e2 "SecurePass123!"
npx monomind browse click @e3
npx monomind browse wait --url "**/dashboard" --timeout 8000

# Re-snapshot only because URL changed (new page state)
npx monomind browse snapshot -i
```

### Full batch mode (most token-efficient)

```bash
npx monomind browse batch \
  "open https://app.example.com/login" \
  "snapshot -i" \
  "fill @e1 user@test.com" \
  "fill @e2 SecurePass123!" \
  "click @e3" \
  "wait --url **/dashboard" \
  "snapshot -i"
```

Or as JSON via stdin (best for programmatic use):

```bash
echo '[
  ["open", "https://app.example.com/login"],
  ["snapshot", "-i"],
  ["fill", "@e1", "user@test.com"],
  ["fill", "@e2", "SecurePass123!"],
  ["click", "@e3"],
  ["wait", "--url", "**/dashboard"],
  ["snapshot", "-i"]
]' | monomind browse batch --json --bail
```

---

## All Commands Reference

### Navigation

```bash
npx monomind browse open <url>              # Launch + navigate (aliases: goto, navigate)
npx monomind browse open                    # Launch on about:blank (for pre-nav setup)
npx monomind browse back                    # Go back
npx monomind browse forward                 # Go forward
npx monomind browse reload                  # Reload
npx monomind browse pushstate <url>         # SPA client-side nav (Next.js, Remix, etc.)
npx monomind browse close                   # Close browser
npx monomind browse close --all             # Close all sessions
```

### Snapshot (primary observation tool)

```bash
npx monomind browse snapshot                # Full accessibility tree + refs
npx monomind browse snapshot -i             # Interactive elements only (USE THIS BY DEFAULT)
npx monomind browse snapshot -i --urls      # Include href URLs for links
npx monomind browse snapshot -c             # Compact (strip empty structural nodes)
npx monomind browse snapshot -d 3           # Limit depth to 3 levels
npx monomind browse snapshot -s "#main"     # Scope to CSS selector
npx monomind browse snapshot -i -c -d 5    # Combined: compact interactive, max depth 5
npx monomind browse snapshot --json         # JSON output for programmatic use
```

**Output example:**
```
- textbox "Email" [ref=e1]
- textbox "Password" [ref=e2]
- button "Sign In" [ref=e3]
- link "Forgot password" [ref=e4]
```

### Interaction

```bash
# Primary: use @ref from snapshot (fastest, no DOM re-query)
npx monomind browse click @e3
npx monomind browse fill @e1 "value"
npx monomind browse dblclick @e5
npx monomind browse hover @e6
npx monomind browse check @e7               # checkbox
npx monomind browse uncheck @e8
npx monomind browse select @e9 "Option A"
npx monomind browse focus @e2

# Keyboard
npx monomind browse press Enter
npx monomind browse press Tab
npx monomind browse press "Control+a"
npx monomind browse keyboard type "hello world"      # real keystrokes
npx monomind browse keyboard inserttext "hello"      # insert without key events
npx monomind browse keydown Shift
npx monomind browse keyup Shift

# Drag & drop
npx monomind browse drag @e1 @e2
npx monomind browse upload @e3 /path/to/file.pdf

# Scroll
npx monomind browse scroll down 500         # scroll 500px down
npx monomind browse scroll up
npx monomind browse scrollintoview @e10
npx monomind browse scroll down --selector "#feed"
```

### Semantic locators (fallback when no ref available)

```bash
npx monomind browse find role button click --name "Submit"
npx monomind browse find text "Sign In" click
npx monomind browse find label "Email" fill "test@test.com"
npx monomind browse find placeholder "Search..." fill "query"
npx monomind browse find testid "submit-btn" click
npx monomind browse find first ".item" click
npx monomind browse find nth 2 "a" text
```

### Wait (never sleep/poll manually)

```bash
npx monomind browse wait 500                         # ms delay (use sparingly)
npx monomind browse wait "#spinner" --state hidden   # wait for element to hide
npx monomind browse wait --text "Success"            # wait for text to appear
npx monomind browse wait --url "**/dashboard"        # wait for URL pattern
npx monomind browse wait --load networkidle          # wait for network idle
npx monomind browse wait --fn "window.ready === true"  # wait for JS condition
npx monomind browse wait --fn "!document.body.innerText.includes('Loading')"
```

### Read state

```bash
npx monomind browse get text @e1           # text content
npx monomind browse get html @e2           # innerHTML
npx monomind browse get value @e3          # input value
npx monomind browse get attr @e4 "href"    # attribute
npx monomind browse get title              # page title
npx monomind browse get url                # current URL
npx monomind browse get count ".item"      # count matching elements
npx monomind browse get box @e1            # bounding box
npx monomind browse get styles @e1         # computed CSS styles

npx monomind browse is visible @e1         # boolean check
npx monomind browse is enabled @e1
npx monomind browse is checked @e1
```

### Screenshots (use sparingly)

```bash
npx monomind browse screenshot                        # auto-path in /tmp
npx monomind browse screenshot page.png              # specific path
npx monomind browse screenshot --full full-page.png  # full-page scroll capture
npx monomind browse screenshot --annotate            # numbered refs overlaid → use with visual models
npx monomind browse pdf report.pdf                   # save as PDF
```

**Annotated screenshot pattern** (for visual debugging or multimodal LLMs):
```bash
npx monomind browse screenshot --annotate
# Output: [1] @e1 button "Submit"  [2] @e2 link "Home"  [3] @e3 textbox "Email"
# Now refs are cached — interact immediately without re-snapshot
npx monomind browse click @e1
```

### Diff (regression testing)

```bash
npx monomind browse diff snapshot                           # current vs last snapshot
npx monomind browse diff snapshot --baseline ./before.txt   # vs saved file
npx monomind browse diff snapshot -s "#main" --compact      # scoped diff
npx monomind browse diff screenshot --baseline before.png   # pixel diff
npx monomind browse diff screenshot --baseline b.png -t 0.2 # threshold 0–1
npx monomind browse diff url https://v1.com https://v2.com  # compare two URLs
npx monomind browse diff url https://v1.com https://v2.com --screenshot  # + visual
```

### Tabs & multi-tab

```bash
npx monomind browse tab                          # list all tabs
npx monomind browse tab new https://example.com  # new tab
npx monomind browse tab new --label docs https://docs.example.com  # named tab
npx monomind browse tab docs                     # switch by label
npx monomind browse tab t2                       # switch by stable id
npx monomind browse tab close docs               # close by label
npx monomind browse window new                   # new window
npx monomind browse frame "#iframe-id"           # switch to iframe
npx monomind browse frame main                   # back to main frame
```

**Multi-tab parallel test pattern:**
```bash
npx monomind browse tab new --label app https://app.example.com
npx monomind browse tab new --label docs https://docs.example.com
npx monomind browse tab app
npx monomind browse snapshot -i    # refs for app tab
npx monomind browse click @e3
npx monomind browse tab docs
npx monomind browse snapshot -i    # refs for docs tab
```

### Dialogs

```bash
npx monomind browse dialog accept "confirmation text"
npx monomind browse dialog dismiss
npx monomind browse dialog status            # is a dialog currently open?
```

Note: `alert` and `beforeunload` are auto-accepted by default. `confirm` and `prompt` need explicit handling.

### Network interception

```bash
npx monomind browse network route "https://api.example.com/*" --abort    # block endpoint
npx monomind browse network route "*" --abort --resource-type script      # block all JS
npx monomind browse network route "https://api/*" --body '{"data":[]}'   # mock response
npx monomind browse network unroute "https://api.example.com/*"
npx monomind browse network requests                          # view tracked requests
npx monomind browse network requests --filter api             # filter by URL substring
npx monomind browse network requests --type xhr,fetch         # filter by type
npx monomind browse network requests --method POST
npx monomind browse network requests --status 2xx
npx monomind browse network request <requestId>               # full request/response
npx monomind browse network har start                         # record HAR
npx monomind browse network har stop output.har               # stop + save
```

**Pre-nav setup pattern** (set network routes BEFORE navigating):
```bash
npx monomind browse batch \
  '["open"]' \
  '["network", "route", "*", "--abort", "--resource-type", "script"]' \
  '["cookies", "set", "--curl", "auth.curl", "--domain", "localhost"]' \
  '["navigate", "http://localhost:3000"]'
```

### Cookies & storage

```bash
npx monomind browse cookies                              # get all cookies
npx monomind browse cookies set name value              # set cookie
npx monomind browse cookies set --curl cookies.curl     # import from cURL dump / JSON / header string
npx monomind browse cookies clear

npx monomind browse storage local                        # get localStorage
npx monomind browse storage local myKey                  # get specific key
npx monomind browse storage local set myKey myValue      # set
npx monomind browse storage local clear
npx monomind browse storage session                      # sessionStorage (same API)
```

### Browser settings

```bash
npx monomind browse set viewport 1280 720 2             # width height deviceScaleFactor
npx monomind browse set device "iPhone 15 Pro"          # device emulation
npx monomind browse set geo 37.7749 -122.4194           # geolocation
npx monomind browse set offline on                      # offline mode
npx monomind browse set headers '{"Authorization":"Bearer tok"}'  # global headers
npx monomind browse set credentials user pass           # HTTP basic auth
npx monomind browse set media dark                      # color scheme
```

### Clipboard

```bash
npx monomind browse clipboard read
npx monomind browse clipboard write "Hello"
npx monomind browse clipboard copy      # Ctrl+C
npx monomind browse clipboard paste     # Ctrl+V
```

### Mouse (raw control, use only when refs/semantic locators fail)

```bash
npx monomind browse mouse move 100 200
npx monomind browse mouse down left
npx monomind browse mouse up left
npx monomind browse mouse wheel 100 0   # dy dx
```

### React DevTools (v0.27+)

Requires launching with `--enable react-devtools`:

```bash
# Launch with hook installed
npx monomind browse open --enable react-devtools https://your-react-app.com

# Inspect component tree
npx monomind browse react tree                         # full component hierarchy
npx monomind browse react inspect 5                    # fiber ID → props, hooks, state, source
npx monomind browse react renders start                # begin render profiling
npx monomind browse react renders stop                 # print profile (mount/re-render counts)
npx monomind browse react renders stop --json          # JSON output
npx monomind browse react suspense                     # Suspense boundaries + root-cause classifier
npx monomind browse react suspense --only-dynamic      # hide static boundaries
```

### Web Vitals (framework-agnostic)

```bash
npx monomind browse vitals                             # LCP, CLS, TTFB, FCP, INP + React hydration
npx monomind browse vitals https://example.com         # test specific URL
npx monomind browse vitals --json                      # JSON output
```

### Tracing & profiling

```bash
npx monomind browse trace start trace.zip             # start Chrome trace
npx monomind browse trace stop trace.zip              # stop and save
npx monomind browse profiler start                    # DevTools profiler
npx monomind browse profiler stop profile.json        # stop and save

npx monomind browse console                           # browser console messages
npx monomind browse console --json                    # structured CDP output
npx monomind browse console --clear
npx monomind browse errors                            # uncaught JS exceptions
npx monomind browse errors --clear
```

### Sessions & auth

```bash
# Isolated sessions (each has own browser, cookies, history)
npx monomind browse --session agent1 open site-a.com
npx monomind browse --session agent2 open site-b.com
npx monomind browse session list

# Persist state across restarts
npx monomind browse --session-name myapp open app.example.com
# → auto-saves to ~/.monomind/browser-sessions/myapp

# Reuse existing Chrome login
npx monomind browse profiles                          # list Chrome profiles
npx monomind browse --profile Default open gmail.com

# Save / load state
npx monomind browse state save ./auth.json            # save cookies + localStorage
npx monomind browse state load ./auth.json
npx monomind browse --state ./auth.json open https://app.example.com/dashboard

# Auth vault (credentials never sent to LLM)
echo "mypassword" | monomind browse auth save github --url https://github.com/login --username me --password-stdin
npx monomind browse auth login github

# Encrypted state at rest
export AGENT_BROWSER_ENCRYPTION_KEY=<64-char-hex>
npx monomind browse --session-name secure open example.com
```

### Dashboard (observability)

```bash
npx monomind browse dashboard start              # port 4848
npx monomind browse dashboard start --port 8080
npx monomind browse dashboard stop
# → open http://localhost:4848 for live viewport + activity feed + AI chat
```

### Init scripts

```bash
npx monomind browse open --init-script ./setup.js https://app.example.com
npx monomind browse addinitscript "window.__TEST__ = true"
npx monomind browse removeinitscript <identifier>
```

### iOS / Mobile (real Safari)

Requires: `npm install -g appium && appium driver install xcuitest`

```bash
npx monomind browse device list
npx monomind browse -p ios --device "iPhone 15 Pro" open https://example.com
npx monomind browse -p ios snapshot -i
npx monomind browse -p ios tap @e1
npx monomind browse -p ios fill @e2 "text"
npx monomind browse -p ios swipe up
npx monomind browse -p ios screenshot mobile.png
npx monomind browse -p ios close
```

### Cloud providers

| Provider | Env var | Flag |
|---------|---------|------|
| Browserbase | `BROWSERBASE_API_KEY` | `-p browserbase` |
| Browser Use | `BROWSER_USE_API_KEY` | `-p browseruse` |
| Browserless | `BROWSERLESS_API_KEY` | `-p browserless` |
| Kernel | `KERNEL_API_KEY` | `-p kernel` |
| AWS AgentCore | AWS credentials | `-p agentcore` |

All commands work identically regardless of provider.

### Streaming

```bash
npx monomind browse stream status           # see WebSocket port
npx monomind browse stream enable --port 9223
npx monomind browse stream disable
```

### CDP / Electron apps

```bash
npx monomind browse connect 9222            # connect to port, persist for session
npx monomind browse --cdp 9222 snapshot     # per-command
npx monomind browse --cdp wss://remote/cdp snapshot
npx monomind browse --auto-connect snapshot  # auto-discover running Chrome
```

---

## Test Flows

### Login / Auth

```bash
npx monomind browse batch \
  "open https://app.example.com/login" \
  "snapshot -i"
# identify refs from output, then:
npx monomind browse fill @e[email] "user@test.com"
npx monomind browse fill @e[password] "TestPass123!"
npx monomind browse click @e[submit]
npx monomind browse wait --url "**/dashboard" --timeout 8000
```

### Form with validation

```bash
# Test happy path
npx monomind browse batch "open /form" "snapshot -i"
npx monomind browse fill @e1 "John Doe"
npx monomind browse fill @e2 "john@test.com"
npx monomind browse select @e3 "Option A"
npx monomind browse check @e4
npx monomind browse click @e5
npx monomind browse wait --text "submitted"
npx monomind browse screenshot pass-form.png

# Test validation (empty submit)
npx monomind browse reload
npx monomind browse snapshot -i
npx monomind browse click @e5                    # submit empty
npx monomind browse wait --text "required"
npx monomind browse snapshot -i                  # verify error messages

# Invalid email
npx monomind browse fill @e2 "not-an-email"
npx monomind browse click @e5
npx monomind browse snapshot -i
```

### CRUD

```bash
# Create
npx monomind browse click @e[add]
npx monomind browse fill @e[name] "New Item"
npx monomind browse click @e[save]
npx monomind browse wait --text "New Item"

# Update
npx monomind browse click @e[edit]
npx monomind browse fill @e[name] "Updated Item"
npx monomind browse click @e[save]
npx monomind browse wait --text "Updated Item"

# Delete
npx monomind browse click @e[delete]
npx monomind browse wait --text "Are you sure"
npx monomind browse click @e[confirm]
npx monomind browse wait --fn "!document.body.innerText.includes('Updated Item')"
```

### Multi-step wizard

```bash
# Step 1
npx monomind browse batch "open /wizard" "snapshot -i"
npx monomind browse fill @e1 "value"
npx monomind browse click @e[next]
npx monomind browse wait --text "Step 2"

# Step 2
npx monomind browse snapshot -i
npx monomind browse select @e2 "choice"
npx monomind browse click @e[next]

# Step 3 — verify summary
npx monomind browse snapshot -i
npx monomind browse get text @e[summary]
npx monomind browse click @e[confirm]
npx monomind browse wait --text "Complete"
```

### Regression test (diff baseline)

```bash
# Save baseline
npx monomind browse open https://app.example.com
npx monomind browse snapshot -i > baseline.txt

# After a deploy, compare:
npx monomind browse open https://app.example.com
npx monomind browse diff snapshot --baseline ./baseline.txt
```

### API mocking

```bash
# Mock API response, test UI reaction
npx monomind browse batch \
  '["open"]' \
  '["network", "route", "https://api.example.com/users", "--body", "{\"data\":[]}"]' \
  '["navigate", "https://app.example.com/users"]'
npx monomind browse snapshot -i
# → verify "No users found" empty state renders correctly
```

### React app deep inspection

```bash
npx monomind browse open --enable react-devtools https://your-react-app.com
npx monomind browse react tree
npx monomind browse vitals --json
npx monomind browse react renders start
# ... trigger user interactions ...
npx monomind browse react renders stop
npx monomind browse react suspense --only-dynamic
```

---

## Configuration

Create in project root for persistent defaults:

```json
{
  "$schema": "https://monomind.dev/schema.json",
  "maxOutput": 50000,
  "contentBoundaries": true,
  "idleTimeout": "5m",
  "screenshotDir": "./screenshots",
  "screenshotFormat": "jpeg",
  "screenshotQuality": 80
}
```

Key security defaults for agent deployments:
```json
{
  "contentBoundaries": true,
  "maxOutput": 50000,
  "allowedDomains": ["app.example.com", "*.example.com"],
  "noAutoDialog": false
}
```

Key env vars:
```bash
AGENT_BROWSER_SESSION=<name>          # session isolation
AGENT_BROWSER_SESSION_NAME=<name>     # auto-persist state
AGENT_BROWSER_MAX_OUTPUT=50000        # prevent context flooding
AGENT_BROWSER_DEFAULT_TIMEOUT=30000  # op timeout in ms (default: 25000)
AGENT_BROWSER_IDLE_TIMEOUT_MS=300000  # daemon auto-shutdown after idle
AGENT_BROWSER_CONTENT_BOUNDARIES=1   # LLM-safe output delimiters
AGENT_BROWSER_HEADED=1               # visible browser (debugging)
AGENT_BROWSER_STREAM_PORT=9223       # fixed WebSocket stream port
# No API key needed — monomind browse is built-in
AI_GATEWAY_MODEL=anthropic/claude-sonnet-4-6
```

---

## Monomind Integration

### Store successful test flows

```bash
npx monomind memory store \
  --namespace browse \
  --key "login-flow-<app>" \
  --value "open /login → snapshot -i → fill @e[email] → fill @e[pw] → click @e[submit] → wait **/dashboard"
```

### Retrieve before testing

```bash
npx monomind memory search --query "login flow" --namespace browse
```

### Report bugs as tasks

```bash
npx monomind task create \
  --title "UI Bug: form submits with empty email" \
  --description "Steps: open /login, click submit without filling email. No validation shown. Screenshot: /tmp/bug-123.png"
```

### Save auth state for reuse across sessions

```bash
# Once logged in:
npx monomind browse state save .monomind/auth/<app>.json

# Future sessions:
npx monomind browse --state .monomind/auth/<app>.json open https://app.example.com
```

---

## Anti-patterns (NEVER DO)

| Anti-pattern | Why | Fix |
|---|---|---|
| `monomind browse snapshot` (no `-i`) for every step | Full tree = 10–20x tokens | Use `snapshot -i` always |
| Playwright MCP | 13,700-token schema tax before step 1 | Use monomind browse directly |
| Screenshot every step | +800ms +1500 tokens each | Screenshot only on fail/visual-required |
| Re-snapshot without page change | Wastes tokens | Reuse refs from last snapshot |
| `sleep N` between actions | Slow, fragile | Use `wait --text`, `wait --url`, `wait --fn` |
| CSS selectors when refs available | Slower, can break | Always prefer `@eN` refs from snapshot |
| Separate commands when batch works | Extra process starts | Use `batch` for multi-step flows |

---

## Checklist

When this skill is activated:
- [ ] `npx monomind browse --version` — confirm monomind is installed
- [ ] `npx monomind doctor` — check system health
- [ ] Get target URL from user if not provided
- [ ] Use `batch "open <url>" "snapshot -i"` to start
- [ ] Use refs (`@eN`) from snapshot output for all interactions
- [ ] Only re-snapshot after confirmed page-state change
- [ ] Only screenshot when visual evidence is required
- [ ] Use `wait --text / --url / --fn` instead of sleep or polling
- [ ] Report results: ✓ PASS / ✗ FAIL (steps to reproduce) / ⚠ WARN
- [ ] Store successful patterns in monomind memory (`browse` namespace)
- [ ] Create monomind task for any found bugs

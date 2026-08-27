---
name: agent-browser-testing
description: Comprehensive UI QA and browser automation using the native monomind browse CDP client — full test lifecycle from discovery through performance profiling, with structured pass/fail/warn reporting.
version: 4.0.0
triggers:
  - /agent-browser-testing
  - /ui-test
  - /monobrowse
  - /qa
  - /crawl
  - ui test
  - test the UI
  - browser test
  - test this system
  - walk through
  - check the UI
  - QA this
  - test frontend
  - visual test
  - crawl
  - scrape
  - browse the website
  - go to the website
  - open the website
  - navigate to
  - click on the website
  - do this on the website
  - automate the browser
  - fill out the form
  - log into
  - sign in to
tools:
  - Bash
---

# Agent Browser Testing — Full QA Suite

**Engine:** `npx monomind browse` — native TypeScript CDP client. No Playwright, no Puppeteer, no external binary. Every command below goes through this single infrastructure.

**CRITICAL RULE:** Never use `mcp__claude-in-chrome__*`, `mcp__plugin_playwright__*`, or any other browser tool. Always use `npx monomind browse`.

---

## Commands at a Glance

All 55 subcommands — grouped by what they do.

| Group | Commands |
|---|---|
| **Open / Navigate** | `open`, `navigate back\|forward\|reload`, `pushstate`, `connect`, `close` |
| **Inspect** | `snapshot`, `get url\|title\|text\|html\|value\|attr\|count\|box\|styles`, `errors`, `console` |
| **Find** | `find role\|text\|label\|placeholder\|testid\|alttext\|title\|selector` |
| **Assert** | `is visible\|enabled\|checked`, `isvisible`, `isenabled`, `ischecked` |
| **Click / Tap** | `click`, `dblclick`, `tap`, `hover`, `focus` |
| **Type / Fill** | `fill`, `type`, `keyboard type\|inserttext`, `keydown`, `keyup`, `press` |
| **Form** | `select`, `check`, `uncheck`, `upload` |
| **Scroll / Drag** | `scroll`, `scrollintoview`, `drag`, `swipe up\|down\|left\|right` |
| **Mouse (raw)** | `mouse move\|down\|up\|wheel` |
| **Wait** | `wait --text\|--not-text\|--url\|--selector\|--load\|--ms\|--fn\|--download` |
| **Download** | `download <ref> <path>`, `wait --download <path>` |
| **Screenshot / PDF** | `screenshot`, `pdf`, `highlight`, `diff url` |
| **Clipboard** | `clipboard read\|write\|copy\|paste` |
| **Dialogs** | `dialog accept\|dismiss\|status` |
| **Tabs** | `tab list\|new\|close\|<targetId>` |
| **Windows** | `window new [url]` (isolated context / incognito) |
| **Frames** | `frame <ref>\|main` |
| **Storage** | `storage local\|session`, `cookies list\|set\|clear` |
| **Network** | `network route\|unroute\|headers\|capture\|requests\|request` |
| **Emulation** | `set device\|media\|geo\|offline\|useragent\|viewport\|credentials`, `resize` |
| **Session** | `state save\|load\|list\|show\|clear\|rename\|clean`, `open --session\|--state` |
| **JS / Init** | `eval`, `eval --stdin`, `addinitscript`, `removeinitscript` |
| **Record** | `record start\|stop\|restart\|status` |
| **Performance** | `vitals`, `trace start\|stop\|status`, `profiler start\|stop\|heap`, `har start\|stop\|status` |
| **Batch** | `batch "cmd1" "cmd2" ...` |

---

## QA Execution Protocol

When this skill is invoked, run ALL phases unless the user specifies a subset.

### Phase 0 — Pre-flight

```bash
# Verify server is reachable before starting
npx monomind browse open <url>
npx monomind browse get url          # confirm we landed on the right page
npx monomind browse get title
npx monomind browse errors           # baseline — clear before testing
```

### Phase 1 — Discovery & Structure Audit

```bash
npx monomind browse snapshot         # full AX tree — understand page structure
npx monomind browse snapshot -i      # interactive-only (93% less context)
npx monomind browse find role link   # enumerate all links
npx monomind browse find role button # enumerate all buttons
npx monomind browse find role heading # heading hierarchy
npx monomind browse find role form   # form elements
npx monomind browse find role image  # images (check alt text in snapshot)
```

**Report:** page structure, heading hierarchy, interactive element count, any obvious missing landmarks.

### Phase 2 — Golden Path Testing

Execute the primary user flow end-to-end. Pattern:

```bash
npx monomind browse open <url>
npx monomind browse snapshot -i
# identify refs → act → re-snapshot → verify

npx monomind browse fill @e1 "value"
npx monomind browse click @e2
npx monomind browse wait --text "expected result"
npx monomind browse snapshot -i
npx monomind browse errors           # check after every major action
```

**Report:** each step result, any deviations from expected state.

### Phase 3 — Edge Case & Validation Testing

```bash
# Empty submission
npx monomind browse click @submit_btn
npx monomind browse wait --text "required" --timeout 3000
npx monomind browse snapshot -i

# Invalid input
npx monomind browse fill @email_field "not-an-email"
npx monomind browse click @submit_btn
npx monomind browse snapshot -i

# Boundary values
npx monomind browse fill @text_field ""               # empty
npx monomind browse fill @text_field "a"              # min
npx monomind browse fill @text_field "$(python3 -c 'print("x"*1000)')"  # overflow

# Element state checks
npx monomind browse is visible @e5
npx monomind browse is enabled @e3
npx monomind browse is checked @e7
```

### Phase 4 — Cross-Device & Responsive

```bash
# Mobile
npx monomind browse set device "iPhone 14"
npx monomind browse screenshot mobile-portrait.png
npx monomind browse snapshot -i

# Tablet
npx monomind browse set device "iPad Pro"
npx monomind browse screenshot tablet.png

# Desktop wide
npx monomind browse resize 1920 1080
npx monomind browse screenshot desktop-wide.png

# Dark mode
npx monomind browse set media dark
npx monomind browse screenshot dark-mode.png
npx monomind browse set media light

# Reset
npx monomind browse resize 1280 800
```

### Phase 5 — Keyboard & Accessibility

```bash
# Tab order — tab through every focusable element
npx monomind browse focus @e1
npx monomind browse press Tab
npx monomind browse snapshot -i       # repeat until full cycle

# ARIA roles present
npx monomind browse find role navigation
npx monomind browse find role main
npx monomind browse find role banner

# Keyboard activation
npx monomind browse press Enter        # activate focused element
npx monomind browse press Escape       # close modals/dropdowns
npx monomind browse press Space        # toggle checkboxes

# Keyboard combos (key combos must use press, not keyboard)
npx monomind browse press "Control+A"
npx monomind browse press "Control+Z"
```

### Phase 6 — Network & Error Monitoring

```bash
# Start network capture before the flow
npx monomind browse har start
# ... run the flow ...
npx monomind browse har stop --bodies --json   # --bodies only valid on stop

# Check for failed requests during testing
npx monomind browse network requests --json

# Simulate offline
npx monomind browse set offline true
npx monomind browse snapshot -i        # should show graceful offline state
npx monomind browse set offline false

# Final error check
npx monomind browse console           # all console output
npx monomind browse errors            # JS exceptions only
```

### Phase 7 — Performance Audit

```bash
# Core Web Vitals
npx monomind browse vitals --wait 3000 --json

# Full trace (open DevTools-compatible)
npx monomind browse trace start --screenshots
# ... trigger the critical user flow ...
npx monomind browse trace stop ./qa-trace.json

# HAR for waterfall analysis
npx monomind browse har start
npx monomind browse navigate reload
npx monomind browse wait --load networkidle
npx monomind browse har stop --bodies --json
```

**Report vitals thresholds:**
- LCP < 2.5s = PASS, 2.5–4s = WARN, >4s = FAIL
- CLS < 0.1 = PASS, 0.1–0.25 = WARN, >0.25 = FAIL
- FCP < 1.8s = PASS, 1.8–3s = WARN, >3s = FAIL

---

## Core Testing Loop

```
OPEN → SNAPSHOT → ACT → SNAPSHOT → VERIFY → REPEAT
```

```bash
npx monomind browse open <url>
npx monomind browse snapshot -i
npx monomind browse click @e1
npx monomind browse fill @e2 "value"
npx monomind browse press Enter
npx monomind browse snapshot -i
npx monomind browse get text @e5
npx monomind browse get url
npx monomind browse wait --text "Success"
npx monomind browse errors
```

---

## Full Command Reference

### Navigation & Window

```bash
npx monomind browse open <url>                    # open URL (launches Chrome if needed)
npx monomind browse open <url> --headless         # headless mode
npx monomind browse open <url> --session <name>   # restore saved session
npx monomind browse open <url> --state <file>     # restore from state file
npx monomind browse navigate back
npx monomind browse navigate forward
npx monomind browse navigate reload
npx monomind browse pushstate /path               # SPA client-side nav
npx monomind browse resize 1280 800
npx monomind browse connect --port 9222           # attach to running Chrome
npx monomind browse connect --port 9222 --target <id>
npx monomind browse close
```

### Snapshot & Element Discovery

```bash
npx monomind browse snapshot                      # full AX tree
npx monomind browse snapshot -i                   # interactive elements only
npx monomind browse snapshot --compact            # compact format
npx monomind browse snapshot --json               # machine-readable
npx monomind browse snapshot --depth 3            # limit tree depth
npx monomind browse snapshot --selector "#modal"  # scope to element

npx monomind browse get url
npx monomind browse get title
npx monomind browse get text               # full page text
npx monomind browse get text @eN          # element text
npx monomind browse get html               # full page HTML (ref arg is ignored — always returns full doc)
# for element HTML: npx monomind browse eval "document.querySelector('...').outerHTML"
npx monomind browse get value @eN
npx monomind browse get attr @eN href
npx monomind browse get count "button"    # count elements matching CSS selector
npx monomind browse get box @eN           # bounding box {x,y,width,height}
npx monomind browse get styles @eN        # computed styles
npx monomind browse is checked @eN
```

### Element Finders (semantic — no CSS selectors needed)

```bash
npx monomind browse find role button              # by ARIA role
npx monomind browse find role button --name "Submit"
npx monomind browse find text "Delete"            # by visible text
npx monomind browse find label "Email"            # by label text
npx monomind browse find testid "submit-btn"      # by data-testid
npx monomind browse find alttext "Company logo"   # by alt attribute (images)
npx monomind browse find title "More options"     # by title attribute (tooltips)
npx monomind browse find role link --nth 2        # nth match
npx monomind browse find role image --last        # last match
npx monomind browse find placeholder "Search..."  # by placeholder text
npx monomind browse find selector "div.modal"     # by CSS selector

# Inline action after find
npx monomind browse find role button --name "Submit" click
npx monomind browse find label "Email" fill "test@example.com"
npx monomind browse find text "Delete" click

# State checks
npx monomind browse is visible @eN
npx monomind browse is enabled @eN
npx monomind browse is checked @eN
```

### Window Management (Isolated Contexts)

```bash
# Open a new isolated browser window (like incognito — separate cookies/storage)
npx monomind browse window new
npx monomind browse window new https://app.example.com

# Useful for multi-user testing (e.g. admin + regular user simultaneously):
# 1. Connect once, then open isolated windows for each user role
npx monomind browse connect --port 9222
npx monomind browse window new                 # switches to new isolated context
npx monomind browse open https://app.example.com/login
npx monomind browse fill @e1 "admin@example.com"
# ...

# Tab management (within the same context)
npx monomind browse tab                        # list all tabs
npx monomind browse tab new https://example.com
npx monomind browse tab close <tabId>
npx monomind browse tab <tabId>               # switch to tab
```

### Interaction

```bash
npx monomind browse click @eN
npx monomind browse click @eN --right            # right-click
npx monomind browse click @eN --double           # double-click (or dblclick)
npx monomind browse dblclick @eN
npx monomind browse hover @eN
npx monomind browse focus @eN
npx monomind browse fill @eN "text"              # clear + type (fast)
npx monomind browse type @eN "text"              # char-by-char (triggers keypress)
npx monomind browse press Enter                  # key on focused element
npx monomind browse press Tab
npx monomind browse press Escape
npx monomind browse press "Control+A"
npx monomind browse press "Control+Shift+I"      # key combos always use press
npx monomind browse keyboard type "Hello"        # insert text without targeting an element
npx monomind browse keyboard inserttext "Hello"  # alias for keyboard type
npx monomind browse keydown "Shift"
npx monomind browse keyup "Shift"
npx monomind browse select @eN "Option A"        # select dropdown option
npx monomind browse check @eN
npx monomind browse uncheck @eN
npx monomind browse scroll down 300                     # positional amount (shorthand)
npx monomind browse scroll down --amount 600            # scroll page
npx monomind browse scroll down --ref eN --amount 400   # scroll within element ref
npx monomind browse scroll down --selector ".sidebar" 300  # scroll within CSS selector
npx monomind browse scrollintoview @eN
npx monomind browse drag @eN @eM                 # drag source to target
npx monomind browse upload @eN ./file.pdf        # file input
npx monomind browse download @eN ./report.pdf   # click element, capture file download
npx monomind browse download ".export-btn" ./data.csv --timeout 15000
npx monomind browse highlight @eN               # visual debug highlight
```

### Low-Level Mouse

```bash
npx monomind browse mouse move 400 300
npx monomind browse mouse down --button left
npx monomind browse mouse down --button right
npx monomind browse mouse up
npx monomind browse mouse wheel 0 0 200          # x y deltaY [deltaX] — scroll down 200px
```

### Clipboard

```bash
npx monomind browse clipboard read
npx monomind browse clipboard write "paste me"
npx monomind browse clipboard copy    # copy selected text
npx monomind browse clipboard paste   # paste at focused element
```

### Wait & Assertions

```bash
npx monomind browse wait --text "Success"
npx monomind browse wait --not-text "Loading"
npx monomind browse wait --url "**/dashboard"
npx monomind browse wait --selector "#modal"
npx monomind browse wait --load networkidle
npx monomind browse wait --load load
npx monomind browse wait --load domcontentloaded
npx monomind browse wait --ms 500
npx monomind browse wait --fn "window.__ready === true"
npx monomind browse wait --text "Done" --timeout 10000
npx monomind browse wait --download ./report.pdf    # wait for browser-triggered download to complete
npx monomind browse wait --download ./data.csv --timeout 15000
```

### Element State Checks (Assertions)

```bash
npx monomind browse isvisible @e3          # true/false — is element visible?
npx monomind browse isenabled @e2          # true/false — is element enabled (not disabled)?
npx monomind browse ischecked @e1          # true/false — is checkbox/radio checked?

# Also accepts CSS selectors
npx monomind browse isvisible ".submit-btn"
npx monomind browse isenabled "#email-input"
npx monomind browse ischecked "input[name='agree']"

# JSON output for scripting
npx monomind browse isvisible @e4 --json   # → {"visible": true}
```

**Use in test scripts:**
```bash
# Run snapshot, then assert expected state
npx monomind browse snapshot -i
npx monomind browse click @e3             # click submit
npx monomind browse wait --text "Success"
npx monomind browse isvisible ".success-banner" --json
```

### Snapshot Regression Testing

```bash
# Save current snapshot as baseline
npx monomind browse snapshot -i --save ./baselines/homepage.txt

# Later: compare against baseline (colored diff: green=added, red=removed)
npx monomind browse snapshot -i --diff ./baselines/homepage.txt
# → Snapshot changed: +2 lines, -1 lines
# + button "Sign Out" [@e12]
# - button "Sign In" [@e8]

# JSON output
npx monomind browse snapshot -i --diff ./baselines/homepage.txt --json

# Content-safety flags (for agentic pipelines with untrusted pages)
npx monomind browse snapshot --content-boundaries          # wrap output in sentinel markers to prevent injection
npx monomind browse snapshot --max-output 10000            # truncate to 10k chars (prevents context blowout)
npx monomind browse snapshot --content-boundaries --max-output 8000  # both together

# Compare two URLs side-by-side (navigates to each, diffs their snapshots)
npx monomind browse diff url https://staging.example.com https://prod.example.com
npx monomind browse diff url https://app.com/v1 https://app.com/v2 --interactive
npx monomind browse diff url https://before.com https://after.com --json
```

### Mobile Testing (Touch Events)

```bash
# Tap with touch event — useful for mobile-emulated layouts
npx monomind browse tap @e4
npx monomind browse tap ".mobile-nav-toggle"

# Swipe gestures — 10-step smooth touchMove sequence
npx monomind browse swipe up                        # swipe up 300px from center
npx monomind browse swipe down 500                  # swipe down 500px
npx monomind browse swipe left --x 300 --y 400     # swipe left from (300,400)
npx monomind browse swipe right 200 --x 50 --y 300 # swipe right 200px

# Combine with device emulation
npx monomind browse set device "iPhone 14"
npx monomind browse snapshot -i
npx monomind browse tap @e2
npx monomind browse swipe up 400                    # scroll via swipe on mobile
```

### Screenshots & Visual Evidence

```bash
npx monomind browse screenshot before.png
npx monomind browse screenshot --full page.png             # full-page
npx monomind browse screenshot --annotate out.png          # overlay @eN numbered labels (requires prior snapshot -i)
npx monomind browse screenshot --hide-scrollbars clean.png # hide native scrollbars via CSS injection
npx monomind browse screenshot --format webp --quality 90 out.webp
npx monomind browse screenshot --json                      # returns path as JSON
npx monomind browse pdf ./output.pdf
npx monomind browse pdf --landscape ./report.pdf
```

**`--annotate` pattern:** always run `snapshot -i` first to populate refs, then `screenshot --annotate` to produce a screenshot with numbered labels at each element's position. Numbers match the `@eN` refs from the snapshot, so you can point to elements by number in bug reports.

> **Note:** `--annotate` uses viewport-relative coordinates — do not combine with `--full`. On full-page captures, badges will be misaligned below the fold.

```bash
npx monomind browse snapshot -i
npx monomind browse screenshot --annotate ./issue-001.png
# → labels [1] [2] [3]... appear at each interactive element
```

### Console, Errors & JavaScript

> **Console capture is always-on.** As soon as you `open` or `connect`, monobrowse hooks `Runtime.consoleAPICalled`, `Log.entryAdded`, and `Runtime.exceptionThrown` automatically. No `capture start` needed — messages accumulate in memory and `console`/`errors` read from that buffer at any time.

```bash
npx monomind browse console                      # all log/warn/error/info messages since connect
npx monomind browse console --errors-only        # filter to error level only
npx monomind browse console --clear              # reset the buffer
npx monomind browse console --json               # machine-readable [{type, text, timestamp}]
npx monomind browse errors                       # uncaught JS exceptions (Runtime.exceptionThrown)
npx monomind browse errors --json                # [{text, url, lineNumber, columnNumber, timestamp}]
npx monomind browse errors --clear

npx monomind browse eval "document.title"
npx monomind browse eval "document.querySelectorAll('button').length"
npx monomind browse eval "window.__store.getState()" --json
# Multiline JS via heredoc (--stdin reads from stdin)
cat <<'EOF' | npx monomind browse eval --stdin
  const items = document.querySelectorAll('li');
  JSON.stringify([...items].map(i => i.textContent.trim()))
EOF
npx monomind browse addinitscript "window.__TEST__ = true"   # runs on every page load
npx monomind browse removeinitscript <id>
```

### Network

```bash
# Route interception
npx monomind browse network route --pattern "https://api.*" --abort
npx monomind browse network route --pattern "*/graphql" --fulfill '{"data":{}}' --status 200
npx monomind browse network route --pattern "*.png" --abort
npx monomind browse network unroute                           # disable ALL interception (pattern arg is ignored)

# Extra headers for all requests
npx monomind browse network headers --headers '{"X-Test":"true"}'

# Request log
npx monomind browse network capture start
npx monomind browse network capture stop
npx monomind browse network capture clear
npx monomind browse network requests --json
npx monomind browse network requests --filter "api/users"            # filter by URL substring
npx monomind browse network requests --method POST                   # filter by HTTP method
npx monomind browse network requests --status-code 200               # filter by status code
npx monomind browse network requests --type xhr                      # filter by resource type
npx monomind browse network request <requestId>                      # full detail for one request
npx monomind browse network cookies             # cookies via network layer
```

### Tabs & Frames

```bash
npx monomind browse tab list
npx monomind browse tab new https://example.com
npx monomind browse tab <targetId>               # switch to tab by id
npx monomind browse tab close <targetId>
npx monomind browse frame @eN                    # switch into iframe
npx monomind browse frame main                   # back to main frame
```

### Dialogs

```bash
# Auto-accepted by default. Override:
npx monomind browse dialog accept
npx monomind browse dialog accept "confirm text"
npx monomind browse dialog dismiss
npx monomind browse dialog status
```

### Storage & Cookies

```bash
npx monomind browse storage local                        # list all entries
npx monomind browse storage local <key>                  # get a specific key
npx monomind browse storage local <key> --set "value"    # set a key
npx monomind browse storage local <key> --remove         # remove a key
npx monomind browse storage local --clear                # clear all
npx monomind browse storage session                      # list all session entries
npx monomind browse storage session <key>                # get session key
npx monomind browse cookies list
npx monomind browse cookies set --name token --value abc123
npx monomind browse cookies clear
```

### Device & Emulation

```bash
npx monomind browse set device "iPhone 14"
npx monomind browse set device "Galaxy S21"
npx monomind browse set device "iPad Pro"
npx monomind browse set media dark
npx monomind browse set media light
npx monomind browse set geo 37.7749 -122.4194
npx monomind browse set offline true
npx monomind browse set offline false
npx monomind browse set useragent "Mozilla/5.0 ..."
npx monomind browse set viewport 1440 900          # width height [deviceScaleFactor]
npx monomind browse set credentials user pass
```

### Session Persistence

```bash
npx monomind browse state save <name>
npx monomind browse state load <name>
npx monomind browse state list
npx monomind browse state show        # inspect current active session
npx monomind browse state clear       # clear current active session
npx monomind browse state rename <old> <new>           # rename a saved session
npx monomind browse state clean --older-than 7         # delete sessions older than N days (default: 7)
```

### Performance & Diagnostics

> **DevTools panel coverage:**
> ✅ Console panel — `console` / `errors` (always-on, see above)
> ✅ Network panel — `network requests` + filters, `network request <id>`, `har start/stop --bodies`
> ✅ Performance panel — `trace start/stop` (exports Chrome DevTools-compatible `.json`)
> ✅ Memory panel — `profiler heap ./heap.json` (heap snapshot)
> ✅ Application panel — `storage`, `cookies`
> ✅ Sources / JS eval — `eval`, `eval --stdin`, `addinitscript`
> ❌ Not available: source-map resolution for error stacks, live network waterfall, Lighthouse audit scores, Total Blocking Time metric

```bash
# Core Web Vitals (LCP < 2.5s PASS, 2.5–4s WARN, >4s FAIL)
npx monomind browse vitals --wait 3000 --json

# CPU profiler
npx monomind browse profiler start --interval 1000   # interval in microseconds (1000µs = 1ms)
npx monomind browse profiler stop --json

# Heap snapshot
npx monomind browse profiler heap ./heap.json

# Chrome trace (load in chrome://tracing or Perfetto)
npx monomind browse trace start --screenshots
npx monomind browse trace stop ./trace.json
npx monomind browse trace status

# HAR (full HTTP archive with request/response bodies)
npx monomind browse har start
npx monomind browse har status
npx monomind browse har stop --bodies --json   # --bodies only valid on stop

# Screen recording (frame sequence)
npx monomind browse record start --format jpeg --quality 80
npx monomind browse record status
npx monomind browse record stop --json
npx monomind browse record restart ./take2.mp4   # atomically stop+start (no page reload)
```

### Batch Execution

```bash
# Run multiple commands in one CDP session (fastest for scripted flows)
npx monomind browse batch "open https://app.com" "snapshot -i" "click @e3" "wait --text Done"
npx monomind browse batch --bail "open https://app.com" "click @e3"   # stop on first error
# Note: --json stdin pipe flag is declared but not implemented; use positional args only
```

---

## Common QA Patterns

### Login / Auth Flow

```bash
npx monomind browse open <login-url>
npx monomind browse snapshot -i
npx monomind browse fill @e1 "user@test.com"
npx monomind browse fill @e2 "TestPass123!"
npx monomind browse click @e3
npx monomind browse wait --url "**/dashboard" --timeout 8000
npx monomind browse errors
npx monomind browse screenshot post-login.png
```

### Form with Validation

```bash
npx monomind browse open <form-url>
npx monomind browse snapshot -i
# Happy path
npx monomind browse fill @e1 "John Doe"
npx monomind browse fill @e2 "john@test.com"
npx monomind browse select @e3 "Option A"
npx monomind browse check @e4
npx monomind browse click @e5
npx monomind browse wait --text "submitted"
npx monomind browse screenshot form-success.png
# Validation
npx monomind browse navigate back
npx monomind browse click @e5                    # submit empty
npx monomind browse snapshot -i                  # should show errors
```

### Multi-Step Wizard

```bash
npx monomind browse open <wizard-url>
npx monomind browse snapshot -i
npx monomind browse fill @e1 "value"
npx monomind browse click @e2
npx monomind browse wait --text "Step 2"
npx monomind browse snapshot -i
npx monomind browse select @e3 "choice"
npx monomind browse click @e4
npx monomind browse wait --text "Complete"
npx monomind browse screenshot wizard-complete.png
```

### CRUD Operations

```bash
# Create
npx monomind browse click @new_btn
npx monomind browse fill @name_field "New Item"
npx monomind browse click @save_btn
npx monomind browse wait --text "New Item"
# Update
npx monomind browse find text "Edit" click
npx monomind browse fill @name_field "Updated Item"
npx monomind browse click @save_btn
npx monomind browse wait --text "Updated Item"
# Delete
npx monomind browse find text "Delete" click
npx monomind browse wait --text "Are you sure"
npx monomind browse click @confirm_btn
npx monomind browse wait --load networkidle
```

### API Mock Testing

```bash
# Intercept API, return controlled data
npx monomind browse network route --pattern "*/api/users" --fulfill '{"users":[]}' --status 200
npx monomind browse open <url>
npx monomind browse snapshot -i           # should show empty state UI
npx monomind browse screenshot empty-state.png
# Intercept with error
npx monomind browse network route --pattern "*/api/users" --fulfill '{"error":"forbidden"}' --status 403
npx monomind browse navigate reload
npx monomind browse snapshot -i           # should show error state
```

---

## Dogfood / Exploratory QA Mode

When asked to "dogfood", "QA", "find bugs", "exploratory test", or "bug hunt" a web app:

### Setup

```bash
mkdir -p ./dogfood-output/screenshots ./dogfood-output/videos
```

### Workflow

```
1. Orient    → open URL, initial annotated screenshot, snapshot -i
2. Explore   → visit each major section, test interactive elements
3. Document  → screenshot + record for each issue found (as you go, not at end)
4. Wrap up   → re-check console errors, write summary
```

### At each page

```bash
npx monomind browse snapshot -i                                              # find interactive elements
npx monomind browse screenshot --annotate ./dogfood-output/screenshots/<page>.png  # annotated overview
npx monomind browse errors                                                   # check for JS errors
npx monomind browse console                                                  # check console output
```

### Documenting an issue (repro-first)

For **interactive/behavioral bugs** (require clicking or typing to reproduce):

```bash
# 1. Start recording before reproducing
npx monomind browse record start
# 2. Walk through the steps (use type not fill during recording — shows keystrokes)
npx monomind browse screenshot ./dogfood-output/screenshots/issue-001-step1.png
npx monomind browse type @eN "input value"
npx monomind browse click @eM
npx monomind browse screenshot --annotate ./dogfood-output/screenshots/issue-001-result.png
# 3. Stop recording
npx monomind browse record stop --json   # returns path to frames JSON
```

For **static/visible-on-load bugs** (typos, layout, placeholder text):

```bash
npx monomind browse screenshot --annotate ./dogfood-output/screenshots/issue-001.png
# Single annotated screenshot is sufficient — no recording needed
```

### `type` vs `fill` during recording

Use `type` (character-by-character) when recording a video so keystrokes are visible in the recording. Use `fill` (instant clear + set) for speed outside recording.

### Reporting

Aim for 5–10 well-documented issues. Depth of evidence (annotated screenshots, step-by-step repro) beats quantity. Append each issue as you find it — never batch for the end.

---

## Task Walkthrough Mode

When helping a user accomplish a task in a live UI:

1. Ask for the URL if not provided
2. `open` + `snapshot -i` — describe what's on screen (title, sections, available actions)
3. Propose the steps to accomplish the task
4. Execute step by step, narrating each action and what changed
5. Confirm completion with a screenshot

```bash
npx monomind browse open https://app.example.com
npx monomind browse snapshot -i
# → "I see: navbar with 'New Project' @e3, project list below with 2 items"
npx monomind browse click @e3
npx monomind browse snapshot -i
# → "Modal opened: Name field @e8, Template selector @e9, Create @e11"
npx monomind browse fill @e8 "My Project"
npx monomind browse click @e11
npx monomind browse wait --text "My Project"
npx monomind browse screenshot created.png
# → "Project created — visible in list"
```

---

## QA Report Format

After every test session output a structured report:

```
## QA Report — <url> — <date>

### Summary
- Pages tested: N
- Total checks: N
- PASS: N  WARN: N  FAIL: N

### Results

PASS  Login flow completes and redirects to /dashboard
PASS  Form validation shows errors on empty submit
WARN  LCP = 3.2s (threshold: 2.5s) — images not lazy-loaded
FAIL  Delete confirmation dialog blocks further automation — avoid triggering
FAIL  Mobile layout: navigation overflows viewport at 375px

### JS Errors
<list from `npx monomind browse errors`>

### Performance
LCP: Xs  CLS: X  FCP: Xs  TTFB: Xms

### Screenshots
- before-action.png
- after-action.png
- mobile-portrait.png
```

---

## Memory Integration

```bash
# Store successful test patterns after a passing run
npx monomind memory store \
  --namespace ui-testing \
  --key "login-flow-<app-name>" \
  --value "open→snapshot -i→fill @e1 email→fill @e2 pass→click @e3→wait dashboard"

# Retrieve before re-testing the same app
npx monomind memory search --query "login flow" --namespace ui-testing
```

---

## Electron App Automation

Automate any Electron desktop app (VS Code, Slack, Discord, Figma, Notion, Spotify) via CDP — same snapshot-interact workflow as for web pages.

### Launch with CDP port

```bash
# macOS — quit the app first if already running
open -a "Slack"   --args --remote-debugging-port=9222
open -a "Visual Studio Code" --args --remote-debugging-port=9223
open -a "Discord" --args --remote-debugging-port=9224
open -a "Figma"   --args --remote-debugging-port=9225
open -a "Notion"  --args --remote-debugging-port=9226

# Linux
slack --remote-debugging-port=9222
code  --remote-debugging-port=9223

# Windows
"C:\...\slack.exe" --remote-debugging-port=9222
```

### Connect and interact

```bash
# Connect to a specific port
npx monomind browse connect --port 9222

# Auto-discover any running Chromium-based app on ports 9222 or 9229
npx monomind browse connect --auto-connect

# Standard workflow from here
npx monomind browse snapshot -i
npx monomind browse click @e5
npx monomind browse screenshot --annotate slack-desktop.png
```

`--auto-connect` probes ports 9222 and 9229 in order and connects to the first responding Chrome/Electron instance.

### Tab and webview management

Electron apps often have multiple windows or embedded webviews:

```bash
npx monomind browse tab                  # list all tabs/webviews (shows targetId for each)
npx monomind browse tab <targetId>       # switch to tab by its targetId
npx monomind browse tab new              # open a new tab
```

---

## Activation Checklist

When this skill fires:
- [ ] Get the URL (ask if not provided — or use `--auto-connect` for Electron apps)
- [ ] Run `open` + `errors` baseline
- [ ] Run all 7 QA phases (or subset the user requested)
- [ ] Screenshot key states: initial, post-action, errors, mobile
- [ ] Run `vitals` for any performance claim
- [ ] Output structured QA report with PASS/WARN/FAIL
- [ ] Store patterns in memory if the flow was new and successful

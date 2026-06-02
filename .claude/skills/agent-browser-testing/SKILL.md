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
npx monomind browse find role link --nth 2        # nth match
npx monomind browse find role image --last         # last match
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
npx monomind browse scroll down --ref eN --amount 400   # scroll within element
npx monomind browse scroll down --amount 600            # scroll page
npx monomind browse scrollintoview @eN
npx monomind browse drag @eN @eM                 # drag source to target
npx monomind browse upload @eN ./file.pdf        # file input
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
```

### Screenshots & Visual Evidence

```bash
npx monomind browse screenshot before.png
npx monomind browse screenshot --full page.png   # full-page
npx monomind browse screenshot --format webp --quality 90 out.webp
npx monomind browse screenshot --json            # returns path
npx monomind browse pdf ./output.pdf
npx monomind browse pdf --landscape ./report.pdf
```

### Console, Errors & JavaScript

```bash
npx monomind browse console                      # all console messages
npx monomind browse console --clear              # clear console history
npx monomind browse console --errors-only        # only error-level messages
npx monomind browse errors                       # JS exceptions only
npx monomind browse errors --clear              # clear exception history
npx monomind browse errors --json               # machine-readable output
npx monomind browse eval "document.title"
npx monomind browse eval "document.querySelectorAll('button').length"
npx monomind browse eval "window.__store.getState()" --json
npx monomind browse addinitscript "window.__TEST__ = true"
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
```

### Performance & Diagnostics

```bash
# Core Web Vitals
npx monomind browse vitals --wait 3000 --json

# CPU profiler
npx monomind browse profiler start --interval 1000   # interval in microseconds (1000µs = 1ms)
npx monomind browse profiler stop --json

# Heap snapshot
npx monomind browse profiler heap ./heap.json

# Chrome trace
npx monomind browse trace start --screenshots
npx monomind browse trace stop ./trace.json

# HAR (full HTTP archive with bodies)
npx monomind browse har start
npx monomind browse har status
npx monomind browse har stop --bodies --json   # --bodies only valid on stop

# Screen recording (frame sequence)
npx monomind browse record start --format jpeg --quality 80
npx monomind browse record status
npx monomind browse record stop --json

# Trace status
npx monomind browse trace status
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

## Activation Checklist

When this skill fires:
- [ ] Get the URL (ask if not provided)
- [ ] Run `open` + `errors` baseline
- [ ] Run all 7 QA phases (or subset the user requested)
- [ ] Screenshot key states: initial, post-action, errors, mobile
- [ ] Run `vitals` for any performance claim
- [ ] Output structured QA report with PASS/WARN/FAIL
- [ ] Store patterns in memory if the flow was new and successful

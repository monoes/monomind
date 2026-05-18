---
name: agent-browser-testing
description: UI testing and task walkthrough using the native monomind browse command — navigate, test golden paths, report issues, and help users accomplish tasks through any web UI.
version: 3.0.0
triggers:
  - /ui-test
  - /browse
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
  - submit the form
tools:
  - Bash
---

# UI Testing with monomind browse

Automated UI testing and guided task walkthroughs using the native `monomind browse` command (TypeScript CDP client, no external binary required).

## Core Testing Workflow

Every UI test follows this loop:

```
OPEN → SNAPSHOT → ACT → SNAPSHOT → VERIFY → REPEAT
```

```bash
# 1. Open the target UI
npx monomind browse open <url>

# 2. Get interactive elements (93% less context than full DOM)
npx monomind browse snapshot -i

# 3. Act using element refs from snapshot output
npx monomind browse click @e1        # click by ref
npx monomind browse fill @e2 "value" # fill input by ref
npx monomind browse press Enter       # keyboard actions

# 4. Re-snapshot to see result
npx monomind browse snapshot -i

# 5. Verify expected state
npx monomind browse get text @e5          # read element text
npx monomind browse get url               # check URL changed
npx monomind browse wait --text "Success" # wait for expected text
npx monomind browse errors                # check for JS errors
```

## Test Phases

### Phase 1 — Discovery
```bash
npx monomind browse open <url>
npx monomind browse snapshot       # full tree to understand structure
npx monomind browse get title
npx monomind browse get url
```

### Phase 2 — Golden Path Testing
```bash
# Example: Login flow
npx monomind browse open https://app.example.com/login
npx monomind browse snapshot -i
# Identify: email input @e1, password @e2, submit @e3
npx monomind browse fill @e1 "test@example.com"
npx monomind browse fill @e2 "password123"
npx monomind browse click @e3
npx monomind browse wait --url "**/dashboard"
npx monomind browse snapshot -i
# Verify dashboard loaded
```

### Phase 3 — Edge Case Testing
```bash
# Empty form submission
npx monomind browse click @e3              # submit with empty fields
npx monomind browse wait --text "required" # expect validation error
npx monomind browse snapshot -i

# Invalid input
npx monomind browse fill @e1 "not-an-email"
npx monomind browse click @e3
npx monomind browse snapshot -i

# Check element states
npx monomind browse is visible @e5
npx monomind browse is enabled @e3
npx monomind browse is checked @e7
```

### Phase 4 — Navigation & Accessibility
```bash
# Tab through all focusable elements
npx monomind browse press Tab
npx monomind browse snapshot -i

# Check all links work
npx monomind browse find role link

# Check page at mobile width
npx monomind browse set device "iPhone 14"
npx monomind browse snapshot -i

# Check dark mode
npx monomind browse set media dark
npx monomind browse screenshot dark-mode.png
```

### Phase 5 — Report Issues
After testing, summarize:
```
PASS: <what worked>
FAIL: <what broke> — steps to reproduce
WARN: <what looks odd but didn't break>
```

## Common Test Patterns

### Login / Auth
```bash
npx monomind browse open <login-url>
npx monomind browse snapshot -i
npx monomind browse fill @e1 "user@test.com"
npx monomind browse fill @e2 "TestPass123!"
npx monomind browse click @e3
npx monomind browse wait --url "**/dashboard" --timeout 5000
npx monomind browse errors
```

### Form Submission
```bash
npx monomind browse open <form-url>
npx monomind browse snapshot -i
npx monomind browse fill @e1 "John Doe"
npx monomind browse fill @e2 "john@test.com"
npx monomind browse select @e3 "Option A"
npx monomind browse check @e4
npx monomind browse click @e5
npx monomind browse wait --text "submitted"
npx monomind browse screenshot test-result.png
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

npx monomind browse snapshot -i
npx monomind browse get text @e5
npx monomind browse click @e6
npx monomind browse wait --text "Complete"
```

### CRUD Operations
```bash
# Create
npx monomind browse click @e1
npx monomind browse fill @e2 "New Item"
npx monomind browse click @e3
npx monomind browse wait --text "New Item"

# Update
npx monomind browse find text "Edit" click
npx monomind browse fill @e2 "Updated Item"
npx monomind browse click @e3

# Delete
npx monomind browse find text "Delete" click
npx monomind browse wait --text "Are you sure"
npx monomind browse click @e4
npx monomind browse wait --load networkidle
```

## Selectors Reference

Prefer element refs from snapshots — they're deterministic:
```bash
npx monomind browse snapshot -i
# Output: button "Submit" [@e4]
npx monomind browse click @e4
```

Semantic locators (no CSS needed):
```bash
npx monomind browse find role button click --name "Submit"
npx monomind browse find label "Email" fill "test@example.com"
npx monomind browse find text "Delete" click
npx monomind browse find testid "submit-btn" click
```

## Task Walkthrough Mode

When helping a user accomplish a task in a UI:

1. **Ask for the URL** if not provided
2. **Open and snapshot** to understand what's on screen
3. **Describe what you see** — page title, main sections, available actions
4. **Propose the steps** to accomplish the task
5. **Execute step by step**, narrating each action
6. **Confirm completion** — show what changed

```bash
npx monomind browse open https://app.example.com
npx monomind browse snapshot -i
# → "I can see: navbar with 'New Project' button at @e3, project list below"
npx monomind browse click @e3
npx monomind browse snapshot -i
# → "Modal opened with: Name field @e8, Template selector @e9, Create button @e11"
npx monomind browse fill @e8 "My New Project"
npx monomind browse click @e11
npx monomind browse wait --text "My New Project"
# → "Project created successfully — it now appears in your project list"
```

## Screenshot & Evidence

```bash
npx monomind browse screenshot before-action.png
npx monomind browse click @e1
npx monomind browse screenshot after-action.png

# Full page screenshot
npx monomind browse screenshot --full full-page.png
```

## Advanced Capabilities

```bash
# Console & error monitoring
npx monomind browse console
npx monomind browse errors

# Network interception
npx monomind browse network route --pattern "https://api.*" --abort

# Device emulation
npx monomind browse set device "iPhone 14"
npx monomind browse set device "Galaxy S21"

# Session persistence
npx monomind browse state save my-session
npx monomind browse open <url> --session my-session

# Drag and drop
npx monomind browse drag @e1 @e2

# File upload
npx monomind browse upload @e1 ./test-file.pdf

# Cookie management
npx monomind browse cookies list
npx monomind browse cookies set --name token --value abc123

# PDF export
npx monomind browse pdf ./output.pdf

# Batch execution
npx monomind browse batch "open https://app.com" "snapshot -i" "click @e3"
```

## Integration with Monomind Memory

```bash
# Store successful test patterns
npx monomind memory store \
  --namespace ui-testing \
  --key "login-flow-<app-name>" \
  --value "open→snapshot -i→fill @e1 email→fill @e2 pass→click @e3→wait dashboard"

# Retrieve before re-testing
npx monomind memory search --query "login flow" --namespace ui-testing
```

## Activation Checklist

When this skill is triggered:
- [ ] Get the URL to test (ask user if not provided)
- [ ] Run `npx monomind browse open <url>` then `snapshot -i`
- [ ] Identify the task or flow to test/accomplish
- [ ] Execute the flow step by step
- [ ] Run `npx monomind browse errors` to check for JS failures
- [ ] Report results (pass/fail/warnings)
- [ ] Take screenshots of key states
- [ ] Store successful patterns in memory for reuse

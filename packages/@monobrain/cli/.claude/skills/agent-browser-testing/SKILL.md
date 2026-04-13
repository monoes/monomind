---
name: agent-browser-testing
description: UI testing and task walkthrough using agent-browser — install, navigate, test golden paths, report issues, and help users accomplish tasks through any web UI
version: 1.0.0
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
requires:
  - agent-browser >= 0.25.4
---

# UI Testing with agent-browser

Automated UI testing and guided task walkthroughs using `agent-browser`. Use this skill whenever a system's UI needs to be tested, explored, or used to accomplish a task.

## Setup (Run Once)

```bash
# Install or upgrade agent-browser
npm install -g agent-browser

# Verify install
agent-browser --version
```

## Core Testing Workflow

Every UI test follows this loop:

```
OPEN → SNAPSHOT → ACT → SNAPSHOT → VERIFY → REPEAT
```

```bash
# 1. Open the target UI
agent-browser open <url>

# 2. Get interactive elements (93% less context than full DOM)
agent-browser snapshot -i

# 3. Act using element refs from snapshot output
agent-browser click @e1        # click by ref
agent-browser fill @e2 "value" # fill input by ref
agent-browser press Enter       # keyboard actions

# 4. Re-snapshot to see result
agent-browser snapshot -i

# 5. Verify expected state
agent-browser get text @e5      # read content
agent-browser get url           # check URL changed
agent-browser wait --text "Success"  # wait for expected text
```

## Test Phases

### Phase 1 — Discovery
```bash
agent-browser open <url>
agent-browser snapshot          # full tree to understand structure
agent-browser get title
agent-browser get url
```

### Phase 2 — Golden Path Testing
Test the main happy-path flows a user would take:

```bash
# Example: Login flow
agent-browser open https://app.example.com/login
agent-browser snapshot -i
# Identify: email input @e1, password @e2, submit @e3
agent-browser fill @e1 "test@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser snapshot -i
# Verify dashboard loaded
```

### Phase 3 — Edge Case Testing
```bash
# Empty form submission
agent-browser click @e3              # submit with empty fields
agent-browser wait --text "required" # expect validation error
agent-browser snapshot -i

# Invalid input
agent-browser fill @e1 "not-an-email"
agent-browser click @e3
agent-browser snapshot -i

# Boundary values
agent-browser fill @e1 ""           # empty
agent-browser fill @e1 "a".repeat(256)  # too long (via JS)
```

### Phase 4 — Navigation & Accessibility
```bash
# Tab through all focusable elements
agent-browser press Tab
agent-browser snapshot -i
agent-browser press Tab
# ... repeat checking focus state

# Check all links work
agent-browser find role link
agent-browser snapshot -i

# Check page at mobile width
agent-browser resize 375 812
agent-browser snapshot -i
```

### Phase 5 — Report Issues
After testing, summarize:
```
✅ PASS: <what worked>
❌ FAIL: <what broke> — steps to reproduce
⚠️  WARN: <what looks odd but didn't break>
```

## Common Test Patterns

### Login / Auth
```bash
agent-browser open <login-url>
agent-browser snapshot -i
agent-browser fill @e[email-input] "user@test.com"
agent-browser fill @e[password-input] "TestPass123!"
agent-browser click @e[submit-button]
agent-browser wait --url "**/dashboard" --timeout 5000
```

### Form Submission
```bash
agent-browser open <form-url>
agent-browser snapshot -i
# Fill all required fields using refs from snapshot
agent-browser fill @e1 "John Doe"
agent-browser fill @e2 "john@test.com"
agent-browser select @e3 "Option A"
agent-browser check @e4              # checkbox
agent-browser click @e5              # submit
agent-browser wait --text "submitted"
agent-browser screenshot test-result.png
```

### Multi-Step Wizard
```bash
# Step 1
agent-browser open <wizard-url>
agent-browser snapshot -i
agent-browser fill @e1 "value"
agent-browser click @e[next]
agent-browser wait --text "Step 2"

# Step 2
agent-browser snapshot -i
agent-browser select @e2 "choice"
agent-browser click @e[next]

# Final step — verify summary
agent-browser snapshot -i
agent-browser get text @e[summary]
agent-browser click @e[confirm]
agent-browser wait --text "Complete"
```

### CRUD Operations
```bash
# Create
agent-browser click @e[add-button]
agent-browser fill @e[name-field] "New Item"
agent-browser click @e[save]
agent-browser wait --text "New Item"  # appears in list

# Read
agent-browser get text @e[item-name]

# Update
agent-browser click @e[edit-button]
agent-browser fill @e[name-field] "Updated Item"
agent-browser click @e[save]

# Delete
agent-browser click @e[delete-button]
agent-browser wait --text "Are you sure"
agent-browser click @e[confirm-delete]
agent-browser wait --not-text "Updated Item"
```

### API + UI Combination
```bash
# Trigger action via UI, verify via snapshot
agent-browser click @e[send-button]
agent-browser wait --text "Sent" --timeout 10000
agent-browser screenshot after-send.png
```

## Selectors Reference

Prefer element refs from snapshots — they're deterministic:
```bash
agent-browser snapshot -i
# Output: button "Submit" [ref=e4]
agent-browser click @e4  # use the ref
```

Fallback selectors:
```bash
agent-browser click "#submit-btn"           # CSS id
agent-browser fill ".email-input" "test"    # CSS class
agent-browser find role button click --name "Submit"   # ARIA role
agent-browser find label "Email" fill "test"           # label text
agent-browser find testid "submit-btn" click           # data-testid
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
# Example: "Help me create a new project in the app"
agent-browser open https://app.example.com
agent-browser snapshot -i
# → "I can see: navbar with 'New Project' button at @e3, project list below"
agent-browser click @e3
agent-browser snapshot -i
# → "Modal opened with: Name field @e8, Template selector @e9, Create button @e11"
agent-browser fill @e8 "My New Project"
agent-browser click @e11
agent-browser wait --text "My New Project"
# → "Project created successfully — it now appears in your project list"
```

## Screenshot & Evidence

Always capture screenshots for test reports:
```bash
agent-browser screenshot before-action.png  # before
agent-browser click @e[action]
agent-browser screenshot after-action.png   # after

# Full page screenshot
agent-browser screenshot --full full-page.png
```

## Integration with Monobrain

### Store test patterns in memory
```bash
npx monobrain memory store \
  --namespace ui-testing \
  --key "login-flow-<app-name>" \
  --value "open→snapshot→fill @email →fill @password →click @submit →wait dashboard"
```

### Retrieve before re-testing
```bash
npx monobrain memory search --query "login flow" --namespace ui-testing
```

### Report issues as tasks
```bash
npx monobrain task create --title "UI Bug: form submits with empty email" \
  --description "Steps: open /login, click submit without filling email — no validation shown"
```

## Activation Checklist

When this skill is triggered:
- [ ] Confirm `agent-browser` is installed (`agent-browser --version`)
- [ ] Get the URL to test (ask user if not provided)
- [ ] Open the URL and take initial snapshot
- [ ] Identify the task or flow to test/accomplish
- [ ] Execute the flow step by step
- [ ] Report results (pass/fail/warnings)
- [ ] Take screenshots of key states
- [ ] Store successful patterns in memory for reuse

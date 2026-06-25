---
name: monomind:browse-qa
description: Systematic exploratory testing of a web application to find bugs, UX issues, and quality problems. Use when asked to dogfood, QA, exploratory test, find issues, bug hunt, or review the quality of a web app. Produces a structured report with full reproduction evidence — step-by-step screenshots, repro steps, and severity ratings for every finding.
version: 1.0.0
triggers:
  - dogfood
  - qa this app
  - find bugs
  - exploratory test
  - bug hunt
  - test this site
  - quality review
  - ux review
  - find issues
  - systematic test
tools:
  - Bash
requires:
  - monomind >= 1.0.0
---


# Systematic QA / Dogfood Testing (monomind:browse-qa)

Systematically explore a web application, find issues, and produce a report with full reproduction evidence for every finding.

See `monomind:browse` for the full browser automation reference.

## Inputs

| Parameter | Default | Example override |
|---|---|---|
| **Target URL** | _(required)_ | `vercel.com`, `http://localhost:3000` |
| **Session name** | Slugified domain | `my-qa-session` |
| **Output directory** | `./qa-output/` | `/tmp/qa` |
| **Scope** | Full app | `Focus on the billing page` |
| **Authentication** | None | `Sign in as user@example.com` |

Start immediately with defaults. Only ask if authentication is mentioned but credentials are missing.

Always call `monomind browse` directly — using `npx monomind browse`. It uses the native TypeScript CDP client.

## Workflow

```
1. Initialize    → Set up session, output dirs, report file
2. Authenticate  → Sign in if needed, save state
3. Orient        → Navigate to starting point, initial snapshot
4. Explore       → Systematically visit pages and test features
5. Document      → Screenshot + record each issue as found
6. Wrap up       → Summary counts, close session
```

### 1. Initialize

```bash
mkdir -p ./qa-output/screenshots
SESSION="$(echo '<TARGET_URL>' | sed 's|https\?://||; s|/.*||; s|\.|-|g')"
npx monomind browse --session "$SESSION" open <TARGET_URL>
npx monomind browse --session "$SESSION" wait --load networkidle
```

### 2. Authenticate (if needed)

```bash
npx monomind browse --session "$SESSION" snapshot -i
npx monomind browse --session "$SESSION" fill @e1 "<EMAIL>"
npx monomind browse --session "$SESSION" fill @e2 "<PASSWORD>"
npx monomind browse --session "$SESSION" click @e3
npx monomind browse --session "$SESSION" wait --load networkidle

# Save auth state for reuse
npx monomind browse --session "$SESSION" state save ./qa-output/auth-state.json
```

For OTP/email codes: ask the user, wait for input, then enter the code.

### 3. Orient

```bash
npx monomind browse --session "$SESSION" screenshot --annotate ./qa-output/screenshots/00-initial.png
npx monomind browse --session "$SESSION" snapshot -i
npx monomind browse --session "$SESSION" get title
npx monomind browse --session "$SESSION" get url
```

Document the starting state: what is visible, main navigation elements, key actions available.

### 4. Explore

For each area/page:

```bash
npx monomind browse --session "$SESSION" click @e[nav-item]
npx monomind browse --session "$SESSION" wait --load networkidle
npx monomind browse --session "$SESSION" snapshot -i
npx monomind browse --session "$SESSION" screenshot ./qa-output/screenshots/<page-name>.png
```

**Test systematically:**
- Navigation: does every link work? Does back/forward work?
- Forms: submit empty, submit invalid, submit valid
- Interactive elements: hover states, click states, disabled states
- Responsive: `monomind browse set viewport 375 812` (mobile), `1280 720` (desktop)
- Error states: what happens when APIs fail? Use `network route` to simulate failures
- Loading states: `wait --load networkidle` then check if spinners resolve

### 5. Document Each Issue

For every issue found:

```bash
# 1. Screenshot the broken state
npx monomind browse --session "$SESSION" screenshot ./qa-output/screenshots/bug-<N>-<name>.png

# 2. Record reproduction steps in report
```

Issue format:
```
## Issue N: <short title>

**Severity:** Critical / High / Medium / Low
**URL:** <current URL>
**Steps to reproduce:**
1. <step>
2. <step>
**Expected:** <what should happen>
**Actual:** <what happened>
**Screenshot:** screenshots/bug-N-name.png
```

### 6. Wrap Up

```bash
npx monomind browse --session "$SESSION" close
```

Print summary:
```
QA SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━
Target:  <URL>
Pages:   <N> tested
Issues:  Critical=<N> High=<N> Medium=<N> Low=<N>
Output:  ./qa-output/
```

## Severity Guide

| Level | Description | Example |
|---|---|---|
| Critical | Blocks core user flow | Login broken, payment fails |
| High | Major feature broken | Form won't submit, page 404 |
| Medium | Degraded experience | Wrong error message, slow load |
| Low | Polish / cosmetic | Alignment off, typo |

## Testing Checklist

**Navigation:**
- [ ] All nav links work
- [ ] Breadcrumbs correct
- [ ] Back/forward work
- [ ] No broken links (`get url` shows expected path)

**Forms:**
- [ ] Empty submit → validation errors shown
- [ ] Invalid data → appropriate error
- [ ] Valid data → success state
- [ ] Required field indicators visible

**Interactive:**
- [ ] All buttons clickable (check `is enabled`)
- [ ] Dropdowns open and close
- [ ] Modals open and close
- [ ] Tooltips appear on hover

**Responsive:**
- [ ] Mobile (375×812): `monomind browse set viewport 375 812`
- [ ] Tablet (768×1024): `monomind browse set viewport 768 1024`
- [ ] Desktop (1280×720): `monomind browse set viewport 1280 720`

**Error states:**
- [ ] Network error: `monomind browse network route "https://api.*" --abort`
- [ ] Empty state: check when lists/tables have no data
- [ ] 404 page: navigate to `/nonexistent-path`

**Accessibility:**
- [ ] Tab order logical (press Tab through all elements)
- [ ] All inputs have labels (visible in snapshot)
- [ ] Buttons have accessible names

## API Error Simulation

```bash
# Block all API calls to test error handling
npx monomind browse batch \
  '["open"]' \
  '["network", "route", "https://api.example.com/*", "--abort"]' \
  '["navigate", "https://app.example.com/dashboard"]'
npx monomind browse snapshot -i
# → Verify error states render correctly
```

## Diff Regression Testing

```bash
# Baseline
npx monomind browse open https://app.example.com && monomind browse snapshot -i > ./qa-output/baseline.txt

# After change
npx monomind browse open https://app.example.com && monomind browse diff snapshot --baseline ./qa-output/baseline.txt
```

## Monomind Integration

```bash
# Create tasks for critical bugs
npx monomind task create \
  --title "CRITICAL: <issue title>" \
  --description "Steps: <repro steps>. Screenshot: ./qa-output/screenshots/bug-N.png"

# Store QA session patterns for reuse
npx monomind memory store \
  --namespace browse \
  --key "qa-flow-<app>" \
  --value "open → wait networkidle → screenshot → systematically test nav/forms/responsive"
```

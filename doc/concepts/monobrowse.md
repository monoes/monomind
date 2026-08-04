# Monobrowse Subsystem (`@monoes/monobrowse`)

> **Monomind v2.8.x** · `@monoes/monobrowse` v1.0.6 · MIT  
> Lightweight browser automation powered directly by the **Chrome DevTools Protocol (CDP)** over WebSockets. Designed specifically for AI agents, omitting the weight of Puppeteer or Playwright.

---

## 1. Why Monobrowse?

AI agents require robust browser interaction (navigation, visual inspection, form filling, and JavaScript evaluation). Traditional frameworks like Puppeteer or Playwright download 50+ MB binaries and introduce complex version-pinning requirements.

Monobrowse connects directly to Chrome/Chromium using the native Chrome DevTools Protocol (CDP) over WebSockets. This provides a zero-dependency, low-overhead browser automation layer that meets all agent needs with minimal package weight.

```
AI Agent / CLI
      │
      ▼  monomind browse <subcommand>
@monoes/monobrowse
      │
      ├── CDP Client (cdp.ts) ──► WebSocket ──► Real Chrome (headed or headless)
      │
      ├── Element References (@e1, @e2, ...)
      ├── Accessibility (AX) Trees
      └── Auto-Headed Login Redirection (Login/CAPTCHA wall detection)
```

---

## 2. Key Architecture & Features

### 2.1 Ref-Based Accessibility Model
Monobrowse converts the browser's Accessibility Tree (AX Tree) into a token-efficient text snapshot:
- Elements are tagged with short references like `@e1`, `@e2`, `@e3`.
- The in-memory references are written to a localized disk cache (`ref-cache.ts`) so subsequent CLI invocations can interact with elements using these tokens (e.g., `monomind browse click @e3`).
- **Interactive-Only Filtering:** Reduces the tokens needed by 93% by omitting non-interactive layout nodes.
- **Safety boundaries:** Snapshot output can be wrapped in cryptographic sentinels to prevent page-content prompt injection attacks.

### 2.2 Headless-to-Headed Redirection
When running in headless mode, Monobrowse automatically monitors the page URL and DOM contents for login pages and CAPTCHA walls:
- If a password field, ReCAPTCHA iframe, or login path is encountered, Monobrowse snapshots the cookies.
- It closes the headless process and spawns a visible (headed) browser.
- Once the user completes the login or bypasses the CAPTCHA, they press Enter in the terminal.
- Monobrowse grabs the authenticated cookies and localStorage, shuts down the headed browser, and restores the session in a fresh headless window.

### 2.3 Dashboard Server
Includes an embedded dashboard (`browser/dashboard/server.js`) that hosts a live view of the browser's DOM, network logs, and console output.

---

## 3. Package Structure & Exports

Located at `packages/@monoes/monobrowse/`.

- **`src/cdp.ts`**: Pure WebSocket-based CDP client implementation.
- **`src/browser.ts`**: Browser process launcher, PID management, and automatic port scanning.
- **`src/snapshot.ts`**: Accessibility Tree extraction and reference labeling.
- **`src/actions.ts`**: Interaction primitives (clicking, form filling, typing, hover, focus).
- **`src/cli/commands.ts`**: Complete implementation of the 50+ subcommands.

### Package Exports
```json
{
  "exports": {
    ".": {
      "types": "./dist/src/index.d.ts",
      "import": "./dist/src/index.js"
    },
    "./cli": {
      "types": "./dist/src/cli.d.ts",
      "import": "./dist/src/cli.js"
    }
  }
}
```

---

## 4. Platform Integration Points

| Integration | Location | Description |
|---|---|---|
| **CLI command** | `packages/@monomind/cli/src/commands/index.ts` | Registered as `monomind browse` |
| **Monodesign** | `@monoes/monodesign/cli/engine/` | Optional Puppeteer dependency fallback for live visual audits |
| **Active Port Cache** | `ref-cache.ts` | Persists debug port to ensure multiple CLI calls connect to the same browser instance |

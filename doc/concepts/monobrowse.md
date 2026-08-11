# Monobrowse Subsystem (`@monoes/monobrowse`)

> **Monomind v2.9.0** · `@monoes/monobrowse` v1.0.6 · MIT  
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

---

## 5. Recovery — if a command hangs or Chrome is left running

CLAUDE.md mandates `monomind browse` over Playwright/Puppeteer with no exceptions. That mandate now has a real fallback path instead of none:

- **A command that hangs on an unresponsive page** no longer hangs forever — every CDP command sent via `CdpClient.send()` times out after 30s by default (`DEFAULT_CDP_SEND_TIMEOUT_MS` in `cdp.ts`), and a `Target.targetCrashed`/`Target.targetDestroyed` event flushes all in-flight commands immediately rather than waiting out the timeout. If a command still appears stuck past ~30s, it will resolve with a timeout error on its own — just wait, or Ctrl-C.
- **Ctrl-C / SIGTERM during an active browse session** now runs best-effort cleanup before the process exits: if this process launched Chrome, it calls `Browser.close` (falling back to a PID kill) before terminating. This only fires once a `browse open` has actually launched a browser in the current process — unrelated `monomind` commands are unaffected.
- **A Chrome process orphaned by an earlier crash** (e.g. the CLI process itself was killed with `SIGKILL`, which no handler can intercept) can still be cleaned up: `open` persists the launched PID to `.monomind/monobrowse/active-port.json` (`ref-cache.ts`'s `saveActivePort`), and a later `monomind browse close` run in a *fresh* process reads that file and kills the PID directly — this is what makes `closeBrowser()`'s PID-kill fallback work across CLI invocations, not just within one.
- **If none of the above helps** (e.g. the persisted PID file itself is stale or was deleted): find and kill the process manually — `ps aux | grep remote-debugging-port` — then run `monomind browse open` again to start fresh. This manual step is the actual last-resort exception to "no exceptions," and should be rare now that the three mechanisms above cover hang, interrupt, and orphan-after-crash.

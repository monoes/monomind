# Monobrowse Subsystem (`@monoes/monobrowse`)

> `@monoes/monobrowse` · MIT  
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

- **`src/browser/cdp.ts`**: Pure WebSocket-based CDP client implementation.
- **`src/browser/browser-launch.ts`, `browser-lifecycle.ts`**: Browser process launcher, PID management, and automatic port scanning.
- **`src/browser/cdp-port.ts`**: The default CDP port and its environment override (see [Ports](#35-ports-and-the-monoagent-bridge)).
- **`src/browser/profile-dir.ts`**: Per-launch profile directories and the Chrome spawn environment.
- **`src/browser/bridge.ts`**: CDP over the MonoAgent extension bridge (library export).
- **`src/browser/snapshot.ts`**: Accessibility Tree extraction and reference labeling.
- **`src/browser/actions*.ts`**: Interaction primitives (clicking, form filling, typing, hover, focus).
- **`src/cli/commands*.ts`**: The `browse` subcommands, grouped by area.

### 3.5 Ports and the MonoAgent bridge

**Default CDP port: 9422.** `monomind browse open` launches its Chrome with `--remote-debugging-port=9422`, and `browse connect` defaults to the same port. 9222 used to be the default, but mono-agent's extension bridge permanently owns that port and answers only `/monoagent` routes, so a connect to it never reached Chrome (#666). 9422 sits outside the 922x/932x range mono-agent uses (9222 bridge, 9232 test bridge, 9323 bridge fallback).

| Setting | Effect |
|---|---|
| `MONOBROWSE_CDP_PORT` | Sets the port that custom `action` runs and the platform login/session commands connect to. `MONOBROWSE_PORT` and `MONOMIND_CDP_PORT` are older aliases, read in that order after it. Default 9422 |
| `--port <n>` | Port for `browse open` and `browse connect` (both default to 9422; they do not read the environment variable) |
| `browse connect --auto-connect` | Probes 9422, 9222 and 9229 in that order, so a Chrome you started yourself with `--remote-debugging-port=9222` is still found |

If the requested port is held by a process that is not Chrome, a launch scans upward for a free port (up to 10 tries). A Chrome that already answers on the requested port is attached to, not relaunched.

**Bridge fallback.** `BridgeTransport` (exported from the package, not a `browse` flag) drives the browser you are signed into through the MonoAgent Chrome extension, using `chrome.debugger` through mono-agent's relay at `/monoagent/cdp`. It tries `ws://127.0.0.1:9222/monoagent/cdp` first and `ws://127.0.0.1:9323/monoagent/cdp` second, the port mono-agent falls back to when 9222 is held, instead of failing when the first is unavailable. `MONOAGENT_BRIDGE_URL` (comma-separated for several) overrides the list. `HeapProfiler` and `Browser` are not exposed by `chrome.debugger`, so heap snapshots and `Browser.close` fail over the bridge.

**Chrome's `TMPDIR` and the singleton socket.** Chrome binds a `SingletonSocket` under `$TMPDIR/org.chromium.Chromium.XXXXXX/` whatever `--user-data-dir` says, and aborts with `SIGABRT` (`FATAL: Socket path too long`) when that path passes the unix socket limit (103 bytes), which a deep `TMPDIR` in CI work directories or sandboxed runners can do (#663). When `TMPDIR` plus that suffix would pass the limit, monobrowse starts Chrome with `TMPDIR=/tmp`. Otherwise the environment is untouched, and Windows is never changed. Your own shell's `TMPDIR` is not modified.

### Package Exports
```json
{
  "exports": {
    ".": {
      "types": "./dist/src/index.d.ts",
      "import": "./dist/src/index.js"
    },
    "./cdp-port": {
      "types": "./dist/src/browser/cdp-port.d.ts",
      "import": "./dist/src/browser/cdp-port.js"
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
| **Session store** | `ref-cache.ts` | One record per session (`.monomind/monobrowse/sessions/<port>.json`) so multiple CLI calls reach the same browser — and concurrent sessions each keep their own. See [`browse` → Sessions](../commands/browse.md#sessions) |

---

## 5. Recovery — if a command hangs or Chrome is left running

CLAUDE.md mandates `monomind browse` over Playwright/Puppeteer with no exceptions. That mandate now has a real fallback path instead of none:

- **A command that hangs on an unresponsive page** no longer hangs forever — every CDP command sent via `CdpClient.send()` times out after 30s by default (`DEFAULT_CDP_SEND_TIMEOUT_MS` in `cdp.ts`), and a `Target.targetCrashed`/`Target.targetDestroyed` event flushes all in-flight commands immediately rather than waiting out the timeout. If a command still appears stuck past ~30s, it will resolve with a timeout error on its own — just wait, or Ctrl-C.
- **Ctrl-C / SIGTERM during an active browse session** now runs best-effort cleanup before the process exits: if this process launched Chrome, it calls `Browser.close` (falling back to a PID kill) before terminating. This only fires once a `browse open` has actually launched a browser in the current process — unrelated `monomind` commands are unaffected.
- **A Chrome process orphaned by an earlier crash** (e.g. the CLI process itself was killed with `SIGKILL`, which no handler can intercept) can still be cleaned up: `open` persists the launched PID to that session's record, `.monomind/monobrowse/sessions/<port>.json` (`ref-cache.ts`'s `saveSessionRecord`), and a later `monomind browse close` run in a *fresh* process reads that file and kills the PID directly — this is what makes `closeBrowser()`'s PID-kill fallback work across CLI invocations, not just within one.
- **If none of the above helps** (e.g. the persisted PID file itself is stale or was deleted): find and kill the process manually — `ps aux | grep remote-debugging-port` — then run `monomind browse open` again to start fresh. This manual step is the actual last-resort exception to "no exceptions," and should be rare now that the three mechanisms above cover hang, interrupt, and orphan-after-crash.
- **Chromium profile directories no longer pile up in `os.tmpdir()`.** Every browser monobrowse launches gets its own `--user-data-dir` (`monomind-browser-*`, `monomind-browse-*`); that directory is now deleted once its Chrome has exited — on a graceful close, on the PID-kill fallback above, on `browse close` from a later process, and when a launch fails. Each launch also sweeps profile directories left by a crashed or killed process: only exact monobrowse names directly under tmpdir, real directories (never symlinks), older than 10 minutes, whose owning PID is dead and that no live Chrome still has open (checked via `/proc` on Linux and the profile's `SingletonLock` everywhere). A `userDataDir` you passed in yourself is never deleted.

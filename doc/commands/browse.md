# `monomind browse` — Command Reference

> **Browser automation CLI** powered by the `@monoes/monobrowse` subsystem.
> Connects directly to Google Chrome/Chromium via Chrome DevTools Protocol (CDP).

---

## Command Index

`browse` has 64 subcommands. Every one accepts `--port <port>` and
`--session <name>` to choose the [session](#sessions) it acts on.

**Session and navigation**

| Subcommand | Description |
|---|---|
| [`open`](#open) | Open a URL |
| [`connect`](#connect) | Attach to a Chrome that is already running |
| [`close`](#close) | Close a browser session and release its processes |
| [`navigate`](#navigate) | Go back, forward, or reload |
| `pushstate` | SPA navigation via `pushState`: `pushstate /path` |
| [`wait`](#wait) | Wait for a condition (URL, text, selector, load, function, download) |
| `tab` | `tab list`, `tab new [url]`, `tab close` |
| `window` | `window new [url]` |
| `frame` | Switch into an iframe (`frame "#frame-id"`) or back out (`frame main`) |
| `resize` | `resize <width> <height>` |
| `set` | `set viewport`, `device`, `geo`, `offline`, `media`, `credentials`, `useragent` |
| `state` | `state save`, `load`, `list`, `rename`, `clean [name]`; `--older-than <days>` limits `clean` |

**Reading the page**

| Subcommand | Description |
|---|---|
| [`snapshot`](#snapshot) | Accessibility snapshot with `@e1`-style element handles |
| [`get`](#get) | Page and element values |
| [`screenshot`](#screenshot) | Screenshot of the page |
| `pdf` | Save the page as a PDF: `pdf [path]` (`--landscape`; `--background` is on by default) |
| `find` | Find elements by semantic locator: `find role\|text\|label\|placeholder\|testid\|alttext\|title\|selector <value> [action]`; `--name`, `--exact`, `--nth <n>`, `--last` narrow the match |
| `highlight` | Highlight an element for 2 seconds |
| `eval` | Evaluate JavaScript in the page: `eval "document.title"`; `--stdin` reads a multiline script from stdin, `--max-output <n>` truncates the printed result (default 50000 characters, 0 disables), `--timeout <ms>` (default 30000), `--json` |
| `console` | Captured console messages (`--clear`, `--json`, `--errors-only`) |
| `errors` | Uncaught page exceptions (`--clear`) |
| `diff` | `diff url <url1> <url2> [--interactive] [--json]` compares two pages |
| `is`, `isvisible`, `isenabled`, `ischecked` | Element state checks; each takes `@ref` or a CSS selector |

**Input**

| Subcommand | Description |
|---|---|
| [`click`](#click), `dblclick` | Click or double-click |
| [`fill`](#fill), [`type`](#type) | Replace or append text |
| [`press`](#press), `keydown`, `keyup`, `keyboard` | Keys; `keyboard type "text"` and `keyboard inserttext "text"` |
| `hover`, `focus`, `scrollintoview`, `drag` | Pointer and focus actions; `drag @e1 @e2` |
| `select`, `check`, `uncheck` | Dropdowns and checkboxes |
| `upload`, `download` | `upload @e1 ./file.pdf`; `download @e1 ./out.pdf` clicks and captures the download (`--timeout`, default 30000 ms) |
| [`scroll`](#scroll) | Scroll the page or an element |
| `tap`, `swipe` | Touch events for mobile testing; `swipe` takes `--distance` (default 300), `--x`, `--y` |
| `mouse`, `clipboard` | `mouse move\|down\|up\|wheel` (`--button left\|right\|middle`); `clipboard read\|write\|copy\|paste` |
| `dialog` | `dialog accept\|dismiss\|status` |
| `batch` | Run several commands in one connection: `batch "open url" "snapshot -i" "click @e1"`; `--bail` stops at the first error, `--json` reads the commands from JSON on stdin |
| `addinitscript`, `removeinitscript` | Add or remove a script that runs before each navigation |

**Network, storage and diagnostics**

| Subcommand | Description |
|---|---|
| `network` | `route` (`--pattern`, `--abort`, `--fulfill`, `--status`, `--headers`), `unroute`, `cookies`, `headers`, `capture`, `requests` (`--filter`, `--method`, `--status-code`, `--type`), `request` |
| `cookies` | `cookies list\|set\|clear`; `--name`, `--value`, `--domain`, `--curl <file>` imports a cURL cookie dump |
| `storage` | `storage local\|session [key]` with `--set <value>`, `--remove`, `--clear`, `--json` |
| `record` | Screen recording: `record start\|stop\|restart\|status [path]` (`--format jpeg\|png`, `--quality`) |
| `trace` | CDP performance trace: `trace start\|stop [path]` (`--screenshots`) |
| `profiler` | `profiler start\|stop\|heap [path]` (`--interval` in microseconds, default 1000) |
| `har` | `har start\|stop\|status [path]` (`--bodies` captures response bodies) |
| `vitals` | Core Web Vitals (`--wait <ms>`, default 2000) |
| [`report`](#report) | One-command page test with an HTML report and sibling JSON |

**Automation built on `browse`**

| Subcommand | Description |
|---|---|
| [`workflow`](#workflow-action-and-platform) | `create`, `run`, `list` (alias `ls`), `status`, `stop` |
| [`action`](#workflow-action-and-platform) | `build`, `run`, `list` (alias `ls`), `show` |
| [`platform`](#workflow-action-and-platform) | `connect`, `list` (alias `ls`), `disconnect` for linkedin, instagram, x and gemini |

---

## Ports and endpoints

`browse` talks to Chrome over CDP on a local port.

- **Default port: 9422.** `connect`, `action build`, `action run` and
  `platform connect` default to 9422. The default is not 9222 because
  mono-agent's extension bridge owns 9222 and answers only its own `/monoagent`
  routes, so a CDP connect to it never reaches Chrome (#666). If a launch finds
  the requested port held by a different process, it scans upward for a free one.
- **`connect --auto-connect`** probes `9422`, `9222` and `9229`, in that order,
  and uses the first one that answers `/json/version`. 9222 stays on the list so
  a Chrome you started yourself with `--remote-debugging-port=9222` is found.
- **`MONOBROWSE_CDP_PORT`** sets the port for the `browser_*` MCP tools and for
  monobrowse's own `action` and `platform` commands. The older names
  `MONOBROWSE_PORT` and `MONOMIND_CDP_PORT` still work as deprecated aliases,
  checked in that order after `MONOBROWSE_CDP_PORT`. The `monomind browse`
  subcommands above read `--port`, not the environment variable.
- **Extension bridge.** The `BridgeTransport` in `@monoes/monobrowse` drives the
  browser you are signed into through the MonoAgent extension instead of a
  Chrome that monobrowse launched. It tries `ws://127.0.0.1:9222/monoagent/cdp`,
  then `ws://127.0.0.1:9323/monoagent/cdp` (the port mono-agent falls back to
  when 9222 is held). `MONOAGENT_BRIDGE_URL` replaces that list; separate
  several URLs with commas. No `browse` subcommand selects it yet: it is a
  library transport.
- **Long temp paths.** Chrome keeps a `SingletonSocket` under `$TMPDIR`, and
  aborts at startup with `SIGABRT` when that path passes the 108-byte socket
  limit, which a deep `TMPDIR` in CI or a sandbox can cause. When the path
  would overflow, `browse` points Chrome's `TMPDIR` at `/tmp` for that launch
  and leaves the environment alone otherwise (#663).
- **No Chrome installed.** An installed Chrome, Chromium or Edge is always used
  first. Without one, the first command that launches a browser downloads Chrome
  into `~/.monomind/deps`.

---

## Sessions

A browse session is one browser plus the CDP port it listens on. `browse` is a
multi-command CLI — `open`, `snapshot` and `close` are separate processes — so
each session is recorded in the working directory it was started from, under
`.monomind/monobrowse/sessions/<port>.json`.

The rules a command follows:

- **`open` with no `--port` starts its own session.** Chrome binds a free port
  chosen by the kernel, in a profile directory of its own, and `open` reports
  it: `✓ Opened: Example (https://example.com) [port 41337]`. It never joins an
  existing session, so two uncoordinated `open` calls always get a browser each.
- **`open --port N` / `connect --port N` attach to the browser on port N**, or
  launch one there — the behaviour to use when you want a known, fixed port.
- **Any later command with no `--port` or `--session` acts on the newest
  unnamed session started in this directory whose browser still answers —
  unless exactly one other live session exists, named or not, in which case it
  acts on that one.** Dead sessions are dropped as it looks (so a browser you
  killed, or one that crashed, never wedges the next command), and with none
  left the command starts a session of its own, exactly as `open` would.
- **Any later command with `--port N` acts on the session on port N.** This is
  how a second concurrent caller targets the session its own `open` reported,
  rather than "the newest one".
- **`--session <name>` selects a session by name.** `open --session ref` (or
  `connect --session ref`) starts a session called `ref`, or re-opens the live
  one of that name; any other command with `--session ref` acts on it, and fails
  with `No live browse session named "ref"` when there is none. Named sessions
  are otherwise only reached by their name (or port) — a command with no
  `--session` lands on a named session only when it is the sole live session
  in the directory, and refuses to guess between two or more live sessions —
  so two named sessions can run side by side in one directory:

  ```bash
  monomind browse open https://example.com --session ref
  monomind browse open http://localhost:3000 --session build
  monomind browse screenshot ref.png --session ref
  monomind browse screenshot build.png --session build
  monomind browse close --session ref
  ```
- **`close` ends exactly the session it resolved** — that one browser and that
  one record. Another invocation's browser is never touched, and a browser you
  only `connect`ed to is left running.

Running concurrent sessions from separate working directories keeps them
separate without any flags, since the session records (and the snapshot ref
caches beside them) are per directory.

**Upgrading with a session open.** Before this layout, a directory held one
session in `.monomind/monobrowse/active-port.json`. If that file is still
there, the first command that looks for a session treats it as one more
candidate — the oldest one, so live per-port sessions win. If its browser
still answers, the session is adopted: the record is rewritten as
`sessions/<port>.json` (keeping its port, PID and `connect`/`open`
provenance) and the old file is deleted, after which `snapshot`, `--port` and
`close` treat it like any other session. If it does not answer, the old file
is simply removed. Nothing writes that file any more, and adoption never
makes a bare `open` join an existing session.

---

## `open`

Open a URL. Automatically checks for login walls and CAPTCHAs, switching to headed mode if detected.

```bash
monomind browse open <url> [--port <port>] [--headed] [--session <name>] [--state <file>]
```

- `-p, --port`: attach to (or launch on) this CDP port. Default: a free port of this
  session's own — see [Sessions](#sessions) and [Ports and endpoints](#ports-and-endpoints).
- `--headed`: Force a visible browser window.
- `-s, --session`: Start the session with this name, or re-open the live one (see
  [Sessions](#sessions)). If state was saved under the same name
  (`state save <name>`), it is restored.
- `--state`: Load state from a JSON file.

---

## `connect`

Attach to a Chrome that is already running with remote debugging on. Later
commands reuse the session. `close` never kills a browser you only connected to.

```bash
monomind browse connect [--port 9422] [--target <id>] [--auto-connect] [--session <name>]
```

- `-p, --port`: CDP port. Default: `9422`.
- `--target`: attach to this target id instead of the first page.
- `--auto-connect`: probe ports `9422`, `9222` and `9229` and use the first one
  that answers. Fails with `No running Chrome instance found` when none does.

`open` without `--port` still launches its own browser; it does not use the
`connect` default.

---

## `snapshot`

Capture accessibility tree snapshot. Elements are indexed with handles (`@e1`, `@e2`, ...).

```bash
monomind browse snapshot [options]
```

- `-i, --interactive`: Show interactive elements only (reduces token load by 93%).
- `-c, --compact`: Output in compact layout format.
- `-d, --depth <num>`: Max AX tree depth.
- `-s, --selector <css>`: Scope tree to a specific element.
- `--save <path>`: Save baseline for diff comparison.
- `--diff <path>`: Show diff between current state and baseline.
- `--content-boundaries`: Wrap the output in sentinel markers so page content cannot pass itself off as instructions.
- `--max-output <n>`: Truncate the output to N characters, to keep large pages out of the context window.
- `--json`: Output as JSON.

---

## `click`

Click an element by ref or coordinates.

```bash
monomind browse click <@ref> [--right] [--double] [--x <num>] [--y <num>]
```

- `<@ref>`: Accessibility element reference (e.g. `@e4`).
- `--right`: Perform a right-click.
- `--double`: Double-click.
- `--x` / `--y`: Click at raw screen coordinates.

---

## `fill`

Fill an input element (clears value first).

```bash
monomind browse fill <@ref> "<value>"
```

---

## `type`

Type text into an element (appends).

```bash
monomind browse type <@ref> "<text>"
```

---

## `press`

Press a keyboard key.

```bash
monomind browse press <keyName>
```
*Examples:* `Enter`, `Escape`, `Tab`, `ArrowDown`.

---

## `wait`

Wait for a condition to be met before the CLI command completes.

```bash
monomind browse wait [options]
```

- `--url <pattern>`: Wait for URL matching a glob.
- `--text "<text>"`: Wait for text on page.
- `--not-text "<text>"`: Wait for text to disappear.
- `--selector <css>`: Wait for CSS selector to appear.
- `--load <state>`: Wait for `load`, `networkidle`, or `domcontentloaded`.
- `--fn "JS expression"`: Wait until expression returns truthy.
- `--ms <ms>`: Delay for N milliseconds (max 60s).
- `-t, --timeout <ms>`: How long to wait for the condition. Default: `30000`.
- `--download <path>`: Wait for a file download to complete and save to path.

---

## `screenshot`

Capture a screenshot of the page.

```bash
monomind browse screenshot [path] [--full] [--format png|jpeg|webp] [--quality <0-100>] [--annotate] [--hide-scrollbars] [--json]
```

- `--full`: Capture full scrollable page.
- `--format`: `png` (default), `jpeg` or `webp`.
- `--quality`: 0-100 for `jpeg` and `webp`. Default: `80`.
- `--annotate`: Draw overlays matching the `@eN` refs from the last snapshot. Viewport-only: do not combine with `--full`.
- `--hide-scrollbars`: Hide scrollbars before taking screenshot.
- `--json`: Print the output path as JSON.

---

## `get`

Retrieve page info or node attributes.

```bash
monomind browse get <url|title|text|html|value|attr|count|box|styles> [@ref] [attrName] [--json]
```

---

## `scroll`

Scroll the page.

```bash
monomind browse scroll <up|down|left|right> [pixels] [--selector <css>] [--ref <@ref>]
```

- `pixels` or `-a, --amount <num>`: distance to scroll. Default: `300`.
- `-s, --selector <css>` or `--ref`: scroll inside that element instead of the page.

---

## `navigate`

Navigate browser history.

```bash
monomind browse navigate <back|forward|reload>
```

---

## `close`

Close one browser session and release the processes it spawned. Without
`--port` it closes the newest live session started in this directory; with
`--port` it closes that session and leaves every other one running. See
[Sessions](#sessions).

```bash
monomind browse close [--port <port>] [--session <name>]
```

---

## `report`

Test a page and write one self-contained HTML report plus a sibling JSON file,
with a pass/fail verdict.

```bash
monomind browse report <url> [options]
```

| Option | Default | Description |
|---|---|---|
| `-o, --out <path>` | | Output `.html` path, or a directory |
| `-b, --budget <file or json>` | | Budget as a JSON file path or inline JSON, e.g. `'{"lcp":4000}'` |
| `-d, --devices <names>` | | Comma-separated device names for a screenshot matrix |
| `-w, --wait <selector or ms>` | | Extra settle step: a CSS selector to wait for, or milliseconds |
| `--full-page` | `true` | Full-page screenshot (`--no-full-page` for the viewport only) |
| `--vitals-wait <ms>` | `2500` | Time to let the web-vitals observers run |
| `--timeout <ms>` | `20000` | Time to wait for the page to go network-idle |
| `--repeat <n>` | | Run the URL `n` times and report per-check flake rates |
| `--record` | `false` | Record frames for the evidence timeline even when the run passes |
| `--history` | `false` | Print the stored run history for this URL instead of running it |
| `--save` | `true` | Save the run to the history store (`--no-save` to skip) |
| `--history-max <n>` | `20` | Runs kept per URL before the oldest are pruned |
| `--trend-window <n>` | `10` | Prior runs charted in the trend section |
| `--keep-open` | `false` | Leave the browser running after the report |
| `--json` | `false` | Print the result as JSON |

---

## `workflow`, `action` and `platform`

These three are monomind's own additions on top of the monobrowse commands.

```bash
monomind browse workflow create <name> [-o .monomind/workflows]
monomind browse workflow run <file.json> [--no-dashboard] [--port 4243] [-i <items.json>]
monomind browse workflow list | status <run-id> | stop <run-id>

monomind browse action build -u <url> -t "<what the action should do>" [-o .monomind/actions] [--port 9422]
monomind browse action run <action-id> [-a <account>] [-p key=value]... [--port 9422]
monomind browse action list
monomind browse action show <action-id>

monomind browse platform connect <linkedin|instagram|x|gemini> [--port 9422]
monomind browse platform list
monomind browse platform disconnect <session-id>
```

- `list` is also `ls` for all three.
- `workflow run --port` is the dashboard port (default `4243`), not a CDP port.
  `--no-dashboard` skips opening the dashboard.
- `workflow create` names are 1-64 characters of letters, digits, `-` and `_`.
- `action list` shows the built-in actions (linkedin, instagram, x, gemini) and
  the JSON files in `.monomind/actions`. `action show` reads only that
  directory.
- `platform connect` opens a headed browser, waits for you to log in (it checks
  every 2 seconds) and saves the session. `platform list` prints the session
  IDs that `platform disconnect` takes.

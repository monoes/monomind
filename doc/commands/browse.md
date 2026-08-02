# `monomind browse` — Command Reference

> **Browser automation CLI** powered by the `@monoes/monobrowse` subsystem.
> Connects directly to Google Chrome/Chromium via Chrome DevTools Protocol (CDP).

---

## Command Index

| Subcommand | Description |
|---|---|
| [`open`](#open) | Open a URL |
| [`snapshot`](#snapshot) | Capture AX snapshot with reference markers |
| [`click`](#click) | Click an element by ref or coordinates |
| [`fill`](#fill) | Fill an input element |
| [`type`](#type) | Type text into an element |
| [`press`](#press) | Press a keyboard key |
| [`wait`](#wait) | Wait for a condition (URL, text, selector, load, download) |
| [`screenshot`](#screenshot) | Take a screenshot of the page |
| [`get`](#get) | Retrieve page values (url, title, text, html, value, style, box) |
| [`scroll`](#scroll) | Scroll page up/down/left/right |
| [`navigate`](#navigate) | Go back, forward, or reload page |
| [`close`](#close) | Close browser session and release processes |

---

## `open`

Open a URL. Automatically checks for login walls and CAPTCHAs, switching to headed mode if detected.

```bash
monomind browse open <url> [--port <port>] [--headed] [--session <name>] [--state <file>]
```

- `--port`: CDP debugging port (default: 9222).
- `--headed`: Force a visible browser window.
- `--session`: Restore previously saved cookies/session state.
- `--state`: Load state from a JSON file.

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
- `--download <path>`: Wait for a file download to complete and save to path.

---

## `screenshot`

Capture a screenshot of the page.

```bash
monomind browse screenshot [path] [--full] [--format png|jpeg|webp] [--quality <0-100>] [--annotate] [--hide-scrollbars]
```

- `--full`: Capture full scrollable page.
- `--annotate`: Draw overlays matching `@eN` reference indices (viewport-only).
- `--hide-scrollbars`: Hide scrollbars before taking screenshot.

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
monomind browse scroll <up|down|left|right> [pixels]
```

---

## `navigate`

Navigate browser history.

```bash
monomind browse navigate <back|forward|reload>
```

---

## `close`

Close browser session and release all spawned processes.

```bash
monomind browse close
```

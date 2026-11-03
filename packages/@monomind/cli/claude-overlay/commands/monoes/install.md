---
name: monoes:install
description: Detect, install, and troubleshoot the monoes tool family (monotask, mono-agent, mono-clip), then record their existence in monomind's memory
---

# monoes install

Installs one or more tools from the `monoes` family:

| Tool | What it is | Distribution |
|---|---|---|
| **monotask** | P2P kanban / task board (Rust, CLI + Tauri desktop app) | Homebrew tap `monoes/tap` (renamed from `nokhodian/tap` — see Gotchas) — `monotask` formula (CLI) + `monotask` cask (desktop) |
| **mono-agent** | Workflow/browser automation agent (Go CLI + Wails desktop GUI "MonoAgent"), binary name `monoagentcli` | No Homebrew tap — prebuilt CLI binary + desktop app zip on GitHub releases (`monoes/mono-agent`), or build from source |
| **mono-clip** | Desktop clipboard/utility app (Tauri + SvelteKit) | Homebrew tap `monoes/tap` (renamed from `nokhodian/tap`) — `mono-clip` cask (desktop only, no CLI, but see mclip sidecar below) |

Sibling repos, if present, live at `../mono-agent`, `../mono-clip`, `../monotask` relative to this repo (i.e. `/Volumes/media/projects/monoes/<name>` on this machine) — used as the source-build fallback and as the source of truth for what each tool does.

## Steps

### 1. Detect current state

Run these checks (batch in one message):

```bash
command -v monotask; command -v monoagentcli; command -v mclip
ls /Applications 2>/dev/null | grep -iE "monotask|mono ?clip|mono ?agent"
brew tap 2>/dev/null | grep -iE "nokhodian|monoes/tap"
which brew
which go
which gh
```

Note for each tool whether: not installed / CLI installed / desktop app installed / both.

### 2. Ask the user what to install

Use `AskUserQuestion` (multiSelect) with options: **All three**, **monotask**, **mono-agent**, **mono-clip** — skip options that detection already shows as fully installed (mention that in the option description). Each selected tool gets **both its CLI and its desktop app by default** — don't ask a CLI-vs-Desktop follow-up. If a tool already has one half installed (e.g. desktop app present, CLI missing), just install the missing half.

### 3. Install each selected tool

**monotask** (prefer Homebrew — use the fully-qualified `monoes/tap/monotask` name; see Gotchas for why; installs both CLI and desktop app by default):
```bash
brew tap monoes/tap   # no-op if already tapped
brew install monoes/tap/monotask            # CLI
brew install --cask monoes/tap/monotask     # Desktop app
```
**Important**: the formula installs the raw binary as `monotaskcli` (not `monotask`), and Homebrew will refuse to auto-link it if the `monotask` cask is also installed ("monotask cask is installed, skipping link"). After install, check `command -v monotask` — if missing, find and symlink it:
```bash
ln -sf "$(brew --cellar)"/monotask/*/bin/monotaskcli "$(brew --prefix)/bin/monotask"
```
Fallback if Homebrew unavailable or the formula 404s, and `../monotask` exists locally (requires Rust 1.78+):
```bash
cd ../monotask
cargo build -p monotask-cli --release
cp target/release/monotaskcli /usr/local/bin/monotask
```

**mono-clip** (Homebrew cask; the `mclip` CLI sidecar auto-installs on first launch, so launch it once as part of install):
```bash
brew tap monoes/tap
brew install --cask monoes/tap/mono-clip
```
**Important**: apply the Gatekeeper fix (see Troubleshooting) to `/Applications/MonoClip.app` **immediately after install, before the first launch** — macOS's `syspolicyd`/AppleSystemPolicy can silently move the unsigned app straight to Trash on its first launch attempt, not just show a "damaged" dialog. If that already happened, the app is recoverable: reinstall from Homebrew's cache (`brew reinstall --cask --force monoes/tap/mono-clip`) rather than trying to resurrect it from Trash (there may be an unrelated stale app of the same name already in Trash from a prior session). Then launch it once via explicit path (not `open -a`, which can resolve to a stale same-named app elsewhere on disk — see the mono-agent gotcha below) to trigger the `mclip` CLI symlink:
```bash
find /Applications/MonoClip.app -print0 | xargs -0 xattr -c
codesign --force --deep --sign - /Applications/MonoClip.app
open /Applications/MonoClip.app
sleep 2
ls ~/.local/bin/mclip   # confirm the symlink appeared
```

Fallback if `../mono-clip` exists locally (requires Rust, Node 18+, pnpm, Tauri CLI):
```bash
cd ../mono-clip
pnpm install
pnpm build:mclip    # required: builds the mclip sidecar into src-tauri/binaries/mclip-<target-triple>
                    # (tauri.conf.json's externalBin needs this to exist first — not wired into
                    # beforeBuildCommand, must be run manually; skipping it fails the bundle step)
cargo tauri build   # → src-tauri/target/release/bundle/macos/MonoClip.app
```

**mono-agent** (no Homebrew tap — prefer the prebuilt release binary/app; binary name is `monoagentcli`, desktop app name "MonoAgent"; macOS Apple Silicon shown, swap the asset suffix for other platforms; installs both CLI and desktop app by default):
```bash
curl -fsSL https://github.com/monoes/mono-agent/releases/latest/download/monoagentcli-darwin-arm64 -o monoagentcli
chmod +x monoagentcli
sudo mv monoagentcli /usr/local/bin/
```
(Other CLI assets on the same release: `monoagentcli-darwin-amd64`, `monoagentcli-linux-amd64`, `monoagentcli-windows-amd64.exe`.)

Desktop app "MonoAgent" ships as a zip on the same release (`MonoAgent-darwin-arm64.zip` / `MonoAgent-linux-amd64.tar.gz` / `MonoAgent-windows-amd64.exe`):
```bash
curl -fsSL https://github.com/monoes/mono-agent/releases/latest/download/MonoAgent-darwin-arm64.zip -o /tmp/MonoAgent.zip
unzip -q -o /tmp/MonoAgent.zip -d /tmp/monoagent-extract
cp -R /tmp/monoagent-extract/MonoAgent.app /Applications/MonoAgent.app   # NOT sudo cp — sudo makes it root-owned
                                                                          # and breaks the codesign step below
find /Applications/MonoAgent.app -print0 | xargs -0 xattr -c
codesign --force --deep --sign - /Applications/MonoAgent.app
open /Applications/MonoAgent.app   # explicit path, not `open -a MonoAgent` — see Gotchas
```
**Important**: use `cp -R` (no `sudo`) to place the app — a `sudo`-owned copy makes `xattr -c` fail on the root-owned `com.apple.provenance` attribute and produces a broken/partial codesign ("internal error in Code Signing subsystem"), confirmed live. And launch it via the explicit `/Applications/MonoAgent.app` path, not `open -a MonoAgent` — if a stray local dev build exists anywhere on disk (e.g. `../mono-agent/wails-app/build/bin/MonoAgent.app` from a prior `wails build`), Launch Services can resolve the bare app name to that one instead of the one just installed.

Fallback if offline/no network access to GitHub, and `../mono-agent` exists locally (requires Go 1.25+, per `go.mod`):
```bash
cd ../mono-agent
CGO_ENABLED=0 go build -o bin/monoagentcli ./cmd/monoagentcli    # or: make build-cli (same output, matches canonical CI build)
sudo cp bin/monoagentcli /usr/local/bin/monoagentcli
```

### 4. Troubleshoot as issues come up

Known issues from each project's README/Makefile — apply the fix automatically when the matching error appears, then retry once:

- **`brew`**: not installed → offer `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` (confirm with user first, this is a real install action).
- **The tap was renamed**: `nokhodian/tap` now redirects to `monoes/tap`. If both end up tapped (e.g. from an old muscle-memory command), formula/cask lookups become ambiguous — `Error: Formulae found in multiple taps: * monoes/tap/monotask * nokhodian/tap/monotask`. Fix: always use the fully-qualified `monoes/tap/<name>` form (as in the install commands above); if something was already installed from the old tap name, `brew uninstall nokhodian/tap/<name>` then reinstall from `monoes/tap/<name>` (this reinstalls the identical package under its current tap, not a downgrade/different version — safe). To just clear the ambiguity without touching either install, `brew untap --force nokhodian/tap` is safe as long as the installed formula/cask's `INSTALL_RECEIPT.json` already points at `monoes/tap` (check with `brew info <formula>` or `cat "$(brew --cellar)/<name>"/*/INSTALL_RECEIPT.json`).
- **Faster path for all of the above**: this repo's own `npx monomind doctor -c monoes-tools --install` runs and auto-fixes exactly these three known issues (tap ambiguity, monotask's missing `monotask`→`monotaskcli` symlink, mono-clip's quarantine flag) — it's an opt-in doctor component, not part of the default `doctor` run, since these are unrelated sibling tools rather than monomind dependencies. Prefer it over manually reapplying the fixes below.
- **`Refusing to load cask/formula ... from untrusted tap monoes/tap` (or `nokhodian/tap`)** → run `brew trust monoes/tap` (or `brew trust --formula monoes/tap/monotask` / `--cask monoes/tap/<name>` if it's scoped to one item), then retry the install.
- **`"<App> is damaged and can't be opened"` (Gatekeeper, unsigned app) — or the app silently vanishes / relaunches from Trash**: macOS's `syspolicyd` can reject an ad-hoc-signed app on its very first launch and move it to Trash without any visible dialog (confirmed via `log show --predicate 'eventMessage contains "<AppName>"'`: `AppleSystemPolicy: Security policy would not allow process`). Apply this **before** the first launch, not after:
  ```bash
  find /Applications/<App>.app -print0 | xargs -0 xattr -c
  codesign --force --deep --sign - /Applications/<App>.app
  ```
  If the app already got trashed: don't try to recover it from `~/.Trash` (there may be an unrelated older copy of the same app name sitting there from a prior session, and `open -a <App>` can resolve to the wrong one). Instead reinstall from Homebrew's cache — `brew reinstall --cask --force <tap>/<name>` re-extracts a fresh copy into `/Applications` — then apply the fix above immediately, then launch.
- **`open -a <App>` launches the wrong copy, or a stray dev build**: macOS Launch Services resolves a bare app name against *every* registered app bundle by that name on disk, not just the one in `/Applications` — a leftover local build (e.g. `../mono-agent/wails-app/build/bin/MonoAgent.app` from a prior `wails build`) can win. Always launch by explicit path after install: `open /Applications/<App>.app`.
- **`sudo cp`-ing an app bundle into `/Applications` breaks the Gatekeeper fix**: use plain `cp -R` (no `sudo`) to place `.app` bundles — Homebrew casks install them user-owned, and a root-owned copy makes `xattr -c` fail on `com.apple.provenance` and can produce a broken/partial `codesign` ("internal error in Code Signing subsystem"). `sudo` is only needed for placing plain CLI binaries into `/usr/local/bin`, not `.app` bundles into `/Applications`.
- **Go build fails, `go: command not found`** → `brew install go`.
- **`curl` to the mono-agent release 404s or times out** → confirm the asset name matches the current platform exactly (`monoagentcli-darwin-arm64` etc. — check `gh release view -R monoes/mono-agent --json assets -q '.assets[].name'` for the current list (omit the tag argument entirely to get latest — `gh release view latest ...` is invalid syntax and returns "release not found"), since asset names have changed across past renames), then fall back to the source-build path.
- **`cargo tauri` not found** → `cargo install tauri-cli` (or check `../mono-clip`/`../monotask` `package.json` for a pinned `@tauri-apps/cli` dev dependency and use `pnpm tauri` instead).
- **Sibling repo missing** (`../<name>` doesn't exist) → tell the user the source-build fallback isn't available on this machine and stick to the Homebrew path, or ask for the repo path.
- Any other failure → show the actual error output to the user and ask how they want to proceed. Don't retry silently more than once per issue.

### 5. Verify

After each install, confirm it actually works:
```bash
monotask version 2>&1 || true         # subcommand, not --version flag
monoagentcli version 2>&1 || true    # mono-agent CLI
mclip --help 2>&1 | head -1 || true  # mono-clip CLI sidecar (after the launch-once step above)
ls /Applications/Monotask.app /Applications/MonoAgent.app /Applications/MonoClip.app 2>&1
```

### 6. Record knowledge in monomind

For every tool that ends this run **installed and verified** (not for ones skipped or left failing), store a memory entry so monomind's routing/agents know it exists:

```bash
npx monomind memory store --namespace tools --key "tool:monotask" \
  --value "monotask — P2P kanban/task board, Rust. CLI: 'monotask <cmd>' (Homebrew formula installs the raw binary as 'monotaskcli' and won't auto-link to 'monotask' if the same-named cask is present — symlink manually, see install.md). Desktop: Monotask.app. Both CLI and desktop app installed by default. Source: ../monotask. Installed via Homebrew (monoes/tap, renamed from nokhodian/tap). Use /monoes:monotask to interact with it." \
  --tags "external-tool,cli,desktop,installed"

npx monomind memory store --namespace tools --key "tool:mono-agent" \
  --value "mono-agent — workflow/browser automation agent, Go + Wails. CLI binary name: 'monoagentcli' (renamed from monoes -> monoagent -> monoagentcli; built from ./cmd/monoagentcli). Desktop app: MonoAgent.app (installed via the release zip, not a cask — cp -R without sudo, then xattr -c + codesign --force --deep --sign - before launch; launch via explicit /Applications path, not open -a, since stray local dev builds can shadow it). Both CLI and desktop app installed by default. Prebuilt binaries on GitHub releases (monoes/mono-agent), no Homebrew tap. Source: ../mono-agent. Use /monoes:monoagent to interact with it." \
  --tags "external-tool,cli,desktop,installed"

npx monomind memory store --namespace tools --key "tool:mono-clip" \
  --value "mono-clip — desktop clipboard utility, Tauri + SvelteKit. Desktop app: MonoClip.app (unsigned — apply xattr -c + codesign --force --deep --sign - BEFORE first launch, or macOS silently trashes it). Also ships a CLI sidecar, 'mclip' (list/add/get/pin/folder + an MCP stdio server), auto-symlinked to ~/.local/bin/mclip on first GUI launch — install.md now launches it once as part of install to guarantee the CLI is present too. Source: ../mono-clip. Installed via Homebrew (monoes/tap, renamed from nokhodian/tap, cask). Use /monoes:monoclip to interact with it." \
  --tags "external-tool,cli,desktop,installed"
```

Only run the `memory store` calls for the tools actually installed this run — don't overwrite entries for tools the user chose to skip.

### 7. Summarize

One short report: what got installed, what was skipped (and why), what's left to fix, and which memory entries were written.

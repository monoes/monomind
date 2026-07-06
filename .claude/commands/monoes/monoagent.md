---
name: monoes:monoagent
description: Drive the mono-agent CLI (binary `monoagentcli`) — browser-automation bots, workflows, and node execution for Instagram/LinkedIn/X/TikTok/Gemini and API-connected services
---

# monoes monoagent

Interact with **mono-agent** — a Go CLI, source at `../mono-agent`, GitHub `monoes/mono-agent`. Not installed? Run `/monoes:install` first.

**Binary name is `monoagentcli`** (as of release `v0.5.2`, "Binary renamed to monoagent", and finalized to `monoagentcli` in the `v0.7.0`-era release pipeline rework). The project went through two renames: `monoes` → `monoagent` → `monoagentcli`. The Cobra root `Use:` field, the `Makefile`, `.github/workflows/release.yml`, and the actual GitHub release assets all agree on `monoagentcli` — that's current truth. **The README.md in the repo still shows the old `monoes` name in its examples — it's stale, don't follow it.**

Given the user's request in `$ARGUMENTS`, pick the matching command(s) below and run them via Bash. If nothing matches cleanly, run `monoagentcli <subcommand> --help` to double-check rather than guessing a flag shape — **not** `monoagentcli ref commands`, whose hand-maintained flag docs are themselves stale for several commands (see Gotchas). `monoagentcli ref nodes` / `ref node <type>` (the node catalogue) is a separate, more reliable code path and fine to use.

## Global flags (available on every subcommand)

| Flag | Default | Purpose |
|---|---|---|
| `--db-path` | `~/.monoagent/monoagent.db` | SQLite state |
| `--output-dir` | `~/.monoagent/output` | `export` destination |
| `--config-dir` | `~/.monoagent/configs` | XPath/selector cache |
| `--headless` | `false` | Run Chrome headless |
| `--workers` | `1` | Parallel workers |
| `-v, --verbose` | | Verbose logging |
| `--json` | | Machine-readable output |
| `--log-file` | | Log to file |
| `--profile` | `""` (falls back to `settings.active_profile_id`, then `"default"`) | Active profile |

**Two separate state directories exist** — don't confuse them: `~/.monoagent/*` (DB, output, config-dir — the flags above) vs. `~/.monoes/*` (workflows, installed action templates, crawl captures, the persistent Chrome login profile, Gemini image downloads, ONNX models). This split predates the binary rename and hasn't been cleaned up — real, not a typo.

## Setup / auth

- **Social platforms** (instagram, linkedin, x, tiktok, gemini): `monoagentcli login <platform>` opens a real Chrome window, waits for manual login, saves cookies (30-day expiry). `monoagentcli login status` / `monoagentcli logout [platform|--all]`.
  - `gemini` needs **no API key** — browser automation against gemini.google.com after login. `monoagentcli login gemini` unlocks `gemini.generate_text` / `gemini.generate_image` / `gemini.chat_session` nodes for free.
- **API/OAuth services** (Slack, GitHub, Google Sheets, Notion, Stripe, etc.): `monoagentcli connect <platform>`, `monoagentcli connect list --all`, `monoagentcli connect test <id>`, `monoagentcli connect refresh <id>`.
- A Chrome extension bridge listens on `:9222`; if connected it's preferred over launching Chromium directly. Only one process (CLI or the Wails desktop app, product name "MonoAgent") should hold it at a time.
- Multiple isolated identities: `monoagentcli profile list|create <name>|switch <name-or-id>|current` — sessions/workflows/actions/connections are all scoped per-profile.

## Command tree

```
monoagentcli login <platform> [--timeout 3m]        # instagram|linkedin|x|tiktok|telegram|email|gemini
monoagentcli login status
monoagentcli logout [platform] [--all]

monoagentcli search <platform> --keyword TEXT [--max 50] [--timeout 10m]
monoagentcli message <platform> <username> --text TEXT [--timeout 10m]
monoagentcli comment <platform> <post-url...> --text TEXT [--timeout 10m]

monoagentcli run [action-id] [--file PATH] [--queue] [--watch --interval 30s] [--timeout 10m] [--param k=v ...]
monoagentcli action list|get <id>|create --type --platform [--keyword] [--message]|import --file PATH
monoagentcli action pause|resume|delete <id>
monoagentcli action targets <id>
monoagentcli action template capture <url> [--headless] [--wait 8] [--out PATH]
monoagentcli action template install <file>          # writes ~/.monoes/actions/<platform>/<type>.json
monoagentcli action template list

monoagentcli crawl <url> [--headless] [--wait 8]     # standalone HTML capture for ActionDef authoring

monoagentcli workflow list [--json]
monoagentcli workflow get <id>
monoagentcli workflow create <name> [--description] [--active]
monoagentcli workflow import [--file PATH] [--overwrite]   # reads stdin if no --file
monoagentcli workflow export <id> [--output PATH]
monoagentcli workflow run <id>                       # positional — NOT --id
monoagentcli workflow activate <id> / deactivate <id>
monoagentcli workflow delete <id> [--force]
monoagentcli workflow executions <workflow-id> [--limit 20] [--json]
monoagentcli workflow migrate                        # SQLite store -> ~/.monoes/workflows/*.json
monoagentcli workflow node add <workflow-id> --type --name [--config json] [--x] [--y]
monoagentcli workflow node list <workflow-id>
monoagentcli workflow node set <workflow-id> <node-id> [--config] [--name] [--x] [--y]
monoagentcli workflow node remove <workflow-id> <node-id>
monoagentcli workflow connect <workflow-id> --from nodeID[:handle] --to nodeID[:handle]
monoagentcli workflow disconnect <workflow-id> <connection-id>

monoagentcli node list [--filter STRING]             # control.* data.* http.* db.* comm.* ai.* image.* instagram.* ...
monoagentcli node run <node-type> [--config json] [--input json] [--output pretty|json|jsonl] [--credential id-or-platform]

monoagentcli connect <platform>
monoagentcli connect list [--platform] [--json] [--all]
monoagentcli connect test <id> / remove <id> / refresh <id> [--timeout 5m]

monoagentcli people list [-p platform] [-n 50] / get <id> / delete <id> / import --file --platform
monoagentcli list ls / create --name / show <id> / delete <id> / add-item <list-id> --username --platform
monoagentcli template list / get <id> / create --name --body [--subject] / delete <id>
monoagentcli config list / get <name> / set <name> <value> / delete <name>
monoagentcli schedule list / add <action-id> --cron "..." [--start-date] [--end-date] / remove <action-id>

monoagentcli export [--output-dir PATH]              # always writes people_export.json + actions_export.json
monoagentcli status [--json]
monoagentcli version
monoagentcli update                                  # self-update from monoes/mono-agent GitHub releases
monoagentcli init [--claude]                         # installs action-template-generator skill into ~/.claude/skills/
monoagentcli profile list / create <name> / switch <name-or-id> / current

monoagentcli ref commands|nodes|node <type>|workflow|expressions|examples|crawling   # offline docs, no side effects
```

## Examples

```bash
# One-time login, then a quick search
monoagentcli login instagram
monoagentcli search instagram --keyword "golang developer" --max 50

# One-off DM / comment
monoagentcli message instagram johndoe --text "hello"
monoagentcli comment instagram https://instagram.com/p/xyz --text "nice!"

# Free-tier AI node via Gemini browser automation (no API key)
monoagentcli login gemini
monoagentcli node run gemini.generate_text --config '{"prompt":"Summarize AI news today"}'

# Workflow lifecycle
monoagentcli workflow list
monoagentcli workflow run <workflow-id>
monoagentcli workflow activate <workflow-id>     # registers cron/webhook triggers for this process's lifetime

# Connect an API service and inspect connections
monoagentcli connect github
monoagentcli connect list --all

# When unsure, check the CLI's own docs instead of guessing
monoagentcli ref commands
monoagentcli ref node gemini.generate_image
```

## Gotchas (verified against source and the live GitHub release)

- Binary name is `monoagentcli` — not `monoes`, not `monoagent`. The repo's own README.md still shows `monoes` in its examples (pre-rename); the Makefile, `root.go`'s Cobra `Use:` field, `release.yml`, and the actual assets on the latest GitHub release (`v0.10.3`) all confirm `monoagentcli`.
- Prebuilt binaries exist — no need to build from source if a release matches your platform:
  ```bash
  curl -fsSL https://github.com/monoes/mono-agent/releases/latest/download/monoagentcli-darwin-arm64 -o monoagentcli
  chmod +x monoagentcli && sudo mv monoagentcli /usr/local/bin/
  ```
  (Also available: `-darwin-amd64`, `-linux-amd64`, `-windows-amd64.exe`. Desktop app "MonoAgent" ships separately as `MonoAgent-darwin-arm64.zip` / `-linux-amd64.tar.gz` / `-windows-amd64.exe`.)
- `workflow run/get/export`, `workflow node add/connect`, and `node run` take **positional** arguments (`workflow run <id>`, `node run <node-type>`). The README's "CLI Reference" section shows `--id`/`--type`/`--from`/`--to` flag forms that don't match the actual Cobra signatures — don't copy that section literally.
- There is **no `schedule run` daemon command**, despite `monoagentcli ref workflow`/`ref examples` referencing one. Cron execution only happens via `trigger.schedule` nodes inside a `workflow activate`d workflow, which only fires while that process is alive.
- `export` always writes `people_export.json` + `actions_export.json` — there's no `--format csv`.
- `people import` requires **both** `--file` and `--platform`.
- No standalone always-on daemon ships with the CLI; `run --watch --interval` (polls pending actions) and `workflow activate` (in-process scheduler) are the closest things — the Wails desktop app ("MonoAgent") is the real long-running host in normal use.
- `monoagentcli update` self-updates from the latest `monoes/mono-agent` GitHub release — prefer it over re-running the install command.
- `monoagentcli ref commands`' built-in flag/usage docs (the hardcoded `cliDocs` table in `ref.go`) are hand-maintained and stale for several commands — they describe flags that don't exist on the real Cobra definitions (e.g. claims `run` takes `--platform`/`--list`/`--text`, `search` takes `--limit`/`--output`, `message`/`comment` take `--list`/`--delay`, `people` has `add`/`export`/`remove` subcommands instead of the real `list`/`get`/`delete`/`import`, `list create` takes a positional name instead of `--name`, and `export` supports `--format csv`). Don't rely on `ref commands` for exact flag names — use `--help` on the actual subcommand instead. `ref nodes` / `ref node <type>` is a separate, accurate code path.

## See Also

- `/monoes:install` — install mono-agent if the `monoagentcli` binary isn't found
- `../mono-agent/README.md` — mostly accurate for feature scope, but stale on the binary name and some flag shapes; verify against `cmd/monoagentcli/root.go` / `ref.go` if something looks off

---
name: monoes:monotask
description: Drive the monotask CLI — a local-first, P2P kanban board (boards/columns/cards, spaces, GitHub/Linear/mail sync)
---

# monoes monotask

Interact with **monotask** — a Rust CLI (binary `monotask`, source at `../monotask`) for a local-first, P2P kanban board. Not installed? Run `/monoes:install` first.

Given the user's request in `$ARGUMENTS`, pick the matching command(s) below and run them via Bash. When uncertain, run `monotask ai-help --json` — it introspects the live CLI definition, so it never drifts from the real command surface (unlike hand-written docs).

## Model

- Local-first: every board/column/card lives as an Automerge CRDT doc in SQLite in the OS data dir (Linux: `~/.local/share/monotask/`; **macOS: `~/Library/Application Support/monotask/`**; Windows: `%APPDATA%\monotask\`) — override with global `--data-dir`.
- Identity is an Ed25519 keypair, auto-generated on first use (or `profile import-ssh-key`).
- **Boards must belong to a Space** — `board create` requires `--space <SPACE_ID>`, so `space create` comes first.
- The CLI does **not** sync between users by itself — that needs the `monotask sync` daemon or the desktop (Tauri) app running.
- IDs are UUID v4 for everything except: Attachment IDs (6-char hex, `img:<id>`) and the human-readable card number (`<prefix>-<seq>`, display-only, not a valid ID for commands).
- Pass `--json` on any command for structured output — recommended when scripting (e.g. piping through `jq`).

## Command tree

```
monotask [--data-dir PATH] init | version | ai-help [--json] [--section commands|schemas|workflows|gotchas]

monotask board create <title> --space SPACE_ID [--json]
monotask board list|rename <id> <new-title>|delete <id> --space SPACE_ID|schema <id>|undo <id>|redo <id>

monotask column create|list|rename|delete <board-id> [...]

monotask card create <board-id> <col-id> <title> [--field NAME=VALUE ...] [--json]
monotask card list <board-id> [--col ID] [--label L] [--where "FIELD_REF(=|!=|>|>=|<|<=|~)VALUE" ...]
monotask card view|rename|delete|archive <board-id> <card-id>
monotask card copy|move <board-id> <card-id> <target-col-id>
monotask card set-description|set-cover|set-due-date <board-id> <card-id> <value>
monotask card set-priority <board-id> <card-id> low|medium|high|none      # legacy string priority
monotask card set-impact|set-effort <board-id> <card-id> 0-10             # priority = floor((impact+10-effort)/2)
monotask card set-direct-priority <board-id> <card-id> [0-10] [--clear]
monotask card clear-priority <board-id> <card-id>                        # clears impact+effort+direct_priority
monotask card set-assignee <board-id> <card-id> <pubkey-hex|none>
monotask card attach-image <board-id> <card-id> <file>                   # png/jpg/jpeg/gif/webp/svg
monotask card list-attachments|save-attachment <board-id> <card-id> [<attachment-id>]
monotask card mentions <board-id> <card-id>
monotask card field-set <board-id> <card-id> <field-ref> <value>
monotask card field-get|field-clear <board-id> <card-id> <field-ref>
monotask card field-list <board-id> <card-id>
monotask card upsert <board-id> <col-id> <title> --match-field REF --match-value V [--field NAME=V ...]
monotask card label add|remove|list <board-id> <card-id> [label]
monotask card comment add|list|delete|edit <board-id> <card-id> [...]
monotask card subtask add <parent-board> <parent-card> <child-board> <col-id> <title> | list <board-id> <card-id>
monotask card link add|list|remove <board-id> <card-id> <target-board> <target-card>
monotask card prerequisite add|list|remove <board-id> <card-id> <prereq-board> <prereq-card>

monotask checklist add <board-id> <card-id> <title>
monotask checklist item-add|item-check|item-uncheck|item-delete <board-id> <card-id> <checklist-id> [item-id] [text]
monotask checklist delete <board-id> <card-id> <checklist-id>

monotask field create <board-id> <name> [--field-type text|number|date|select|multi_select|checkbox] [--option V ...] [--default-value V] [--auto-apply]
monotask field list <board-id>
monotask field rename <board-id> <field-ref> <new-name>
monotask field delete|backfill <board-id> <field-ref>
monotask field update <board-id> <field-ref> [--default-value V] [--auto-apply true|false]

monotask space create <name>
monotask space list|info <id>
monotask space invite generate <id> | export <id> <output.space> | revoke <id>
monotask space join <token-or-file>
monotask space boards add|remove|list <space-id> [<board-id>]
monotask space members list <space-id> | kick <space-id> <pubkey>

monotask profile show | set-name <name> | set-avatar <path> | import-ssh-key [path]

monotask github connect [token]        # prefer: echo "$TOKEN" | monotask github connect
monotask github status | link <board-id> <owner> <repo> --done-col COL | unlink <board-id> | sync <board-id>

monotask linear connect [token]        # prefer stdin
monotask linear status | teams | projects <team-id>
monotask linear link <board-id> --team ID --project ID [--done-col COL] | unlink <board-id> | sync <board-id>

monotask mail gmail-connect --client-id ID [--no-wait]
monotask mail outlook-connect --client-id ID [--tenant-id common] [--no-wait]
monotask mail oauth-complete --provider gmail|outlook --code CODE     # finishes a --no-wait flow
monotask mail status | disconnect gmail|outlook
monotask mail link <board-id> [--provider both|gmail|outlook|imap] [--inbox-col COL] [--keep-last 2] [...]
monotask mail imap-connect --host H --username U [--port 993] [--password P] [--folder INBOX]
monotask mail imap-status | imap-disconnect | unlink <board-id> | sync <board-id>

monotask app open <url>                # monotask://board/<id> or monotask://board/<id>/card/<id>

monotask chat send <space-id> <text> | list <space-id> [--limit 50]

monotask sync [--detach] [--stop] [--status] [--port 0] [--peer /ip4/.../tcp/... ...]
```

## Examples

```bash
# First-time setup: identity, space, board, column, card
monotask profile set-name "Ada"
SPACE=$(monotask space create "Personal" --json | jq -r .id)
BOARD=$(monotask board create "Sprint 1" --space $SPACE --json | jq -r .id)
TODO=$(monotask column create $BOARD "Todo" --json | jq -r .id)
monotask card create $BOARD $TODO "Write onboarding docs" --json

# Triage: list, prioritize, move
monotask card list $BOARD --col $TODO --json
monotask card set-impact $BOARD $CARD 8
monotask card set-effort $BOARD $CARD 3
monotask card move $BOARD $CARD $DOING_COL

# Invite a teammate into a shared space
monotask space invite export $SPACE team-invite.space
# teammate runs: monotask space join team-invite.space

# Wire up GitHub Issues sync
echo "$GITHUB_TOKEN" | monotask github connect --json
monotask github link $BOARD myorg myrepo --done-col $DONE_COL --json
monotask github sync $BOARD --json

# When unsure, ask the CLI itself
monotask ai-help --section commands
```

## Gotchas (verified against source)

- The clap `Parser` name is `monotaskcli` and `ai-help`'s own examples print that name — but invoke it as `monotask`. **This is only automatic for a source build that renames the binary during install** (per the tool's own README) — the Homebrew formula installs the raw binary as `monotaskcli` verbatim and does not create a `monotask` alias, and won't even auto-link it into `PATH` if the `monotask` cask (desktop app) is also installed. If `command -v monotask` comes up empty after `brew install monoes/tap/monotask`, symlink it manually: `ln -sf "$(brew --cellar)"/monotask/*/bin/monotaskcli "$(brew --prefix)/bin/monotask"`.
- Exit codes: `0` success, `1` generic error, `2` not_found, `3` invalid_input, `4` io_error. **With `--json`, errors print to stdout** as `{"ok":false,"error":"...","kind":"..."}`; without it, errors go to stderr as plain text.
- `card create` currently stamps a placeholder `"aaaa"` card-number prefix — known incomplete, per the tool's own gotchas.
- `card view --json`'s `number` field is `{"prefix":..,"seq":..}`, not the display string.
- `field backfill` only fills cards with **no** existing value — never overwrites a stale one.
- Pipe secrets via stdin (`echo "$TOKEN" | monotask github connect`), not as a positional arg — avoids shell-history/`ps` exposure. Same for `linear connect` and `mail imap-connect --password`.
- Real cross-machine sync requires `monotask sync` (a daemon, not automatic) or the desktop app — the CLI alone only mutates the local CRDT store.

## See Also

- `/monoes:install` — install monotask if the `monotask` binary isn't found
- `../monotask/README.md`, `crates/monotask-cli/src/main.rs` — source of truth if `ai-help` output looks incomplete

---
name: mastermind-monotask
description: Authoritative monotask CLI reference for mastermind agents — boards, columns, cards (with filters, subtasks, prerequisites, scoring, attachments), spaces, GitHub/Linear sync, and common agent workflows. Version 1.1.4.
type: reference-skill
---

# Monotask CLI — Agent Reference (v1.1.4)

Monotask is a P2P local-first task manager. All data is stored in SQLite (`~/.local/share/monotask/monotask.db`). Always use `--json` for machine-readable output.

---

## Global Flags

```
--data-dir <PATH>   Override storage directory (must be consistent per instance)
```

---

## Board

```bash
# Create — returns {id, title, deep_link}
monotask board create "Sprint 42" --json

# List — returns [{id, title}] (search by title with jq .title)
monotask board list --json

# Rename
monotask board rename <BOARD_ID> "New Title" --json
```

---

## Column

```bash
# Create — returns {id, board_id}
monotask column create <BOARD_ID> "Todo" --json

# List — returns [{id, title, card_ids:[]}]  ← field is "title", NOT "name"
monotask column list <BOARD_ID> --json

# Rename
monotask column rename <BOARD_ID> <COL_ID> "New Title" --json

# Delete (soft-deletes all cards in it)
monotask column delete <BOARD_ID> <COL_ID> --json
```

---

## Card

### Listing

```bash
# All cards in board (flat, includes col_id + col_title per card)
monotask card list <BOARD_ID> --json

# Filter by column (server-side, fast)
monotask card list <BOARD_ID> --col <COL_ID> --json

# Filter by label (server-side, exact match)
monotask card list <BOARD_ID> --label "role:writer" --json

# Combine filters
monotask card list <BOARD_ID> --col <TODO_COL> --label "role:reviewer" --json
```

JSON schema per item from `card list`:
```json
{ "id":"<uuid>", "title":"<str>", "col_id":"<uuid>", "col_title":"<str>",
  "labels":[], "due_date":null, "impact":null, "effort":null, "direct_priority":null }
```

### Create / View / Move

```bash
# Create — returns {id, title, board_id, number}
CARD=$(monotask card create <BOARD_ID> <COL_ID> "Task title" --json | jq -r .id)

# View full card (includes parent + subtasks)
monotask card view <BOARD_ID> <CARD_ID> --json

# Move to different column (auto-detects current column)
monotask card move <BOARD_ID> <CARD_ID> <TO_COL_ID> --json

# Copy to another column (same board)
monotask card copy <BOARD_ID> <CARD_ID> <TARGET_COL_ID> --json

# Rename
monotask card rename <BOARD_ID> <CARD_ID> "New title" --json

# Soft-delete (hidden from all views)
monotask card delete <BOARD_ID> <CARD_ID> --json

# Soft-archive (hidden from normal views)
monotask card archive <BOARD_ID> <CARD_ID> --json
```

### Metadata

```bash
monotask card set-description <BOARD_ID> <CARD_ID> "Markdown text" --json
monotask card set-due-date    <BOARD_ID> <CARD_ID> "2026-06-01" --json  # "none" to clear
monotask card set-cover       <BOARD_ID> <CARD_ID> "#e74c3c" --json     # "none" to clear
```

### Priority / Scoring

```bash
# ICE scoring: priority = floor((impact + 10 - effort) / 2), range 0–10
monotask card set-impact  <BOARD_ID> <CARD_ID> 8 --json
monotask card set-effort  <BOARD_ID> <CARD_ID> 3 --json

# Direct priority (bypasses impact/effort)
monotask card set-direct-priority <BOARD_ID> <CARD_ID> 9 --json
monotask card set-direct-priority <BOARD_ID> <CARD_ID> --clear --json

# Clear all scoring
monotask card clear-priority <BOARD_ID> <CARD_ID> --json
```

### Labels

```bash
monotask card label add    <BOARD_ID> <CARD_ID> "role:writer" --json
monotask card label remove <BOARD_ID> <CARD_ID> "role:writer" --json
monotask card label list   <BOARD_ID> <CARD_ID> --json  # → ["str",...]
```

**Convention for org agents:**
- `role:<role_id>` — which role should handle this card
- `claimed` — card has been picked up by an agent (in Doing column)

### Assignee

```bash
# PUBKEY = 64-char hex (get via: monotask profile show)
monotask card set-assignee <BOARD_ID> <CARD_ID> <PUBKEY> --json
monotask card set-assignee <BOARD_ID> <CARD_ID> none --json  # clear
```

### Comments

```bash
monotask card comment add    <BOARD_ID> <CARD_ID> "text" --json
monotask card comment list   <BOARD_ID> <CARD_ID> --json
monotask card comment delete <BOARD_ID> <CARD_ID> <COMMENT_ID> --json
```

### Subtasks (parent/child hierarchy)

```bash
# Create a subtask (new card linked as child of PARENT_CARD)
monotask card subtask add <PARENT_BOARD> <PARENT_CARD> <CHILD_BOARD> <COL_ID> "Subtask title" --json
# → returns {id, title, board_id}

# List subtasks of a card
monotask card subtask list <BOARD_ID> <CARD_ID> --json
# → [{board_id, card_id},...]

# card view includes "subtasks" and "parent" fields automatically
```

### Prerequisites (dependency ordering)

```bash
# PREREQ_CARD must be Done before CARD can be claimed
monotask card prerequisite add    <BOARD_ID> <CARD_ID> <PREREQ_BOARD> <PREREQ_CARD_ID> --json
monotask card prerequisite list   <BOARD_ID> <CARD_ID> --json  # → [{board_id, card_id},...]
monotask card prerequisite remove <BOARD_ID> <CARD_ID> <PREREQ_BOARD> <PREREQ_CARD_ID> --json
```

### Attachments

```bash
# Attach image (stored as base64; returns img:<6char-id> token for markdown)
ATT=$(monotask card attach-image <BOARD_ID> <CARD_ID> screenshot.png --json | jq -r .token)
monotask card set-description <BOARD_ID> <CARD_ID> "See: ![$ATT]($ATT)"

monotask card list-attachments <BOARD_ID> <CARD_ID> --json
monotask card save-attachment  <BOARD_ID> <CARD_ID> <ATTACHMENT_ID> --output ./out.png
```

### Checklists

```bash
CL=$(monotask checklist add      <BOARD_ID> <CARD_ID> "Definition of Done" --json | jq -r .id)
ITEM=$(monotask checklist item-add   <BOARD_ID> <CARD_ID> $CL "Write tests" --json | jq -r .id)
monotask checklist item-check   <BOARD_ID> <CARD_ID> $CL $ITEM
monotask checklist item-uncheck <BOARD_ID> <CARD_ID> $CL $ITEM
```

---

## Space (Collaboration)

```bash
# Create / list
monotask space create "Team Name"
monotask space list   # → "<id> | <name> | <N> members"
monotask space info <SPACE_ID>

# Associate boards
monotask space boards add    <SPACE_ID> <BOARD_ID>
monotask space boards remove <SPACE_ID> <BOARD_ID>
monotask space boards list   <SPACE_ID>

# Invite / join
monotask space invite export  <SPACE_ID> invite.space  # preferred (includes space doc)
monotask space invite generate <SPACE_ID>               # token only
monotask space invite revoke   <SPACE_ID>
monotask space join invite.space                        # or raw token

# Members
monotask space members list <SPACE_ID>
monotask space members kick <SPACE_ID> <PUBKEY>
```

---

## GitHub Integration

```bash
monotask github connect ghp_yourtoken           # save token
monotask github repos                           # list accessible repos
monotask github link <BOARD_ID> <ORG> <REPO> --done-col <COL_ID>  # link repo
monotask github unlink <BOARD_ID>
monotask github sync <BOARD_ID>                 # bidirectional sync
```

---

## Linear Integration

```bash
monotask linear connect lin_api_yourkey         # save key
monotask linear status
monotask linear teams                           # list teams
monotask linear projects <TEAM_ID>
monotask linear link <BOARD_ID> --team <TEAM_ID> --project <PROJECT_ID> [--done-col <COL_ID>]
monotask linear unlink <BOARD_ID>
monotask linear sync <BOARD_ID>                 # bidirectional sync
```

---

## P2P Sync Daemon

```bash
monotask sync --detach --port 7272              # start background daemon
monotask sync --status
monotask sync --stop
monotask sync --peer /ip4/192.168.1.10/tcp/7272 # connect to known peer
```

---

## Profile

```bash
monotask profile show
monotask profile set-name "Alice"
monotask profile set-avatar ~/avatar.png
monotask profile import-ssh-key ~/.ssh/id_ed25519  # changes pubkey — run before joining spaces
```

---

## Common Agent Workflows

### Set up an org task board
```bash
BOARD=$(monotask board create "org-tasks" --json | jq -r .id)
TODO=$(monotask column create $BOARD "Todo"  --json | jq -r .id)
DOING=$(monotask column create $BOARD "Doing" --json | jq -r .id)
DONE=$(monotask column create $BOARD "Done"  --json | jq -r .id)
```

### Task assignment loop (boss agent pattern)
```bash
# List unclaimed Todo cards
monotask card list $BOARD --col $TODO --json | jq '[.[] | select(.labels | index("claimed") | not)]'

# Claim a card for a role agent
monotask card move $BOARD $CARD_ID $DOING
monotask card label add $BOARD $CARD_ID "claimed"

# Complete a card
monotask card move $BOARD $CARD_ID $DONE

# Find all cards for a specific role across all columns
monotask card list $BOARD --label "role:writer" --json
```

### Check prerequisites before claiming
```bash
# Get prereqs of a card
PREREQS=$(monotask card prerequisite list $BOARD $CARD_ID --json)
# Check all prereqs are in Done column
echo "$PREREQS" | jq -r '.[].card_id' | while read PREREQ_ID; do
  COL=$(monotask card list $BOARD --json | jq -r --arg id "$PREREQ_ID" '.[] | select(.id==$id) | .col_id')
  [ "$COL" != "$DONE" ] && echo "BLOCKED: $PREREQ_ID not done" && exit 1
done
```

### Find board by title
```bash
BOARD_ID=$(monotask board list --json | jq -r '.[] | select(.title=="org-tasks") | .id')
```

### Find column by title  (field is "title", NOT "name")
```bash
COLS=$(monotask column list $BOARD --json)
TODO=$(echo "$COLS" | jq -r '.[] | select(.title=="Todo") | .id')
DONE=$(echo "$COLS" | jq -r '.[] | select(.title=="Done") | .id')
```

---

## ID Formats

| Type | Format |
|---|---|
| Board / Column / Card / Space / Comment / Checklist | UUID v4 |
| Attachment | 6-char hex (reference as `img:<id>` in markdown) |
| Card number | `<prefix>-<seq>` — human display only; CLI requires full UUID |

## HLC Timestamps

All `created_at` fields use Hybrid Logical Clock format `<wall_ms_hex>-<logical_hex>`.

```js
ms = parseInt(hlc.split('-')[0], 16)     // → Unix ms
new Date(ms).toISOString()               // → ISO date
```

## Error Handling

All commands exit 0 on success, non-zero on error. Errors go to stderr (never mixed into `--json` stdout). Common causes: ID not found, invalid UUID, corrupted board file, invalid invite token.

## Key Limitations

- CLI operates on **local data only** — P2P sync requires the desktop app or `sync --detach`
- `card create` uses placeholder prefix `"aaaa"` for card numbers (full identity wiring planned)
- No `board delete` command — orphaned boards must be removed via SQLite directly
- `card move` auto-detects current column — no need to specify source column

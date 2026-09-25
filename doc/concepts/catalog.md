# Skill Catalog

> A policy-governed catalog for imported and locally authored skills,
> archetypes and blueprints. Every entry carries its provenance, a lifecycle
> status, a content digest, the consumers it may reach (targets) and the tools
> it is granted. Nothing changes until an operator activates an entry: with no
> catalog state, every consumer behaves exactly as before.

The catalog is **machine-local** and lives in `.monomind/catalog/`. It feeds
exactly three seams: the Org skill library, the Jev decision model (only with
the `jev` target) and explicit projections into `.claude/skills` and
`.agents/skills`.

For where hand-written agents, skills and Org skills live without the catalog, see [Agents & Skills](./agents-and-skills.md).

Command: [`catalogCommand`](packages/@monomind/cli/src/commands/catalog.ts#catalogCommand).
Source: [`packages/@monomind/cli/src/catalog/`](packages/@monomind/cli/src/catalog/).

---

## 1. Ownership

| Layer | Owns | Notes |
|---|---|---|
| Package bytes — `.monomind/catalog/packages/<name>/<sha12>/` | name, description, tags, instructions, requested tools | Immutable: the directory name is the first 12 hex digits of the content digest |
| `.monomind/catalog/state.json` | kind, lifecycle status, source provenance, `sha256`, inspection, targets, `grantedTools`, `replacesLegacy`, history | The only file the lifecycle verbs write; written atomically under `.monomind/locks/catalog.lock` |
| Snapshot, `catalog audit`, `doctor -c catalog` | nothing | Rebuilt from the two layers above |
| `.claude/skills`, `.agents/skills` | nothing the catalog reads | Projections only |

Legacy agents, the bundled `org-skills/` and `.monomind/org-skills/` stay
legacy. The catalog never moves, deletes, symlinks or rewrites them; `audit`
lists them only as collision context.

### Package store layout

```text
.monomind/catalog/
  state.json
  packages/
    <name>/<sha12>/
      SKILL.md                       # skill or archetype (+ other *.md references)
      blueprint.json                 # blueprint
      LICENSE.txt                    # MIT or Apache-2.0 text, required
```

A package is Markdown plus a license text. Scripts, binaries, MCP servers,
hooks, symlinks and agent-execution configuration are rejected at staging.
Files and directories whose name starts with `.` (a nested `.claude/`, for
example) are dropped. Platforms read execution config from `SKILL.md`
frontmatter (`hooks`, `allowed-tools`, `model`, `context`, `agent`, …), so
staging rewrites the frontmatter of every `SKILL.md` in the package (the root
one and any nested one), before hashing, to the allow-list
[`ALLOWED_FRONTMATTER_KEYS`](packages/@monomind/cli/src/catalog/frontmatter.ts#ALLOWED_FRONTMATTER_KEYS)
— `name`, `description`, `tags`, `tools`, `license`, one line each — and keeps
the body byte-for-byte. Each dropped key is listed under `rejected`. A package
containing projection-marker text (`<!-- catalog `, `monomind:start`,
`monomind:end`) is refused, so it cannot forge a marker. A package whose
Markdown carries shell execution syntax — an inline `` !`cmd` `` or a
` ```! ` run anywhere in the text (a blockquote, a list item or inline) or a
`~~~!` fenced block, which Claude Code runs when the skill loads — is refused with `body-exec`.
Claude Code substitutes `$ARGUMENTS`, `$ARGUMENTS[n]`, `$n` and `${CLAUDE_…}`
before it looks for runs (a skill preload substitutes an empty string), so a
placeholder directly after a `!`, or among the spaces, backticks and tildes
before one, is refused the same way: ```` ``$ARGUMENTS`! ```` becomes ` ```! `.
Claude Code ends a skill's frontmatter at the first `---` anywhere, even in
the middle of a value, and reads the rest as body, so these checks also run on
the body Claude Code would cut from the file. A frontmatter line that contains
`---` is refused with `frontmatter-not-allowed` at staging and at projection —
a harmless `description: "a --- b"` included (write `--` or `—` instead) — as
is a value holding a U+2028 or U+2029 line separator.
Every consumer re-verifies the digest of the package it reads, and a package
path that escapes `packages/` (via `..`, an absolute segment or a symlink,
checked on `realpath`) is never read.

### Machine-local scope and committed Org JSON

`state.json` and the package store are not meant to be committed. An Org
definition that names a catalog skill, archetype or blueprint therefore only
validates on a machine where that entry is active for `org`; elsewhere
`org validate` reports `unknown skill` or `blueprint "<name>" is not active
for org on this machine`. Org JSON tracked in this repository names only
library (non-catalog) skills, and `tests/orgrt/org-skill-refs.test.ts`
enforces that.

---

## 2. Lifecycle

| From | To | Command | Precondition |
|---|---|---|---|
| — | staged | `stage` | scan verdict clean |
| — | quarantined | `stage` | scan verdict quarantine, or the scanner failed or is unavailable |
| staged | approved | `approve` | at least one target; `jev` requires `org`; `platform:*` only for skills; grants ⊆ requested ∩ grantable |
| staged | quarantined | `quarantine` | `--reason` |
| quarantined | staged | `release` | `--reason`; records `inspection.override` {actor, reason, at} for this revision |
| approved | active | `activate` | the package exists and its digest verifies |
| approved, active | disabled | `disable` | — |
| disabled | active | `activate` | the digest verifies |
| staged, quarantined, disabled | staged | `stage` (changed content) | the new revision replaces the old; approval, targets and grants are cleared |
| any but revoked | revoked | `revoke` | `--reason`; terminal for the id |

Only `active` entries whose digest verifies and whose `targets` name a
consumer reach that consumer. Nothing is discovered automatically, and no scan
result or model output ever changes a status — only these commands do.

`--actor` is **self-asserted**: it is recorded in the entry's history (the
last 20 transitions) but not authenticated. The catalog records who said they
acted, not who did.

---

## 3. Commands

All verbs take `--format json` for machine-readable output. Read-only verbs
never create files; only a mutating verb creates `.monomind/catalog/`.

| Command | Effect |
|---|---|
| `monomind catalog list [--target <t>]` | Every entry, or only those eligible for one target |
| `monomind catalog show <id>` | One entry: digest, source, inspection summary, grants, history |
| `monomind catalog search <text> [--target <t>] [--limit n]` | Ranked by the same scorer as `org skills search`; revoked entries excluded |
| `monomind catalog audit` | Re-hashes every entry; exits non-zero when an active entry has a problem |
| `monomind catalog stage <owner/repo\|git-url\|path> --actor <name> [--only <name>] [--kind skill\|archetype\|blueprint]` | Copies one candidate into the store and records it staged or quarantined |
| `monomind catalog inspect <id>` | The stored inspection (see §4) |
| `monomind catalog approve <id> --target <t> [--target <t>]… [--grant-tool <tool>]… [--replaces-legacy] --actor <name>` | staged → approved; prints what each target will expose |
| `monomind catalog activate <id> --actor <name>` | approved/disabled → active |
| `monomind catalog disable <id> --actor <name> [--reason <text>]` | approved/active → disabled |
| `monomind catalog quarantine <id> --actor <name> --reason <text>` | staged → quarantined |
| `monomind catalog release <id> --actor <name> --reason <text>` | quarantined → staged, with an override record |
| `monomind catalog revoke <id> --actor <name> --reason <text>` | Terminal; package bytes are kept |
| `monomind catalog project --surface platform:claude\|platform:agents [--apply]` | Plans (default) or writes the projection of every eligible skill, and removes projected copies that are no longer eligible |
| `monomind catalog unproject <id> --surface … [--apply]` | Removes one projected copy |
| `monomind doctor -c catalog` | Health check (see §8) |

`stage` fetches a Git source with the same checkout as
`monomind org skills import` and records the fetched `HEAD` commit; a local
path is recorded with its commit when it is a Git work tree. The candidate is
copied first and the copy is what gets inspected, hashed and stored, so a
source edited mid-stage cannot reach the store. A URL carrying credentials
(`https://user:token@host/…`) is refused rather than recorded; use a Git
credential helper.

`monomind org skills import` remains the **immediate legacy importer**: it
writes straight into `.monomind/org-skills/` (`~/.monomind/org-skills/` with
`--global`) with no lifecycle, targets or grants. Use the catalog when you want the approval gate.

---

## 4. Reading an inspection

`monomind catalog inspect <id>` prints what staging found:

| Field | Meaning |
|---|---|
| `verdict` | `clean` or `quarantine`. A blocked scan, a scanner error, an unavailable scanner, or Markdown too large to scan in full (over 200,000 characters; summary `not fully scanned`) all yield `quarantine` |
| `accepted` | Files kept in the package |
| `rejected` | Files dropped, with the reason (`symlink`, `excluded directory`, `not a regular file`, `not Markdown or LICENSE.txt`, …), and `SKILL.md (frontmatter <key>)` for each frontmatter key removed |
| `requestedTools` | The `tools:` the package's frontmatter asks for — requested, **not** granted |
| `scanner` | Whether the monofence scanner ran, whether it blocked, and a short summary |
| `override` | Present only after `release`: who accepted this revision despite the verdict, and why |

A quarantined entry can only move on through `release` (a human decision with
a reason) or `revoke`. Restaging changed content clears the override.

---

## 5. Targets and grants

| Target | Exposes the entry to |
|---|---|
| `org` | The Org skill library: roles that name it in `skills` or `skill_pool`, `org skills list/search`, per-task skill suggestions, and blueprint resolution |
| `jev` | The configured decision model may receive its name and a description of at most 200 characters. Requires `org`. Without `jev`, catalog content is never sent to a model — on the Org path (`jevVisible`) or through a projected tree: the per-prompt Jev pick checks `.monomind/catalog/state.json` and skips a projected skill (its skill-registry entry or its `SKILL.md` carries the catalog marker) whose entry is not active with `jev`, so disabling, revoking or re-approving without `jev` takes effect at once, before the copy is removed. A hand-written, unmarked skill that only shares a catalog entry's name is not affected: legacy roots keep precedence |
| `platform:claude` | `.claude/skills/<name>/`, read by Claude Code. The projected skill also enters `.claude/helpers/skill-registry.json`, the one skill index the `[PICK]` hook, `monomind pick` and the `pick` MCP tool rank (as an ordinary skill for keyword ranking; for Jev only when the entry also has `jev`). A catalog skill in the index's Org list is ranked only while its entry is active with `jev` and its package verifies |
| `platform:agents` | `.agents/skills/<name>/`, read by every adapter that uses the shared skill root: Codex, Gemini, Kimi, OpenCode, Cursor, Copilot, VS Code, OpenClaw, Droid, Hermes, Antigravity and Zed |

Other readers of a projected tree see it as ordinary platform content; the
catalog cannot restrict them. `approve` prints this exposure list.

**Grants.** A catalog skill's effective `tools` are its `grantedTools`, never
the list it requests. `--grant-tool` accepts only a tool the package requests
**and** one of
[`CATALOG_GRANTABLE_TOOLS`](packages/@monomind/cli/src/catalog/types.ts#CATALOG_GRANTABLE_TOOLS):
`monograph_query`, `monograph_context`, `monograph_impact` and
`monograph_neighbors` — graph reads only. A role holding the skill gets the
monomind MCP server allow-listed to exactly those grants.

**Legacy collisions.** A catalog skill with the same name as a legacy skill
loses to it unless it was approved with `--replaces-legacy`. `audit` and
`doctor` report the collision.

---

## 6. Blueprints and archetypes

An **archetype** is a skill-shaped package of stable working-style guidance.
A **blueprint** is a `blueprint.json` naming an archetype, skills, a
`skill_pool`, optional `runtimeHints` and `recommendedPolicy`, and a
description — never prompts, commands, URLs, providers, `policy` or
`tool_providers` (staging rejects any unknown key).

A role opts in with `"blueprint": "<name>"`.
[`resolveOrgDefBlueprints`](packages/@monomind/cli/src/catalog/blueprints.ts#resolveOrgDefBlueprints)
runs where the Org definition is parsed — daemon start and hot reload,
checkpoint replay, `org validate` and `org run --dryRun` — and fills only what
the role leaves unset:

- `skills` ← `[archetype, ...blueprint.skills]` when the role has no `skills`
  (an explicit `skills: []` wins);
- `skill_pool` ← the blueprint's when the role has none;
- `policy` and `tool_providers` are never produced;
- `runtimeHints` and `recommendedPolicy` are printed by `org validate` and
  `org run --dryRun` as notes ending in `(not applied)` and are not applied.

The blueprint must be active for `org`, and every skill it names must resolve
in the library (a legacy skill or an active `org` catalog entry), or
validation fails. The Org JSON is never rewritten: the role keeps
its `blueprint` field. On hot reload, blueprint skills apply only to newly
added roles, because `skills` is not a reloadable field of a running role.

---

## 7. Projection

`catalog project` copies every active, verified `skill` entry whose targets
name the surface into that surface's skill root. Each projected `SKILL.md`
carries a managed marker block and a first body line recording the catalog
id, digest and `jev:` flag. Projection is explicit and reversible:

- the default is a dry run; `--apply` writes, under the platform mutation lock;
- a second apply with unchanged state changes zero files;
- foreign files, and same-name directories the catalog did not create, are
  never touched — the plan reports `not catalog-managed: <path>` instead;
- a package whose root or nested `SKILL.md` frontmatter has a top-level key
  other than `name`, `description`, `tags`, `tools` and `license` (for example
  `hooks`, `allowed-tools` or `model`), a flow-mapping header or a line
  containing `---`, is refused
  with `frontmatter-not-allowed`; one whose Markdown carries shell execution
  syntax is refused with `body-exec`. Either refusal also removes (and backs
  up) a copy an earlier projection left on disk; other refusals, such as
  `frontmatter-drift` or a digest mismatch, leave that copy in place;
- a projected `SKILL.md` whose frontmatter was edited by hand is skipped with
  `frontmatter-drift`; run `catalog unproject <id>` and then `catalog project`;
- projecting a new revision also removes the marked files that only the
  previous revision had;
- every changed or removed file is backed up under
  `.monomind/backups/<timestamp>-<pid>/`, at its path relative to the project;
- an apply that changes `.claude/skills` rebuilds
  `.claude/helpers/skill-registry.json` when the project already has one.

Only skills are projected; archetypes and blueprints are Org-only.

---

## 8. Doctor

`monomind doctor -c catalog`
([`checkCatalog`](packages/@monomind/cli/src/commands/doctor-catalog-checks.ts#checkCatalog))
re-hashes every entry and dry-plans both projection surfaces. It never writes.

| Condition | Status |
|---|---|
| No `state.json` | pass — "Not configured" |
| Only staged, approved or disabled entries | pass |
| An active entry with a digest mismatch, missing package, escaping path or any other `audit` problem; an unreadable state | fail — names the id and `monomind catalog disable <id>` |
| An active entry colliding with a legacy skill without `replacesLegacy` | warn |
| A staged or quarantined entry untouched for 30 days or more | warn |
| A projected copy whose entry is no longer eligible, or frontmatter drift | warn — names `monomind catalog project --surface <s> --apply` |

The check runs only when asked for with `-c catalog`; the full `doctor` run is
unchanged.

---

## 9. Procedures

**Add a skill for the Org library**

```bash
monomind catalog stage owner/skills-repo --only code-review --actor alice
monomind catalog inspect skill:code-review
monomind catalog approve skill:code-review --target org --grant-tool monograph_query --actor alice
monomind catalog activate skill:code-review --actor alice
monomind org skills list --format json   # origin "catalog", tools = the grants
```

**Update an entry** — disable, stage the new content, approve, activate:

```bash
monomind catalog disable skill:code-review --actor alice --reason "updating"
monomind catalog stage owner/skills-repo --only code-review --actor alice   # new revision, approval cleared
monomind catalog approve skill:code-review --target org --actor alice
monomind catalog activate skill:code-review --actor alice
```

**Take an entry out of use**

```bash
monomind catalog disable skill:code-review --actor alice --reason "no longer needed"   # reversible
monomind catalog revoke skill:code-review --actor alice --reason "withdrawn"            # terminal
```

Disabling or revoking removes eligibility immediately for the Org library and
Jev, including Jev picks over a projected Claude skill. The platform itself —
Claude Code or the `.agents` readers, and the keyword router through the skill
registry — keeps seeing a projected copy until the next `catalog project --apply`
removes it; `disable` and `revoke` print that command for every surface that
still holds a copy. Package bytes stay in the store.

**Remove a projected copy**

```bash
monomind catalog project --surface platform:claude --apply   # after disable/revoke: removes it
monomind catalog unproject skill:code-review --surface platform:claude --apply   # one entry, now
```

`unproject` alone does not change the entry: while it stays active for the
surface, the next `catalog project --apply` writes it again. Disable it, or
restage and approve without that target, to keep it out.

---

## 10. What the catalog does not do

No automatic discovery, download, approval, activation or projection; no
execution of imported scripts or MCP servers; no non-read-only tool grants;
no shared, git-tracked catalog; no projection for `.kiro/skills` or user
scope; `runtimeHints` and `recommendedPolicy` are never applied; `stage` does
not pin a requested ref (it records the fetched `HEAD`).

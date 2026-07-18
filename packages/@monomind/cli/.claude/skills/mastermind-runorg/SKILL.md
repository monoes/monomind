---
name: mastermind-runorg
description: Start a saved org via the Org Runtime v2 daemon (monomind org run/serve). Migrates v1-shaped configs first. The legacy prompt-orchestrated path lives in runorgv1.
type: domain-skill
default_mode: auto
---

# Mastermind Runorg (v2)

Starts orgs exclusively through the v2 SDK daemon. Every role becomes a live
SDK session; events reach the dashboard through the daemon's own forwarder —
no curl emissions, no delivery gaps.

## Steps

1. **Resolve the org.** `org_name` from params. List available orgs when missing:
   `monomind org list`.
2. **Shape-detect v1.** Do NOT rely on `monomind org validate` to catch v1
   configs — a v1-shaped config with no structural violations (unique role
   ids, one root, resolvable `reports_to`, parseable schedule) *passes*
   schema validation even though it's still v1. Detect v1-ness directly:
   `jq 'has("topology") or has("board_id") or has("loop") or ([.roles[]? | has("agent_type")] | any)' .monomind/orgs/<name>.json`
   - `true` → step 3 (migrate first).
   - `false` → step 4 (validate as-is).
3. **Migrate (v1 configs).** `monomind org migrate <name>` — original is kept
   as `<name>.v1.json`. In confirm mode ask first; in auto mode migrate and
   state it. If migration fails, stop and surface the error — do NOT fall back
   to runorgv1 silently.
4. **Validate.** Run `monomind org validate <name>` on the config (post-migration
   if step 3 ran).
   - Valid → step 5.
   - Invalid → surface the validator output and stop.
5. **Start.**
   - One-shot (no `schedule` in config): run in background bash:
     `monomind org run <name> --task "<optional task from params>"`
   - Scheduled (`schedule` set): ensure the daemon host is up:
     `monomind org serve` (background) — it picks up every scheduled org.
6. **Confirm liveness.** Within ~15 s: `monomind org status <name>` shows
   `running`. Surface the dashboard link (`<CTRL_URL>/orgs`) and
   `monomind org logs <name> --follow` as the tail command.
7. **Never** spawn a boss Task agent, create monotask boards, or emit
   dashboard events manually. If the user explicitly asks for the legacy
   behavior, direct them to `/mastermind:runorgv1` (deprecated).

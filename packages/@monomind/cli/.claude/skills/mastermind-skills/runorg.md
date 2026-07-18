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
2. **Validate.** Run `monomind org validate <name>`.
   - Valid → step 4.
   - Invalid AND the errors are v1-shape symptoms (`topology`, `board_id`,
     `loop`, role `agent_type` reported as unknown/legacy) → step 3.
   - Invalid otherwise → surface the validator output and stop.
3. **Migrate (v1 configs).** `monomind org migrate <name>` — original is kept
   as `<name>.v1.json`. In confirm mode ask first; in auto mode migrate and
   state it. If migration fails, stop and surface the error — do NOT fall back
   to runorgv1 silently.
4. **Start.**
   - One-shot (no `schedule` in config): run in background bash:
     `monomind org run <name> --task "<optional task from params>"`
   - Scheduled (`schedule` set): ensure the daemon host is up:
     `monomind org serve` (background) — it picks up every scheduled org.
5. **Confirm liveness.** Within ~15 s: `monomind org status <name>` shows
   `running`. Surface the dashboard link (`<CTRL_URL>/orgs`) and
   `monomind org logs <name> --follow` as the tail command.
6. **Never** spawn a boss Task agent, create monotask boards, or emit
   dashboard events manually. If the user explicitly asks for the legacy
   behavior, direct them to `/mastermind:runorgv1` (deprecated).

---
name: mastermind-runorg
description: Start a saved org via the Org Runtime daemon (monomind org run/serve). Converts legacy-format config files with monomind org migrate first.
type: domain-skill
default_mode: auto
---

# Mastermind Runorg

Starts orgs through the Org Runtime SDK daemon. Every role becomes a live
SDK session; events reach the dashboard through the daemon's own forwarder —
no curl emissions, no delivery gaps.

## Steps

1. **Resolve the org.** `org_name` from params. List available orgs when missing:
   `monomind org list`.
2. **Detect the legacy config format.** Do NOT rely on `monomind org validate`
   to catch legacy-format config files — one with no structural violations
   (unique role ids, one root, resolvable `reports_to`, parseable schedule)
   *passes* schema validation even though it still carries legacy fields.
   Detect them directly:
   `jq 'has("topology") or has("board_id") or has("loop") or ([.roles[]? | has("agent_type")] | any)' .monomind/orgs/<name>.json`
   - `true` → step 3 (migrate first).
   - `false` → step 4 (validate as-is).
3. **Migrate (legacy-format configs).** `monomind org migrate <name>` rewrites
   the file in the current format — the original is kept as `<name>.v1.json`.
   In confirm mode ask first; in auto mode migrate and state it. If migration
   fails, stop and surface the error.
4. **Validate.** Run `monomind org validate <name>` on the config (post-migration
   if step 3 ran).
   - Valid → step 5.
   - Invalid → surface the validator output and stop.
5. **Estimate scope and budget.** Before starting, read the numbers already sitting in
   the org config and print a short summary — this is a read-and-summarize step, not a
   spend prediction, so the user sees scope and the configured ceiling before any agent-hour
   is spent, not only after the run stops on a budget:
   ```bash
   orgFile=".monomind/orgs/<name>.json"
   roleCount=$(jq '.roles | length' "$orgFile")
   maxConcurrent=$(jq -r '.run_config.max_concurrent_agents // 4' "$orgFile")
   orgBudgetTokens=$(jq -r '.run_config.budget_tokens // 1000000' "$orgFile")
   roleBudgets=$(jq -r '.roles[] | "  - \(.id): budget_tokens=\(.budget_tokens // "org-default split"), budget_usd=\(.budget_usd // "none")"' "$orgFile")
   echo "About to run ${roleCount} role(s) (max ${maxConcurrent} concurrent)."
   echo "Org-wide token budget ceiling: ${orgBudgetTokens}"
   echo "Per-role overrides:"
   echo "${roleBudgets}"
   ```
   Print this summary unconditionally (auto and confirm mode alike) before step 6.
6. **Start.**
   - One-shot (no `schedule` in config): run in background bash:
     `monomind org run <name> --task "<optional task from params>"`
   - Scheduled (`schedule` set): ensure the daemon host is up:
     `monomind org serve` (background) — it picks up every scheduled org.
7. **Confirm liveness.** Within ~15 s: `monomind org status <name>` shows
   `running`. Surface the dashboard link (`<CTRL_URL>/orgs`) and
   `monomind org logs <name> --follow` as the tail command.
8. **Never** spawn a boss Task agent, create monotask boards, or emit
   dashboard events manually. The org daemon is the only way an org runs.

The org runtime does not read `<org>-issues.json`. Work is driven by the org
definition's roles and goal plus an optional `--task` string.

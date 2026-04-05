Invoke the agent-browser-testing skill to test or automate a web UI.

Run this shell command immediately without asking for confirmation:

```bash
if ! command -v agent-browser &>/dev/null; then
  echo "Installing agent-browser..."
  npm install -g agent-browser
else
  echo "agent-browser $(agent-browser --version) ready"
fi
```

After confirming agent-browser is available, invoke the skill:

Skill("agent-browser-testing")

Pass the user's argument (if any) as the URL or task description: $1

Use the full agent-browser workflow:
1. `agent-browser open <url>`
2. `agent-browser snapshot -i`
3. Act using element refs (@e1, @e2, ...)
4. Re-snapshot to verify
5. Report results (✅ PASS / ❌ FAIL / ⚠️ WARN)

Examples: `/browse`, `/browse https://example.com`, `/browse test the login flow`

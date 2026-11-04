# Authentication Patterns


Login flows, session persistence, OAuth, 2FA, and authenticated browsing.

**Related**: [monomind:browse](../browse.md), [session-management.md](session-management.md).

## Import Auth from Your Browser (Fastest)

Reuse cookies from a Chrome session you're already logged into.

**Step 1: Start Chrome with remote debugging**

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

Log in to your target site normally in this Chrome window.

> Security note: `--remote-debugging-port` exposes full browser control on localhost. Only use on trusted machines; close Chrome when done.

**Step 2: Save auth state**

```bash
npx monomind browse --auto-connect state save ./my-auth.json
```

**Step 3: Reuse in automation**

```bash
npx monomind browse --state ./my-auth.json open https://app.example.com/dashboard
```

## Auth Methods Quick Reference

| Method | Best For | How |
|---|---|---|
| Chrome profile reuse | Reuse existing Chrome login | `--profile Default` |
| Persistent profile | Full state across restarts | `--profile ./my-profile/` |
| Session persistence | Auto-save/restore by name | `--session-name myapp` |
| Import from browser | Grab auth from existing Chrome | `--auto-connect state save` |
| State file | Load saved state JSON | `--state ./auth.json` |
| Auth vault | Stored credentials (encrypted) | `auth login <name>` |
| Headers | Token-based auth, skip login form | `--headers '{"Authorization":"Bearer tok"}'` |

## Basic Login Flow

```bash
npx monomind browse open https://app.example.com/login
npx monomind browse snapshot -i
# identify: @e[email], @e[password], @e[submit]
npx monomind browse fill @e1 "user@test.com"
npx monomind browse fill @e2 "SecurePass123!"
npx monomind browse click @e3
npx monomind browse wait --url "**/dashboard" --timeout 10000

# Save for reuse
npx monomind browse state save ./auth.json
```

## Session Persistence

```bash
# Auto-save/restore state by name
npx monomind browse --session-name myapp open https://app.example.com
# → State saved to ~/.monomind/browser-sessions/myapp automatically
# → Next time: just --session-name myapp and you're logged in
```

## Encrypted State

```bash
# Generate a key: openssl rand -hex 32
export AGENT_BROWSER_ENCRYPTION_KEY=<64-char-hex>
npx monomind browse --session-name secure open https://app.example.com
# → State file is AES-256-GCM encrypted at rest
```

## Auth Vault (Credentials Never Seen by LLM)

```bash
# Store credentials once
echo "mypassword" | monomind browse auth save github \
  --url https://github.com/login \
  --username me \
  --password-stdin

# Login using stored credentials
npx monomind browse auth login github
```

## Token-Based Auth (Skip Login Form)

```bash
# Headers scoped to origin only — never leaked to other domains
npx monomind browse open https://api.example.com --headers '{"Authorization": "Bearer <token>"}'
npx monomind browse snapshot -i
```

## Cookie Import (from cURL)

```bash
# Export from browser DevTools → Network → Copy as cURL → save to file
npx monomind browse cookies set --curl ./cookies.curl   # auto-detects format
```

## OAuth / SSO

OAuth flows redirect through external providers — just follow the snapshots:

```bash
npx monomind browse open https://app.example.com/login
npx monomind browse snapshot -i
npx monomind browse click @e[sign-in-with-google]
npx monomind browse wait --url "**/accounts.google.com/**"
npx monomind browse snapshot -i
# fill Google credentials...
npx monomind browse wait --url "**/app.example.com/**"
# → OAuth complete, save state
npx monomind browse state save ./oauth-auth.json
```

## Two-Factor Authentication

```bash
npx monomind browse open https://app.example.com/login
npx monomind browse fill @e1 "user@test.com"
npx monomind browse fill @e2 "password"
npx monomind browse click @e3
npx monomind browse wait --text "Enter your code"

# Ask user for the 2FA code
# (pause here, user provides code)
npx monomind browse fill @e[otp-field] "<USER_PROVIDED_CODE>"
npx monomind browse click @e[verify]
npx monomind browse wait --url "**/dashboard"
npx monomind browse state save ./2fa-auth.json
```

## State File Management

```bash
npx monomind browse state save ./auth.json       # save current state
npx monomind browse state load ./auth.json       # load into current session
npx monomind browse state list                   # list saved state files
npx monomind browse state show ./auth.json       # show state summary
npx monomind browse state clear                  # clear current session states
npx monomind browse state clean --older-than 30  # delete states older than 30 days
```

## Security Best Practices

- Add auth state files to `.gitignore`
- Use `AGENT_BROWSER_ENCRYPTION_KEY` for encryption at rest
- Use auth vault for long-lived credentials (never expose to LLM)
- Rotate state files when credentials change
- Use `--allowed-domains` in production to prevent cross-site leaks

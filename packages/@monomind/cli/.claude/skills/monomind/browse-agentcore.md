---
name: monomind:browse-agentcore
description: Run browser automation on AWS Bedrock AgentCore cloud browser sessions. Use when the user wants to run browser automation on AWS, use a cloud browser with AWS credentials, or needs a managed browser session backed by AWS infrastructure. Triggers include "use agentcore", "run on AWS", "cloud browser with AWS", "bedrock browser", or any task requiring AWS-hosted browser automation.
version: 1.0.0
triggers:
  - agentcore browser
  - aws cloud browser
  - bedrock browser
  - run browser on aws
  - browser automation aws
tools:
  - Bash
requires:
  - monomind >= 1.0.0
---


# AWS Bedrock AgentCore Browser (monomind:browse-agentcore)

Run browser automation on cloud browser sessions hosted by AWS Bedrock AgentCore. All standard browser commands work identically — the only difference is where the browser runs.

See `monomind:browse` for the full browser automation reference.

## Setup

Credentials are resolved automatically (in order):
1. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optionally `AWS_SESSION_TOKEN`)
2. AWS CLI fallback (`aws configure export-credentials`) — supports SSO, IAM roles, named profiles

No additional setup needed if AWS credentials are already configured.

## Core Workflow

```bash
# Open a page on an AgentCore cloud browser
npx monomind browse -p agentcore open https://example.com

# Everything else is identical to local Chrome
npx monomind browse snapshot -i
npx monomind browse click @e1
npx monomind browse screenshot page.png
npx monomind browse close
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AGENTCORE_REGION` | AWS region | `us-east-1` |
| `AGENTCORE_BROWSER_ID` | Browser identifier | `aws.browser.v1` |
| `AGENTCORE_PROFILE_ID` | Persistent browser profile (cookies, localStorage) | none |
| `AGENTCORE_SESSION_TIMEOUT` | Session timeout in seconds | `3600` |
| `AWS_PROFILE` | AWS CLI profile for credential resolution | `default` |

## Set Provider Globally

```bash
export AGENT_BROWSER_PROVIDER=agentcore
export AGENTCORE_REGION=us-east-2

npx monomind browse open https://example.com
npx monomind browse snapshot -i
npx monomind browse click @e1
npx monomind browse close
```

## Persistent Profiles

Reuse login state across sessions:

```bash
# First run — log in
AGENTCORE_PROFILE_ID=my-app monomind browse -p agentcore open https://app.example.com/login
npx monomind browse snapshot -i
npx monomind browse fill @e1 "user@example.com"
npx monomind browse fill @e2 "password"
npx monomind browse click @e3
npx monomind browse close

# Future runs — already authenticated
AGENTCORE_PROFILE_ID=my-app monomind browse -p agentcore open https://app.example.com/dashboard
```

## Credential Patterns

```bash
# Explicit (CI/CD)
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
npx monomind browse -p agentcore open https://example.com

# SSO
aws sso login --profile my-profile
AWS_PROFILE=my-profile monomind browse -p agentcore open https://example.com

# Default credential chain (IAM role, etc.)
npx monomind browse -p agentcore open https://example.com
```

## Live View

When a session starts, AgentCore prints a Live View URL to stderr — open it in the AWS Console to watch in real time:

```
Session: abc123-def456
Live View: https://us-east-1.console.aws.amazon.com/bedrock-agentcore/browser/aws.browser.v1/session/abc123-def456#
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Failed to run aws CLI" | Install AWS CLI or set `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` directly |
| "Run 'aws sso login'" | SSO credentials expired — run `aws sso login` |
| Session timeout | Increase with `AGENTCORE_SESSION_TIMEOUT=7200` |

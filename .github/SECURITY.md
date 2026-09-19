# Security policy

## Supported versions

Security fixes go into the latest release line. Upgrade with `npm install -g monomind@latest`.

| Version | Supported |
|---|---|
| latest 2.11.x | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub: **[Report a vulnerability](https://github.com/monoes/monomind/security/advisories/new)** (repository → Security → Advisories → Report a vulnerability).

Please include:

- the affected package and version (`monomind --version`)
- what an attacker can do, and under which conditions
- steps or a proof of concept to reproduce it
- any logs or output, with real tokens and personal data removed

## What to expect

- We acknowledge a report within **3 working days**.
- We confirm or rule out the issue and share an initial assessment within **10 working days**.
- We fix confirmed issues in a new release and publish a GitHub security advisory. We credit you in it unless you ask us not to.

Please give us a reasonable chance to fix the issue before disclosing it publicly.

## Scope

In scope: the packages published from this repository (`monomind`, `@monoes/monomindcli` and the `@monoes/*` packages), including the MCP server, the local dashboard, hooks, the org runtime, and the files `monomind init` writes into a project.

Out of scope: vulnerabilities in third-party dependencies that are already publicly known (report those upstream), and issues that require an attacker who already controls the user's machine or account.

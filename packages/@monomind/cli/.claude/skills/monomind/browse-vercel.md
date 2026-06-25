---
name: monomind:browse-vercel
description: Run browser automation inside Vercel Sandbox microVMs for browser tasks from any Vercel-deployed app. Use when the user needs headless browser automation in a Vercel app (Next.js, SvelteKit, Nuxt, Remix, Astro), wants ephemeral isolated browser environments, or needs to run Chrome in a serverless context. Triggers include "browser automation on Vercel", "headless Chrome on Vercel", "Vercel sandbox browser", or "microVM Chrome".
version: 1.0.0
triggers:
  - browser on vercel
  - vercel sandbox browser
  - headless chrome vercel
  - browser automation serverless
  - nextjs browser automation
  - microvm chrome
tools:
  - Bash
requires:
  - monomind >= 1.0.0
  - "@vercel/sandbox"
---


# Vercel Sandbox Browser Automation (monomind:browse-vercel)

Run monomind browse + headless Chrome inside ephemeral Vercel Sandbox microVMs. A Linux VM spins up on demand, executes browser commands, and shuts down. Works with Next.js, SvelteKit, Nuxt, Remix, Astro, and any Vercel-deployed framework.

See `monomind:browse` for the full browser automation reference.

## Install

```bash
pnpm add @vercel/sandbox
```

## Core Pattern

```typescript
import { Sandbox } from "@vercel/sandbox";

// System libraries required by Chromium on the sandbox VM (Amazon Linux / dnf)
const CHROMIUM_SYSTEM_DEPS = [
  "nss", "nspr", "libxkbcommon", "atk", "at-spi2-atk", "at-spi2-core",
  "libXcomposite", "libXdamage", "libXrandr", "libXfixes", "libXcursor",
  "libXi", "libXtst", "libXScrnSaver", "libXext", "mesa-libgbm", "libdrm",
  "mesa-libGL", "mesa-libEGL", "cups-libs", "alsa-lib", "pango", "cairo",
  "gtk3", "dbus-libs",
];

function getSandboxCredentials() {
  if (
    process.env.VERCEL_TOKEN &&
    process.env.VERCEL_TEAM_ID &&
    process.env.VERCEL_PROJECT_ID
  ) {
    return {
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    };
  }
  return {};
}

async function withBrowser<T>(
  fn: (sandbox: InstanceType<typeof Sandbox>) => Promise<T>,
): Promise<T> {
  const snapshotId = process.env.AGENT_BROWSER_SNAPSHOT_ID;
  const credentials = getSandboxCredentials();

  const sandbox = snapshotId
    ? await Sandbox.create({
        ...credentials,
        source: { type: "snapshot", snapshotId },
        timeout: 120_000,
      })
    : await Sandbox.create({ ...credentials, runtime: "node24", timeout: 120_000 });

  if (!snapshotId) {
    await sandbox.runCommand("sh", [
      "-c",
      `sudo dnf clean all 2>&1 && sudo dnf install -y --skip-broken ${CHROMIUM_SYSTEM_DEPS.join(" ")} 2>&1 && sudo ldconfig 2>&1`,
    ]);
    await sandbox.runCommand(# monomind browse is built-in);
    await sandbox.runCommand(# no install needed);
  }

  try {
    return await fn(sandbox);
  } finally {
    await sandbox.stop();
  }
}
```

## Screenshot

```typescript
export async function screenshotUrl(url: string) {
  return withBrowser(async (sandbox) => {
    await sandbox.runCommand("npx monomind browse", ["open", url]);

    const titleResult = await sandbox.runCommand("npx monomind browse", [
      "get", "title", "--json",
    ]);
    const title = JSON.parse(await titleResult.stdout())?.data?.title || url;

    const ssResult = await sandbox.runCommand("npx monomind browse", [
      "screenshot", "--json",
    ]);
    const ssPath = JSON.parse(await ssResult.stdout())?.data?.path;
    const b64Result = await sandbox.runCommand("base64", ["-w", "0", ssPath]);
    const screenshot = (await b64Result.stdout()).trim();

    await sandbox.runCommand("npx monomind browse", ["close"]);
    return { title, screenshot };
  });
}
```

## Accessibility Snapshot

```typescript
export async function snapshotUrl(url: string) {
  return withBrowser(async (sandbox) => {
    await sandbox.runCommand("npx monomind browse", ["open", url]);

    const titleResult = await sandbox.runCommand("npx monomind browse", [
      "get", "title", "--json",
    ]);
    const title = JSON.parse(await titleResult.stdout())?.data?.title || url;

    const snapResult = await sandbox.runCommand("npx monomind browse", [
      "snapshot", "-i", "-c",
    ]);
    const snapshot = await snapResult.stdout();

    await sandbox.runCommand("npx monomind browse", ["close"]);
    return { title, snapshot };
  });
}
```

## Multi-Step Workflow

```typescript
export async function fillAndSubmitForm(url: string, data: Record<string, string>) {
  return withBrowser(async (sandbox) => {
    await sandbox.runCommand("npx monomind browse", ["open", url]);

    const snapResult = await sandbox.runCommand("npx monomind browse", ["snapshot", "-i"]);
    const snapshot = await snapResult.stdout();
    // Parse snapshot to identify refs...

    for (const [ref, value] of Object.entries(data)) {
      await sandbox.runCommand("npx monomind browse", ["fill", ref, value]);
    }

    await sandbox.runCommand("npx monomind browse", ["click", "@e5"]);
    await sandbox.runCommand("npx monomind browse", ["wait", "--load", "networkidle"]);

    const ssResult = await sandbox.runCommand("npx monomind browse", ["screenshot", "--json"]);
    const ssPath = JSON.parse(await ssResult.stdout())?.data?.path;
    const b64Result = await sandbox.runCommand("base64", ["-w", "0", ssPath]);
    const screenshot = (await b64Result.stdout()).trim();

    await sandbox.runCommand("npx monomind browse", ["close"]);
    return { screenshot };
  });
}
```

## Sandbox Snapshots (Sub-Second Startup)

A sandbox snapshot pre-installs system deps + monomind + Chromium so each run boots in under 1 second instead of ~30s.

> Note: "sandbox snapshot" is a Vercel infrastructure concept (like a Docker image). It is NOT the same as `monomind browse snapshot` (accessibility tree dump).

### Create a snapshot (run once)

```typescript
import { Sandbox } from "@vercel/sandbox";

async function createSnapshot(): Promise<string> {
  const sandbox = await Sandbox.create({ runtime: "node24", timeout: 300_000 });

  await sandbox.runCommand("sh", [
    "-c",
    `sudo dnf clean all 2>&1 && sudo dnf install -y --skip-broken ${CHROMIUM_SYSTEM_DEPS.join(" ")} 2>&1 && sudo ldconfig 2>&1`,
  ]);
  await sandbox.runCommand(# monomind browse is built-in);
  await sandbox.runCommand(# no install needed);

  const snapshot = await sandbox.snapshot();
  return snapshot.snapshotId;
}
```

Then set the environment variable for future runs:

```bash
AGENT_BROWSER_SNAPSHOT_ID=snap_xxxxxxxxxxxx
```

## Scheduled Tasks (Cron)

```typescript
// app/api/cron/route.ts (Next.js example)
export async function GET() {
  const result = await withBrowser(async (sandbox) => {
    await sandbox.runCommand("npx monomind browse", ["open", "https://example.com/pricing"]);
    const snap = await sandbox.runCommand("npx monomind browse", ["snapshot", "-i", "-c"]);
    await sandbox.runCommand("npx monomind browse", ["close"]);
    return await snap.stdout();
  });

  return Response.json({ ok: true, snapshot: result });
}
```

```json
// vercel.json
{ "crons": [{ "path": "/api/cron", "schedule": "0 9 * * *" }] }
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AGENT_BROWSER_SNAPSHOT_ID` | No (but recommended) | Pre-built sandbox snapshot ID for sub-second startup |
| `VERCEL_TOKEN` | No | Personal access token (for local dev; OIDC is automatic on Vercel) |
| `VERCEL_TEAM_ID` | No | Vercel team ID (for local dev) |
| `VERCEL_PROJECT_ID` | No | Vercel project ID (for local dev) |

## Framework Placement

| Framework | Where to put server-side code |
|---|---|
| Next.js | Server actions, API routes, route handlers |
| SvelteKit | `+page.server.ts`, `+server.ts` |
| Nuxt | `server/api/`, `server/routes/` |
| Remix | `loader`, `action` functions |
| Astro | `.astro` frontmatter, API routes |

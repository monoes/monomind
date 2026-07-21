---
name: monoagent-image
description: Generate images via Gemini's browser session using the monoagentcli tool, always scoped to the "monoes" profile — no API key, no billing, browser-automated.
version: 1.0.0
triggers:
  - /monoagent-image
  - monoagent image
  - generate image via monoagent
  - generate image via gemini crawl
  - gemini image generation
tools:
  - Bash
---

# Monoagent Image Generation (Gemini browser crawl)

**Engine:** `monoagentcli node run gemini.generate_image` — opens `gemini.google.com` in a real
browser session (no API key, no billing) and downloads the resulting image to disk.

**Profile rule — no exceptions:** every invocation MUST pass `--profile monoes`. Gemini is
already logged in under that profile (`monoagentcli --profile monoes login status` shows
`gemini` as `active`). Never omit `--profile` and never use another profile for this skill —
sessions, credentials, and downloads are fully profile-scoped, and running without
`--profile monoes` either hits the wrong (or no) saved session or writes into the wrong
profile's data.

---

## One-time setup (only if `login status` shows `gemini` missing or expired)

```bash
monoagentcli --profile monoes login status
# if gemini is not "active":
monoagentcli --profile monoes login gemini
# log in by hand in the browser window that opens, then:
monoagentcli --profile monoes login confirm gemini
```

---

## Generate an image from a text prompt

```bash
monoagentcli --profile monoes node run gemini.generate_image \
  --headless \
  --output json \
  --config '{"prompt":"<short English prompt, under 100 chars>","maxWaitSeconds":120,"downloadDir":"<absolute output dir>"}'
```

- **Keep prompts short and in English** (<100 chars). Long or non-English (e.g. Persian) prompts
  trigger Gemini's "Nano Banana 2" reasoning model, which cannot generate images — it will
  silently fail to produce one.
- `downloadDir` defaults to `~/.monoagent/downloads` if omitted — always pass an explicit path
  for the task at hand so the caller knows exactly where the file landed.
- The node's JSON output has an `images` array (`{path, url, filename, size_bytes}`) and
  `image_count`. Read `images[0].path` for the file location — do not assume a fixed filename.

## Generate a styled/derivative image from a reference image

```bash
monoagentcli --profile monoes node run gemini.generate_image \
  --headless \
  --output json \
  --config '{"prompt":"recreate this in a watercolor painting style","referenceImagePath":"/abs/path/to/reference.jpg","maxWaitSeconds":120,"downloadDir":"<absolute output dir>"}'
```

`referenceImagePath` uploads the local image to Gemini before the prompt is sent — use this for
"something like this image but different style" requests. Put the actual style/variation request
in `prompt`.

---

## Operating notes (learned from live testing)

- **Port 9222 must have a working extension connection, not just be free.** Confirmed live
  (2026-07-20): when the CLI logs `extension server error: address already in use` and falls
  back to a standalone Chromium with restored cookies, the run silently fails — it returns a
  single leftover action-trace object (`{"reason":"empty image path","skipped":true,...}`) instead
  of `images`/`image_count`, and no file is written to `downloadDir`. This happened twice in a
  row, including with a freshly re-logged-in Gemini session, so it is not a stale-session issue.
  The fix that made it work: ensure the MonoAgent extension server actually has a live connection
  to a Chrome instance on `127.0.0.1:9222` before running — check with `lsof -i :9222`, expect to
  see the `monoagent` listener AND an `ESTABLISHED` connection to a `Google`/Chrome process, not
  just the bare listener. A successful run logs `Reusing existing extension connection` instead of
  the `address already in use` error.
- If a run comes back with only the `enter_key`/`empty image path` trace and no `images` array,
  don't retry blind — first check `lsof -i :9222` for that established Chrome connection, fix the
  extension connection, then retry once.
- Always run with `--headless` for unattended/agent use; drop it only when a human needs to watch
  the browser interact with Gemini directly (debugging a stuck prompt).
- Treat a run that returns without an `images` entry as a failure — do not report success on the
  CLI's exit code alone; check the JSON payload for `images`/`image_count`.

---

## Full reference

For any flag or edge case not covered here:

```bash
monoagentcli ref node gemini.generate_image
monoagentcli node run --help
```

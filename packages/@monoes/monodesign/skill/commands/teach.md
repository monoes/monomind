---
name: monodesign-teach
description: Alias of /monodesign init — set up a project for monodesign by producing PRODUCT.md (strategic context), optionally DESIGN.md (visual system), and pre-configuring live mode.
type: design-sub-command
argument-hint: "[project path or description]"
user-invocable: true
---

# Monodesign: Teach (alias of Init)

`teach` is the historical name for the setup command and remains fully supported; it is an alias of `init`. Both invocations behave identically.

Follow `commands/init.md` and the authoritative flow in `reference/init.md` from the monodesign skill directory: one codebase crawl plus a short strategic interview produces **PRODUCT.md** (register, users, purpose, brand personality, anti-references, design principles), offers **DESIGN.md** via `/monodesign document`, and pre-configures `.monodesign/live/config.json` for `/monodesign live`.

Notes preserved from the teach era:

- A legacy `.monodesign.md` at the project root is auto-renamed to `PRODUCT.md` by the context loader; mention this once and merge into that content rather than starting fresh.
- If teach was invoked as a setup blocker by another monodesign command, complete the init flow, then resume the original task with the fresh context.

# Teach (alias of Init)

`teach` is the historical name for the setup command; it is now an alias of `init`. Both invocations behave identically.

Read [init.md](init.md) and follow that flow exactly — it is the source of truth for the setup interview, PRODUCT.md / DESIGN.md generation, and live-mode pre-configuration.

Notes preserved from the teach era:

- If a legacy `.monodesign.md` file exists at the project root, the context loader auto-renames it to `PRODUCT.md` (`migrated: true` in the loader output). Mention this once to the user, then merge into that content rather than starting from scratch.
- If teach was invoked as a setup blocker by another monodesign command (e.g. the user ran `/monodesign polish` with no PRODUCT.md), complete the init flow, then resume the original task with the fresh context.

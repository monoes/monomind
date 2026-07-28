<!-- Import an OKF (Open Knowledge Format) bundle into the Second Brain knowledge base. -->

Parse `$ARGUMENTS` for:
- `--scope <name>` or `-s <name>` → knowledge scope (default: `shared`)
- `--global` or `-g` → import into the personal cross-project global brain
- Remaining positional arg → bundle directory path (REQUIRED)

If no bundle directory provided, ask: "Which directory contains the OKF bundle to import?"

Run the import:

```bash
npx monomind doc import "<bundle_dir>" -s "<scope>"
```

Use `doc import`, never `doc ingest` — plain ingest would index the bundle's own
`index.md` manifest as if it were knowledge. Add `--global` when restoring a personal
brain exported with `doc export --global`.

After completion, report files processed, chunks indexed, and any errors. If the bundle directory doesn't exist or contains no `.md` files, say so.

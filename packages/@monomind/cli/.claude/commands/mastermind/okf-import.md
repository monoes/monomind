<!-- Import an OKF (Open Knowledge Format) bundle into the Second Brain knowledge base. -->

Parse `$ARGUMENTS` for:
- `--scope <name>` or `-s <name>` → knowledge scope (default: `shared`)
- Remaining positional arg → bundle directory path (REQUIRED)

If no bundle directory provided, ask: "Which directory contains the OKF bundle to import?"

Run the import:

```bash
npx monomind doc ingest "<bundle_dir>" -s "<scope>"
```

After completion, report files processed, chunks indexed, and any errors. If the bundle directory doesn't exist or contains no `.md` files, say so.

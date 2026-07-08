<!-- Export the Second Brain knowledge base as a portable OKF (Open Knowledge Format) bundle. -->

Parse `$ARGUMENTS` for:
- `--output <dir>` or `-o <dir>` → output directory (default: `.monomind/knowledge-export`)
- `--scope <name>` or `-s <name>` → knowledge scope (default: `shared`)
- Remaining positional arg → treated as output directory

Run the export:

```bash
npx monomind doc export -o "<output_dir>" -s "<scope>"
```

After completion, report what was exported and where. If 0 documents exported, suggest `monomind doc ingest <path>` first.

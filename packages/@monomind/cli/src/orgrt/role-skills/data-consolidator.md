# Data Consolidator — Best Practices

## Focus
Merges data from multiple sources into a single, trustworthy "golden record" set — resolving duplicates, conflicts, and format mismatches along the way.

## Best practices
- Standardize formats (dates, currency, units, casing) across all sources before attempting to match or merge records.
- Use multiple matching techniques (exact key, fuzzy match, normalized fields) rather than relying on a single exact-match rule — real-world duplicates rarely match perfectly.
- Define explicit survivorship rules up front (e.g., most recent wins, most complete record wins, trusted-source-priority) so merges are deterministic and explainable.
- Preserve provenance: track which source each field's value came from, so a "golden record" can be audited or unwound.
- Treat consolidation as auditable and idempotent — rerunning the same merge on the same inputs must produce the same result.
- Validate referential integrity after merging (foreign keys, relationships) — a merge that silently orphans related records is worse than no merge.
- Flag low-confidence matches for human review instead of auto-merging when match confidence is ambiguous.
- Keep a reversible trail (crosswalk/mapping table from source IDs to consolidated ID) so consolidation can be audited or rolled back.

## Common pitfalls
- Auto-merging near-duplicates on a single fuzzy-match pass without a confidence threshold, silently corrupting data.
- Losing source lineage during merge, making it impossible to answer "where did this value come from?" later.
- Assuming clean, uniform input formats and skipping a standardization pass, which silently breaks matching.
- No survivorship rule, so merges become non-deterministic depending on ingest order.
- Treating consolidation as a one-time task instead of an ongoing pipeline as new source data arrives.

## Tools & techniques
- Fuzzy-matching / entity-resolution algorithms (e.g., Levenshtein, phonetic matching, probabilistic record linkage) tuned with a confidence threshold.
- A crosswalk table mapping every source record ID to its consolidated golden-record ID.
- Automated post-merge validation: row counts reconcile, no orphaned foreign keys, no unexpected field-value loss.
- Human-in-the-loop review queue for matches below the auto-merge confidence threshold.

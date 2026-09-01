# Database Optimizer — Best Practices

## Focus
Optimizes schema design, queries, and indexing for relational databases (PostgreSQL, MySQL, Supabase, PlanetScale) so systems perform under load and don't page anyone at 3am.

## Best practices
- Run EXPLAIN ANALYZE before deploying any non-trivial query — check actual time vs. planned time and rows vs. estimated rows, not just "it returned results."
- Index every foreign key used in joins — unindexed joins are the single most common cause of unexpected sequential scans.
- Avoid `SELECT *` — fetch only the columns a query actually needs to reduce I/O and network payload.
- Prevent N+1 queries by using JOINs or batched loading instead of looping queries per row in application code.
- Use connection pooling (PgBouncer, transaction-mode poolers) — never open a raw connection per request, especially in serverless contexts.
- Write migrations that are reversible and non-locking — use `CREATE INDEX CONCURRENTLY`, add columns with defaults that don't rewrite the table.
- Choose normalization vs. denormalization deliberately per access pattern, not dogmatically — document the trade-off made.

## Common pitfalls
- Adding indexes reactively after a production slowdown instead of reviewing query plans during development.
- Locking tables in production migrations by using blocking `CREATE INDEX` or full-table rewrites.
- Trusting an ORM's default query generation without checking for hidden N+1 patterns.
- Over-normalizing a schema for theoretical purity when the actual access pattern demands a denormalized read path.

## Tools & techniques
- `EXPLAIN ANALYZE` read as standard practice: look for Seq Scan (red flag), Index Scan / Bitmap Heap Scan (expected).
- `pg_stat_statements` or platform-equivalent slow-query logs monitored continuously, not just during incidents.
- Partial and composite indexes for common filter+sort patterns rather than one broad index per column.
- Connection pooler configuration (pool size, mode) tuned against actual concurrent connection counts.

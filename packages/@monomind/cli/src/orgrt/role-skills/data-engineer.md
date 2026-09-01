# Data Engineer — Best Practices

## Focus
Builds reliable, observable data pipelines and platform infrastructure that turn raw, messy data into trusted, analytics-ready assets.

## Best practices
- Make every pipeline idempotent — rerunning it must never duplicate or corrupt data.
- Enforce explicit schema contracts between producers and consumers; schema drift should alert loudly, never silently corrupt downstream data.
- Follow a layered model (raw/bronze → cleansed/silver → business-ready/gold): never let consumers read directly from raw layers.
- Handle nulls and malformed records deliberately (impute, flag, or reject) — never let them propagate implicitly into business-facing tables.
- Prefer incremental/CDC processing over full-table refreshes to control cost and latency.
- Attach audit columns (`created_at`, `updated_at`, `deleted_at`, `source_system`) and prefer soft deletes for traceability.
- Set and monitor freshness/completeness SLAs per pipeline, with alerting on breach — not just on hard failure.
- Document data lineage so any row's provenance can be traced back to its source system.

## Common pitfalls
- Silent data quality failures that only surface once a downstream report or model looks wrong.
- Full-table scans/refreshes that work fine in dev and become a cost or latency disaster at scale.
- Transforming data in place at the raw layer, destroying the ability to reprocess from source.
- Treating schema changes as someone else's problem instead of validating and gating them explicitly.
- Under-documenting pipeline ownership, so failures have no clear owner or runbook.

## Tools & techniques
- Data contract tooling (e.g., dbt contracts, Great Expectations) enforced in CI, not just checked manually.
- Window-function based deduplication keyed on primary key + event timestamp for the silver layer.
- Partitioning/clustering (date partitions, Z-ordering) tuned to actual downstream query patterns.
- Pipeline observability with freshness, row-count, and schema-drift alerts wired to an on-call channel.

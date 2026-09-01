# SRE — Best Practices

## Focus
Treat reliability as a measurable, budgeted feature — define SLOs that reflect real user experience, build observability that answers questions before they're asked, and automate away toil.

## Best practices
- Define SLOs from user-facing behavior (availability, latency) with an explicit target and measurement window — not arbitrary round numbers picked without data.
- Let the error budget drive prioritization: budget remaining → ship features; budget exhausted → reliability work takes priority, no exceptions.
- Build observability across all three pillars — metrics for trends/alerting, logs for event detail, traces for cross-service request flow — so "why is this broken?" has an answer in minutes.
- Automate anything done manually twice; toil that isn't automated compounds as the system scales.
- Roll out changes progressively (canary → percentage → full) and never big-bang deploy to 100% of traffic.
- Set burn-rate alerts (fast burn = page now, slow burn = ticket) rather than a single static threshold.
- Run chaos engineering exercises proactively to find weaknesses before users do, not just after an incident.

## Common pitfalls
- Setting SLO targets that don't map to anything users actually experience (e.g. arbitrary "five nines" with no cost/benefit analysis).
- Doing reliability work without data showing there's a problem — optimizing based on intuition instead of measured burn rate.
- Alerting on every anomaly instead of on SLO burn rate, producing pager fatigue that trains engineers to ignore pages.
- Treating each nine of availability as linearly as expensive as the last — it isn't, and pretending otherwise misallocates effort.
- Fixing incidents by hand repeatedly instead of turning the fix into an automated runbook.

## Tools & techniques
- SLI/SLO/error-budget framework with burn-rate multi-window alerts (e.g. 14.4x/1h for critical, 6x/6h for warning).
- The four golden signals (latency, traffic, errors, saturation) as the baseline dashboard for every service.
- Chaos engineering tooling (fault injection, game days) to validate resilience assumptions under controlled conditions.
- Blameless post-incident review focused on systemic fixes, tracked to completion — not just narrated once and forgotten.

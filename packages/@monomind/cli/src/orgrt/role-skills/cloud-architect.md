# Cloud Architect — Best Practices

## Focus
Designs cloud system architecture — service topology, networking, and provider-specific patterns — balancing reliability, security, performance, and cost across AWS/GCP/Azure.

## Best practices
- Anchor every design decision to a named pillar trade-off (reliability vs. cost, latency vs. simplicity) — explicit trade-offs age better than implicit ones.
- Prefer managed/serverless services where operational overhead outweighs the cost premium; justify self-managed infrastructure explicitly when chosen.
- Design for failure: multi-AZ by default for anything user-facing, multi-region only where the business impact justifies the added complexity and cost.
- Keep network architecture explicit and minimal — least-privilege security groups/firewall rules, private subnets for anything without a reason to be public.
- Build auto-scaling and load distribution into the design from day one rather than retrofitting under load.
- Avoid single-provider lock-in for critical paths only where multi-cloud genuinely reduces risk — don't multi-cloud by default, it adds real operational cost.
- Document the architecture as a living diagram + decision record, not a one-time slide that goes stale.

## Common pitfalls
- Designing for hypothetical scale that never materializes, adding complexity and cost with no corresponding benefit.
- Treating security groups/IAM as an afterthought instead of part of the initial design.
- Choosing multi-region/multi-cloud complexity without a clear business case tied to actual downtime cost.
- Letting architecture diagrams and decision records drift out of sync with what's actually deployed.

## Tools & techniques
- Well-Architected Framework review (or equivalent) across operational excellence, security, reliability, performance, cost, sustainability.
- Infrastructure as Code for every provisioned resource, reviewed like application code.
- Load testing against realistic traffic shapes before finalizing auto-scaling thresholds.
- Architecture decision records (ADRs) capturing why a pattern was chosen, not just what was chosen.

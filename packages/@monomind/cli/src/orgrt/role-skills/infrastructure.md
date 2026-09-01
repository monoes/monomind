# Infrastructure — Best Practices

## Focus
Designs and operates the underlying systems (compute, networking, storage, CI/CD) that everything else runs on — reliability and reproducibility over feature velocity.

## Best practices
- Define infrastructure as code — every resource should be reproducible from a config file, not created by hand through a console.
- Design for the six well-architected pillars: operational excellence, security, reliability, performance efficiency, cost optimization, sustainability — trade-offs should be explicit, not accidental.
- Build in redundancy proportional to actual criticality — multi-AZ/multi-region for what truly needs it, not everything by default (cost matters).
- Automate scaling and load distribution (auto-scaling groups, load balancers) rather than manually provisioning for peak.
- Version and review infra changes like application code — plan/diff before apply, peer review before merge.
- Instrument before you need it — monitoring, logging, and alerting must exist before an incident, not get added after one.
- Keep environments (dev/staging/prod) as close to identical as practical to catch environment-specific failures early.

## Common pitfalls
- Manual, undocumented changes made directly against production that drift from the IaC source of truth.
- Over-provisioning "just in case" instead of right-sizing against actual load data.
- Treating monitoring/alerting as optional polish added after the first incident instead of a prerequisite.
- Ignoring cost pillar until the bill is a surprise — cost optimization is a design-time concern, not a later cleanup.

## Tools & techniques
- Infrastructure as Code (Terraform, Pulumi, CloudFormation) with plan/apply review gates.
- Well-Architected style review across reliability, security, cost, performance, and operations before major changes ship.
- Auto-scaling + load balancing configured against real traffic patterns, not guessed capacity.
- Centralized logging/monitoring (e.g., Cloud Monitoring/Logging equivalents) wired to actionable alerts, not noise.

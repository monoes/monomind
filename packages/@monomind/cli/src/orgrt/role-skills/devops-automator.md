# DevOps Automator — Best Practices

## Focus
Eliminate manual infrastructure and deployment work through automation — Infrastructure as Code, CI/CD pipelines, container orchestration, and monitoring that catches problems before users do.

## Best practices
- Manage all infrastructure through code (Terraform/CloudFormation/CDK) with version control and review — no manual console changes that drift from the source of truth.
- Design deployments to be zero-downtime by default (blue-green, canary, or rolling) with automated health checks gating traffic shift.
- Build monitoring and alerting alongside the infrastructure, not after an incident reveals it was missing — cover the golden signals (latency, traffic, errors, saturation).
- Automate secrets management and rotation; never let a credential live only in a human's memory or a Slack message.
- Right-size resources with data (actual utilization) rather than guesswork, and revisit sizing as load patterns change.
- Bake security scanning (dependency, container, static analysis) into the pipeline as a blocking gate for critical findings.
- Automate disaster recovery and backups, and actually test restoring from them — an untested backup is not a backup.

## Common pitfalls
- Infrastructure changes made by hand "just this once" that never get reflected back into the IaC source, causing drift.
- Deploying without a rollback mechanism ready, discovered only during an incident.
- Alerting on everything, which trains engineers to ignore pages — tune to actionable signals only.
- Optimizing for automation coverage over actual reliability outcomes (uptime, MTTR) — automation is a means, not the goal.

## Tools & techniques
- Terraform/CloudFormation/CDK for infrastructure as code with plan/apply review gates.
- Kubernetes/ECS with health checks, autoscaling, and rolling/blue-green deploy strategies.
- Prometheus/Grafana or equivalent for metrics, with alert rules tied to the golden signals, not raw resource thresholds alone.
- Automated vulnerability scanning integrated into the build (containers and dependencies) as a merge/deploy gate.

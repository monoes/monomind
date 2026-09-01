# Experiment Tracker — Best Practices

## Focus
Records and organizes every experiment (ML training run, A/B test, feature trial) — parameters, code version, data, environment, and results — so outcomes are reproducible, comparable, and auditable.

## Best practices
- Log parameters, code version, data version, environment, and metrics together for every run — a metric without its full context is not reproducible.
- Give every experiment a clear hypothesis and success criterion before it starts, not a post-hoc interpretation of whatever the numbers show.
- Compare against a control/baseline explicitly — an isolated "the metric went up" claim means nothing without what it's relative to.
- Pin environment and dependency versions per run so a "reproduce this result" request is actually answerable months later.
- Track statistical significance and sample size for A/B-style experiments, not just the raw metric delta.
- Tag and organize runs by project/hypothesis so related experiments can be compared as a group, not just individually.
- Record negative/failed results with the same rigor as successful ones — knowing what didn't work is as valuable as knowing what did.
- Close the loop: record the decision made from each experiment (shipped / rejected / needs more data), not just the raw numbers.

## Common pitfalls
- Logging metrics without the parameters/code/data version that produced them — the run becomes unreproducible the moment code changes.
- Declaring a winner from an A/B test before reaching statistical significance or minimum sample size.
- No control group — measuring a change against "how things felt before" instead of a concurrent baseline.
- Losing track of which experiment config is actually running in production versus which was just an exploratory trial.
- Discarding failed experiments instead of recording them, causing the same dead end to be re-explored later.

## Tools & techniques
- Tracking platforms (MLflow, Weights & Biases, or equivalent) that auto-capture params, metrics, code version, and artifacts per run.
- Model/experiment registries to distinguish "promoted to production" from "exploratory" runs.
- A/B test statistical frameworks (power analysis for sample size, significance testing before calling a winner) for product experiments.
- Environment manifests (lockfiles, container images, YAML env specs) versioned alongside each run for reproducibility.
- Comparison dashboards that plot multiple runs against shared baselines to make relative performance legible at a glance.

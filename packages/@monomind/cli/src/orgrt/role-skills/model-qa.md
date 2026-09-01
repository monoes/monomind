# Model QA Specialist — Best Practices

## Focus
Independently audits ML/statistical models end-to-end — documentation, data, replication, calibration, and fairness — to certify whether a model is sound before or during production use.

## Best practices
- Never audit a model you built yourself — independence is the whole point; findings from a self-review are structurally suspect.
- Require full reproducibility: every analysis must run from raw data to final output via a versioned, self-contained script — no manual steps.
- Replicate the model from documented methodology and compare outputs against the original (parameter deltas, score distributions) before trusting either.
- Test calibration explicitly, not just discrimination — a model can rank correctly (good AUC) while its predicted probabilities are badly miscalibrated.
- Check feature and population stability over time (PSI or similar) — a model that was sound at training time can silently drift out of validity.
- Rate every finding by severity (High/Medium/Low/Info) with quantified business impact — "this seems off" is not a finding.
- Audit fairness across protected/segment groups explicitly, not just aggregate performance.
- Verify governance basics — model inventory, approval trail, monitoring plan — exist and are current, before diving into the statistics.

## Common pitfalls
- Accepting in-sample or training metrics as sufficient evidence of production soundness, skipping out-of-time validation.
- Declaring "the model is wrong" without quantifying the impact or proposing a remediation.
- Checking aggregate performance only, missing a segment where the model fails badly but is diluted in the overall number.
- Treating a passed discrimination test (AUC/Gini) as sufficient without also checking calibration — the two measure different things and both can fail independently.
- Skipping documentation/governance review because the statistics "look fine" — an undocumented or unapproved model is a finding regardless of accuracy.

## Tools & techniques
- Population Stability Index (PSI) per feature and per period to quantify distribution drift.
- Hosmer-Lemeshow test, Brier score, and reliability diagrams for calibration validation.
- SHAP global (beeswarm/importance) and local (waterfall) analysis to verify learned relationships match documented rationale.
- Partial Dependence Plots (including 2D interaction plots) to check for expected monotonic/directional relationships and detect learned interaction effects.
- Champion-challenger benchmarking with statistical significance testing (e.g. DeLong test for AUC differences) before recommending a model swap.

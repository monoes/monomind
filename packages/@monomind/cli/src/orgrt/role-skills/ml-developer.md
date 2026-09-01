# ML Developer — Best Practices

## Focus
Develops and trains machine learning models end-to-end — data preparation, feature engineering, training, evaluation — with rigor about what makes a model actually trustworthy, not just accurate on paper.

## Best practices
- Split data (train/validation/test, plus out-of-time where applicable) before any feature engineering to avoid leakage from future or held-out data into training.
- Establish a baseline model first (simple heuristic or linear model) so later complexity is justified by measured lift, not assumed.
- Evaluate with metrics matched to the problem (F1/AUC for imbalanced classification, RMSE for regression, calibration for probability outputs) — accuracy alone is often misleading.
- Check feature distributions and label definitions against the actual business/product definition before trusting the target variable.
- Test for data leakage explicitly — features that encode the label, or that wouldn't be available at prediction time in production.
- Version data, code, and model artifacts together so any training run is fully reproducible from a clean environment.
- Run bias/fairness checks across relevant subgroups before considering a model release-ready, not as an afterthought.
- Keep a documented rationale for every included feature — undocumented features become unexplainable liabilities during audits or debugging.

## Common pitfalls
- Data leakage from improper train/test splitting (e.g. splitting after feature engineering that used the full dataset's statistics).
- Chasing a single aggregate metric while ignoring subgroup or segment-level performance where the model quietly fails.
- No baseline comparison — a complex model's "good" accuracy is meaningless without a simple reference point.
- Skipping calibration checks — a model can have great discrimination (AUC) but badly miscalibrated probabilities, breaking any downstream decision threshold.
- Not testing for feature stability over time (distribution drift) before deployment, leading to silent degradation in production.

## Tools & techniques
- Population Stability Index (PSI) and similar drift metrics to check feature/label stability across time windows.
- Cross-validation with stratification for imbalanced classes, and time-based splits for temporal data.
- SHAP values and partial dependence plots for interpretability — verify the model learned sensible relationships, not spurious correlations.
- Calibration diagnostics (Brier score, reliability diagrams, Hosmer-Lemeshow test) whenever predicted probabilities drive decisions.
- Champion-challenger evaluation against the current production model before promoting a new one.

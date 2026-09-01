# Benchmarker — Best Practices

## Focus
Designs and runs load, stress, and regression benchmarks that produce statistically trustworthy, reproducible performance numbers — and turns them into clear pass/fail verdicts against defined targets.

## Best practices
- Always warm up the system before measuring — cold-start numbers are not representative of steady-state performance.
- Test realistic load shapes (ramp-up, sustained peak, spike, soak/endurance), not just a single fixed concurrency level.
- Define explicit thresholds up front (e.g. p95 < 500ms, error rate < 1%) so results are pass/fail, not vibes.
- Run multiple trials and report confidence intervals — a single run can't distinguish signal from noise.
- Keep the test environment consistent across runs (same hardware/instance class, same background load) or the comparison is meaningless.
- Benchmark the critical user journey end-to-end, not just an isolated function — real bottlenecks often hide in the seams between components.
- Always pair a benchmark with a baseline: report "before vs. after," not just an absolute number.
- Automate regression benchmarks into CI so performance regressions are caught before merge, not after deploy.

## Common pitfalls
- Running a single trial and treating the result as ground truth instead of a sample from a distribution.
- Benchmarking on a noisy shared machine or laptop and comparing results across sessions as if the environment were constant.
- Ignoring error rate while chasing latency numbers — a "fast" system that's silently failing 5% of requests is not fast.
- Testing only the happy path at moderate load and skipping stress/breaking-point tests that reveal real capacity limits.
- Reporting mean/average latency when p95/p99 tail latency is what actually determines user experience.

## Tools & techniques
- Load-testing tools with staged ramp profiles (k6, Locust, Gatling, JMeter) with explicit `thresholds`/pass criteria baked into the script.
- Statistical comparison of before/after runs (confidence intervals, not just point estimates) to confirm an improvement is real.
- Core Web Vitals-style targets for frontend work (LCP, FID/INP, CLS) alongside backend throughput/latency metrics.
- Capacity/breaking-point testing (increase load until failure) to find the actual ceiling, not just performance at expected load.
- Regression gates in CI/CD that fail the build when a tracked metric crosses its threshold.

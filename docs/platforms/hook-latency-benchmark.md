# Hook latency benchmark

Measured on 2026-08-24 using Node 25.9.0 on the release worktree. Each sample
spawns the generated standalone bridge, supplies a valid normalized event, and
appends its latency record under a temporary project's `.monomind/` directory.
The 80-sample measurements include Node process startup and the bridge's file
touch, which is the critical-path work performed by the current observe bridge.

| Event | Samples | p50 | p95 | Max | Default budget |
| --- | ---: | ---: | ---: | ---: | ---: |
| PreToolUse | 80 | 101.38 ms | 111.13 ms | 117.15 ms | 2,000 ms |
| PostToolUse | 80 | 100.57 ms | 104.84 ms | 111.30 ms | 10,000 ms |

Both observed maxima remain below their configured budgets. Re-run this
benchmark when hook-policy work adds network, database, or blocking behavior.

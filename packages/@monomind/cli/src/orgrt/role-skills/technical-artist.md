# Technical Artist — Best Practices

## Focus
Bridges art and engineering — building shaders, tools, and pipeline standards that let artists work efficiently while keeping assets performant and engine-ready.

## Best practices
- Write shaders optimized from the ground up, not optimized as an afterthought — instruction count, texture samples, and branching cost matter from the first draft.
- Establish and document pipeline standards early: naming conventions, folder structure, shader rules, skeleton standards, material budgets, texture size limits, LOD thresholds, collision rules, animation state naming, export presets. Clear standards mean artists know what to build and engineers know what they'll receive.
- Reduce draw calls and optimize asset specs proactively (batching, atlasing, instancing) rather than only reacting once a profiler flags a problem.
- Implement and enforce LOD systems appropriate to the target platform's budget, not a one-size-fits-all LOD chain.
- Build tools (in-engine or Python/scripting) that let artists self-serve repetitive tasks instead of routing every asset through engineering.
- Profile with the actual platform-appropriate tools (RenderDoc, PIX, engine-specific frame debuggers) and share performance data with the wider team, not just fix silently.
- Treat the technical art pipeline as a feedback loop: findings from profiling and shader review should continuously update the documented standards, not just fix the one asset in question.

## Common pitfalls
- No documented budget/standards, so problems surface as expensive surprises late in production instead of being caught at asset creation time.
- Building one-off fixes for individual assets instead of pipeline-level tools that prevent the whole class of problem.
- Optimizing shaders/assets in isolation without profiling on the actual target hardware/platform.
- Treating technical art as purely reactive (fixing what breaks) instead of proactively setting guardrails before content is built.
- Poor communication of performance constraints to artists, leading to repeated budget violations that could have been prevented with clearer upfront limits.

## Tools & techniques
- Frame debugging/profiling tools matched to engine and platform (RenderDoc, PIX, Unity/Unreal frame debugger, Unreal Insights).
- Documented technical art bible: naming conventions, budgets (poly, texture, draw call, material), LOD thresholds, export presets.
- Custom tooling (Python, engine editor scripts, Blueprints) to automate validation and reduce manual artist error.
- Shader complexity analysis (instruction count, texture fetch count) checked against target-platform budgets before content lock.

# Unity Architect — Best Practices

## Focus
Designs the code and data architecture of a Unity project — project structure, ScriptableObject-driven data systems, and performance patterns — so the codebase stays maintainable and scalable as the team and content grow.

## Best practices
- Separate data from behavior using ScriptableObjects for configuration and shared data (item definitions, enemy stats, event channels) rather than hardcoding values into MonoBehaviours.
- Use ScriptableObject-based event channels for cross-system communication instead of singletons or tightly-coupled direct references — systems can broadcast/listen without knowing about each other.
- Remember ScriptableObjects are shared by reference (flyweight pattern) — good for scalable shared config across thousands of instances, but not a substitute for per-instance runtime state.
- Avoid MonoBehaviour overhead where it isn't needed: MonoBehaviours require a GameObject/Transform host; plain C# classes or ScriptableObjects are cheaper when no scene presence is required.
- Establish a clear project folder structure early (dedicated ScriptableObjects folder with type-based subfolders, one asset per file with descriptive names) — retrofitting structure after content has piled up is expensive.
- Keep coding standards and architecture decisions written down and enforced (interfaces, dependency direction, assembly definitions) so a growing team doesn't drift into inconsistent patterns.
- Use Unity's assembly definition files to enforce module boundaries and cut compile times, especially as the project scales.

## Common pitfalls
- Using ScriptableObjects for runtime-heavy or highly mutable state instead of just configuration/shared data — this causes shared-state bugs across instances.
- Leaning on singletons for global systems instead of ScriptableObject event channels or proper dependency injection, creating hidden coupling.
- No enforced project structure, leading to scattered ScriptableObject assets that are hard to locate or reason about.
- Overusing MonoBehaviours for objects that don't need scene presence, adding unnecessary GameObject/Transform overhead at scale.
- Skipping assembly definitions on a growing codebase, leading to full-project recompiles on every small change.

## Tools & techniques
- ScriptableObject-driven architecture: data containers for config, event channel SOs for decoupled communication.
- Assembly Definition files (.asmdef) to enforce module boundaries and reduce compile times.
- Structured Assets/ScriptableObjects folder hierarchy with per-type subfolders and one-object-per-file convention.
- Unity Profiler / Frame Debugger for validating that architectural choices (SO usage, object pooling, batching) actually deliver the intended performance characteristics.

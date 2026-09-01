# Game Audio Engineer — Best Practices

## Focus
Implements adaptive sound and music systems in-engine — building mixer architecture, middleware projects (Wwise/FMOD), and gameplay-driven audio parameters — not just producing sound assets.

## Best practices
- Build a tree-structured mixer bus architecture: individual sounds route to category buses, category buses to sub-mixes, sub-mixes to master — this enables hierarchical volume control, consistent effects processing, and efficient CPU usage.
- Drive adaptive audio from gameplay parameters (intensity, wetness, occlusion, combat state) set by game systems via the middleware's parameter API — keep audio logic inside the middleware, not scattered across gameplay scripts.
- Design music systems that transition smoothly across tension states (exploration → combat → victory) using vertical layering or horizontal re-sequencing rather than hard cuts.
- Structure the Wwise/FMOD project (Actor-Mixer hierarchy / event structure, Work Units, naming conventions) so it scales with content growth without becoming unmaintainable — decide this early, not after hundreds of events exist.
- Choose middleware deliberately: Wwise for AAA-scale data-driven complexity with a steeper learning curve; FMOD for a more approachable timeline-based workflow — match the choice to team size and project scope.
- Keep sound designers empowered to build interactive behaviors (adaptive mixing, transitions) without needing engineering support for every change, via well-designed parameter-driven systems.
- Profile audio performance (voice count, CPU/memory budget, streaming) the same rigor as any other real-time system — audio bugs (voice stealing, clipping, missing occlusion) are performance bugs too.

## Common pitfalls
- Hardcoding audio triggers/logic in gameplay code instead of exposing clean parameters for middleware-side authoring — this couples audio changes to engineering time forever.
- Letting the middleware project grow unstructured (no naming convention, no Work Unit organization) until sound designers can't find or safely edit events.
- Hard-cutting music between states instead of designing proper adaptive transitions, breaking immersion at exactly the moments that matter most.
- No mixer bus hierarchy — flat routing that makes global volume/ducking/sidechain adjustments painful or impossible.
- Ignoring voice budget/CPU cost until late, causing last-minute audio cuts under performance pressure.

## Tools & techniques
- Wwise (Actor-Mixer hierarchy, Work Units, RTPCs/parameters) or FMOD Studio (timeline events, parameters, snapshots) as the implementation layer between sound design and gameplay code.
- Tree-structured mixer bus routing for hierarchical control and consistent DSP application.
- Parameter-driven adaptive mixing (setParameterByName / RTPC) so game systems push state, not explicit sound triggers.
- Vertical layering and horizontal re-sequencing techniques for state-based adaptive music.

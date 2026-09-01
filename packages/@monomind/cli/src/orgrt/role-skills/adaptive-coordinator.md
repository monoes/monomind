# Adaptive Coordinator — Best Practices

## Focus
Reconfigures the coordination topology itself (hierarchical, mesh, ring, star) as workload, failure conditions, or team size change, instead of running one fixed structure for the whole task.

## Best practices
- Pick the topology from the shape of the work, not habit: hierarchical/manager-worker for tight control and small teams, mesh for maximal resilience and independent slices, star for a single aggregation point, ring only for strictly ordered handoffs.
- Reassess the topology at phase boundaries, not mid-task — switching structure while agents are mid-flight is how state gets lost or duplicated.
- Escalate from flat/parallel to hierarchical once worker count or coordination overhead crosses the point where a flat structure can no longer track ownership (roughly 5-8+ concurrent workers).
- Under agent failure or churn, prefer the topology that degrades gracefully for the situation — hierarchical protects overall efficiency, decentralized/mesh protects continuity when any single node might drop out.
- State the topology and the reason for choosing it explicitly before dispatching work — an unstated topology is one nobody can hold you to.
- Treat "hybrid" or "adaptive" as a real decision to make, not a way to defer the decision — if the label doesn't correspond to an actual dispatch pattern, it's not doing anything.
- Re-evaluate after each reconfiguration whether the new topology actually reduced coordination overhead — don't assume the switch helped without checking.

## Common pitfalls
- Reconfiguring topology reactively after something already broke, instead of recognizing the load/failure signal early enough to switch proactively.
- Adding topology-switching machinery that itself becomes the coordination overhead it was meant to reduce — every added mode needs its own conflict-resolution path.
- Switching structure without migrating in-flight state, silently dropping progress or duplicating work across the old and new topology.
- Assuming a topology label (e.g. "adaptive") implies automatic reconfiguration when nothing is actually monitoring load or triggering the switch — a static assignment described as adaptive is just static.
- Optimizing purely for efficiency (hierarchical) or purely for resilience (mesh) without naming the tradeoff being made for the task at hand.

## Tools & techniques
- Track a small set of trigger signals for reconfiguration: worker count crossing a threshold, repeated task failures, or a shift from independent to interdependent subtasks.
- Keep topology state (roster, current structure, reason for the current choice) in one place that's cheap to inspect before making a switch decision.
- When switching, drain or checkpoint in-flight work first, then redispatch under the new structure — don't reconfigure underneath running agents.
- Default to the simplest topology that fits the current phase; add structure only when the current one is visibly the bottleneck.

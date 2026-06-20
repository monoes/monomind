import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';
export const contextualProximityPhase = {
    name: 'contextual-proximity',
    deps: ['docs-parse', 'pdf-parse'],
    async execute(ctx) {
        if (ctx.options.codeOnly)
            return { coOccursEdges: 0, conceptsScored: 0 };
        // Fetch all Section → Concept links from TAGGED_AS edges
        const rows = ctx.db
            .prepare(`SELECT source_id, target_id FROM edges WHERE relation = 'TAGGED_AS'`)
            .all();
        if (rows.length === 0)
            return { coOccursEdges: 0, conceptsScored: 0 };
        // Group concepts by section using ??= to avoid has+get pattern
        const sectionConcepts = new Map();
        for (const { source_id, target_id } of rows) {
            let list = sectionConcepts.get(source_id);
            if (!list) {
                list = [];
                sectionConcepts.set(source_id, list);
            }
            list.push(target_id);
        }
        // Count concept co-occurrences across all sections.
        // Accumulate conceptDegree in the same pass to avoid a second loop over sectionConcepts.
        // Use a ternary comparison instead of [a,b].sort() to avoid per-pair array allocation.
        const coOccur = new Map();
        const conceptDegree = new Map();
        for (const concepts of sectionConcepts.values()) {
            for (let i = 0; i < concepts.length; i++) {
                conceptDegree.set(concepts[i], (conceptDegree.get(concepts[i]) ?? 0) + 1);
                for (let j = i + 1; j < concepts.length; j++) {
                    // Avoid allocating a 2-element sort array — ternary comparison is equivalent
                    const a = concepts[i] <= concepts[j] ? concepts[i] : concepts[j];
                    const b = concepts[i] <= concepts[j] ? concepts[j] : concepts[i];
                    const key = `${a}::${b}`;
                    coOccur.set(key, (coOccur.get(key) ?? 0) + 1);
                }
            }
        }
        // Build CO_OCCURS edges (weight = number of sections where both concepts appear)
        const edges = [];
        for (const [key, weight] of coOccur) {
            const sep = key.indexOf('::');
            const sourceId = key.slice(0, sep);
            const targetId = key.slice(sep + 2);
            edges.push({
                id: makeId(sourceId, targetId, 'co_occurs'),
                sourceId,
                targetId,
                relation: 'CO_OCCURS',
                confidence: 'INFERRED',
                confidenceScore: CONFIDENCE_SCORE.INFERRED,
                weight,
            });
        }
        if (conceptDegree.size > 0) {
            // Compute maxDeg with a loop to avoid spread array allocation from [...values()]
            let maxDeg = 0;
            for (const deg of conceptDegree.values()) {
                if (deg > maxDeg)
                    maxDeg = deg;
            }
            const update = ctx.db.prepare(`UPDATE nodes SET properties = json_set(COALESCE(properties, '{}'), '$.importance', ?) WHERE id = ?`);
            ctx.db.transaction(() => {
                for (const [cid, deg] of conceptDegree) {
                    const importance = Math.max(1, Math.ceil((deg / maxDeg) * 5));
                    update.run(importance, cid);
                }
            })();
        }
        if (edges.length > 0)
            insertEdges(ctx.db, edges);
        ctx.onProgress?.({ phase: 'contextual-proximity', message: `${edges.length} CO_OCCURS edges, ${conceptDegree.size} concepts scored` });
        return { coOccursEdges: edges.length, conceptsScored: conceptDegree.size };
    },
};
//# sourceMappingURL=contextual-proximity.js.map
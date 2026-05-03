import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographEdge } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';

export interface ContextualProximityOutput {
  coOccursEdges: number;
  conceptsScored: number;
}

export const contextualProximityPhase: PipelinePhase<ContextualProximityOutput> = {
  name: 'contextual-proximity',
  deps: ['docs-parse', 'pdf-parse'],

  async execute(ctx: PipelineContext) {
    if (ctx.options.codeOnly) return { coOccursEdges: 0, conceptsScored: 0 };

    // Fetch all Section → Concept links from TAGGED_AS edges
    const rows = ctx.db
      .prepare(`SELECT source_id, target_id FROM edges WHERE relation = 'TAGGED_AS'`)
      .all() as { source_id: string; target_id: string }[];

    if (rows.length === 0) return { coOccursEdges: 0, conceptsScored: 0 };

    // Group concepts by section
    const sectionConcepts = new Map<string, string[]>();
    for (const { source_id, target_id } of rows) {
      if (!sectionConcepts.has(source_id)) sectionConcepts.set(source_id, []);
      sectionConcepts.get(source_id)!.push(target_id);
    }

    // Count concept co-occurrences across all sections
    const coOccur = new Map<string, number>();
    for (const concepts of sectionConcepts.values()) {
      for (let i = 0; i < concepts.length; i++) {
        for (let j = i + 1; j < concepts.length; j++) {
          const [a, b] = [concepts[i], concepts[j]].sort();
          const key = `${a}::${b}`;
          coOccur.set(key, (coOccur.get(key) ?? 0) + 1);
        }
      }
    }

    // Build CO_OCCURS edges (weight = number of sections where both concepts appear)
    const edges: MonographEdge[] = [];
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

    // Score concept importance 1-5 based on normalized degree (sections it appears in)
    const conceptDegree = new Map<string, number>();
    for (const concepts of sectionConcepts.values()) {
      for (const cid of concepts) {
        conceptDegree.set(cid, (conceptDegree.get(cid) ?? 0) + 1);
      }
    }

    if (conceptDegree.size > 0) {
      const maxDeg = Math.max(...conceptDegree.values());
      const update = ctx.db.prepare(
        `UPDATE nodes SET properties = json_set(COALESCE(properties, '{}'), '$.importance', ?) WHERE id = ?`,
      );
      ctx.db.transaction(() => {
        for (const [cid, deg] of conceptDegree) {
          const importance = Math.max(1, Math.ceil((deg / maxDeg) * 5));
          update.run(importance, cid);
        }
      })();
    }

    if (edges.length > 0) insertEdges(ctx.db, edges);

    ctx.onProgress?.({ phase: 'contextual-proximity', message: `${edges.length} CO_OCCURS edges, ${conceptDegree.size} concepts scored` });
    return { coOccursEdges: edges.length, conceptsScored: conceptDegree.size };
  },
};

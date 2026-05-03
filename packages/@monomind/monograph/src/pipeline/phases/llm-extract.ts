import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { makeId, toNormLabel, CONFIDENCE_SCORE } from '../../types.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { EdgeRelation } from '../../types.js';

export interface LlmExtractOutput {
  triplesExtracted: number;
  sectionsProcessed: number;
}

const ALLOWED_RELATIONS = new Set<string>([
  'DESCRIBES', 'CAUSES', 'CONTRASTS_WITH', 'PART_OF', 'RELATED_TO', 'USES',
]);

const SYSTEM_PROMPT = `You extract knowledge graph relationships from technical documentation chunks.

Return ONLY a JSON array of relationships, each with:
- "node_1": first concept (short, specific, lowercase, max 4 words)
- "node_2": second concept (short, specific, lowercase, max 4 words)
- "relation": one of DESCRIBES, CAUSES, CONTRASTS_WITH, PART_OF, RELATED_TO, USES
- "edge": brief 3-6 word phrase describing the relationship

Rules:
- Concepts must be specific technical terms (not "thing", "item", "way", "use")
- Maximum 8 relationships per chunk
- Skip if text is too short, navigational, or has no meaningful concepts
- Return [] for non-substantive content

Return only valid JSON array, no explanation.`;

interface Triple {
  node_1: string;
  node_2: string;
  relation: string;
  edge: string;
}

async function callClaude(content: string, apiKey: string): Promise<Triple[] | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: content.slice(0, 1500) }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { content: Array<{ text: string }> };
    const text = data.content[0]?.text ?? '[]';
    const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]');
    return Array.isArray(parsed) ? parsed as Triple[] : null;
  } catch {
    return null;
  }
}

export const llmExtractPhase: PipelinePhase<LlmExtractOutput> = {
  name: 'llm-extract',
  deps: ['docs-parse', 'pdf-parse'],

  async execute(ctx: PipelineContext) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const maxSections = ctx.options.llmMaxSections;

    if (!apiKey || maxSections <= 0 || ctx.options.codeOnly) {
      return { triplesExtracted: 0, sectionsProcessed: 0 };
    }

    // Fetch Section nodes with non-trivial content
    const sections = ctx.db
      .prepare(`
        SELECT id, name, properties FROM nodes
        WHERE label = 'Section'
        AND properties IS NOT NULL
        AND json_extract(properties, '$.content') IS NOT NULL
        AND length(json_extract(properties, '$.content')) > 200
        LIMIT ?
      `)
      .all(maxSections) as { id: string; name: string; properties: string }[];

    if (sections.length === 0) return { triplesExtracted: 0, sectionsProcessed: 0 };

    const conceptNodes = new Map<string, MonographNode>();
    const allEdges: MonographEdge[] = [];
    const seenEdges = new Set<string>();
    let sectionsProcessed = 0;

    // Fetch existing concept IDs to avoid duplicate node creation
    const existingConcepts = new Set<string>(
      (ctx.db.prepare(`SELECT id FROM nodes WHERE label = 'Concept'`).all() as { id: string }[])
        .map(r => r.id),
    );

    for (const section of sections) {
      const props = JSON.parse(section.properties) as Record<string, unknown>;
      const content = props.content as string | undefined;
      if (!content) continue;

      const triples = await callClaude(
        `Section: "${section.name}"\n\n${content}`,
        apiKey,
      );
      if (!triples || triples.length === 0) continue;

      sectionsProcessed++;

      for (const triple of triples) {
        const { node_1, node_2, relation, edge } = triple;
        if (!node_1 || !node_2 || !relation) continue;

        const rel = relation.toUpperCase();
        if (!ALLOWED_RELATIONS.has(rel)) continue;

        // Normalize concept names (lowercase, collapse spaces)
        const n1 = node_1.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const n2 = node_2.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (!n1 || !n2 || n1 === n2) continue;

        const c1Id = makeId('concept', n1);
        const c2Id = makeId('concept', n2);

        for (const [cId, cName] of [[c1Id, n1], [c2Id, n2]] as [string, string][]) {
          if (!conceptNodes.has(cId) && !existingConcepts.has(cId)) {
            conceptNodes.set(cId, {
              id: cId, label: 'Concept',
              name: cName.replace(/_/g, ' '), normLabel: toNormLabel(cName),
              isExported: false,
              properties: { source: 'llm', edgeLabel: edge },
            });
          }
        }

        // Section → concept_1 (DESCRIBES)
        const e1Id = makeId(section.id, c1Id, 'describes');
        if (!seenEdges.has(e1Id)) {
          seenEdges.add(e1Id);
          allEdges.push({
            id: e1Id, sourceId: section.id, targetId: c1Id,
            relation: 'DESCRIBES', confidence: 'INFERRED', confidenceScore: CONFIDENCE_SCORE.INFERRED,
          });
        }

        // concept_1 → concept_2 (semantic relation)
        const e2Id = makeId(c1Id, c2Id, rel.toLowerCase());
        if (!seenEdges.has(e2Id)) {
          seenEdges.add(e2Id);
          allEdges.push({
            id: e2Id, sourceId: c1Id, targetId: c2Id,
            relation: rel as EdgeRelation, confidence: 'INFERRED', confidenceScore: CONFIDENCE_SCORE.INFERRED,
            weight: 1,
          });
        }
      }
    }

    if (conceptNodes.size > 0) insertNodes(ctx.db, [...conceptNodes.values()]);
    if (allEdges.length > 0) insertEdges(ctx.db, allEdges);

    ctx.onProgress?.({
      phase: 'llm-extract',
      message: `LLM processed ${sectionsProcessed} sections → ${allEdges.length} semantic edges, ${conceptNodes.size} new concepts`,
    });

    return { triplesExtracted: allEdges.length, sectionsProcessed };
  },
};

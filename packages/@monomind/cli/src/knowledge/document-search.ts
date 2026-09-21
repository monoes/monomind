/**
 * Knowledge search — the read side of the pipeline.
 *
 * Fans a query out across the requested stores (project, global, or both),
 * drops chunks belonging to superseded document versions, and decorates each
 * surviving hit with what a caller needs to cite it: the source path, capture
 * provenance, and the chunk's character span.
 *
 * Split out of document-pipeline.ts.
 *
 * @module v1/cli/knowledge/document-search
 */

// Static import is safe and deliberate: memory-bridge imports only node builtins
// at module scope (everything heavy is lazy), and the project-root rule must not
// be duplicated — two copies of "which directory is this project" is exactly the
// bug this default exists to fix.
import { getProjectRoot } from '../memory/memory-bridge.js';
import type { CaptureProvenance } from './capture-envelope.js';
import { citationAnchor, parseSpanTag } from './citation.js';
import {
  hasKnowledgeMetadata,
  isSupersededKey,
  readMetadata,
  supersededOverfetchLimit,
} from './document-index.js';
import { GLOBAL_BRAIN_SENTINEL, getBridge, globalBrainRoot, namespace } from './document-store.js';
import type { KnowledgeExcerpt } from './document-types.js';
import { profileStoreDir } from './profile-store.js';

// Head-of-chunk cap for text served by searchKnowledge — chunks are
// heading-anchored, so the head carries the most relevant content.
const SEARCH_EXCERPT_TEXT_CAP = 800;

/** Small additive boost so project knowledge wins ties against the global
 *  brain — local context is more likely to be what the user means. */
const PROJECT_SCOPE_BOOST = 0.05;

export async function searchKnowledge(
  query: string,
  opts?: {
    scope?: string;
    limit?: number;
    minScore?: number;
    rootDir?: string;
    /** which store(s): project-only, global-only, or both (default). */
    store?: 'project' | 'global' | 'all';
    /** Return chunks from superseded document versions too, flagged
     *  `superseded: true`. Default false — see the note above `liveContentHashes`. */
    includeSuperseded?: boolean;
    /** Skip cross-encoder reranking. Default false. */
    skipRerank?: boolean;
  },
): Promise<KnowledgeExcerpt[]> {
  const bridge = await getBridge();
  if (!bridge) return [];

  const scope = opts?.scope ?? 'shared';
  const limit = opts?.limit ?? 10;
  const minScore = opts?.minScore ?? 0.3;
  const store = opts?.store ?? 'all';

  const targets: Array<{
    ns: string;
    dbPath?: string;
    root: string;
    label: string;
    boost: number;
  }> = [];
  if (store !== 'global') {
    // A `profile:<id>` scope names its own store outright; anything else is
    // the project store it has always been.
    const profileDir = profileStoreDir(scope);
    targets.push({
      ns: namespace(scope),
      ...(profileDir ? { dbPath: profileDir } : {}),
      root: profileDir ?? opts?.rootDir ?? getProjectRoot(),
      label: scope,
      boost: PROJECT_SCOPE_BOOST,
    });
  }
  if (store !== 'project') {
    targets.push({
      ns: namespace('global'),
      dbPath: GLOBAL_BRAIN_SENTINEL,
      root: globalBrainRoot(),
      label: 'global',
      boost: 0,
    });
  }

  const includeSuperseded = opts?.includeSuperseded === true;

  const perTarget = await Promise.all(
    targets.map(async (t) => {
      const meta = readMetadata(t.root);
      const hasMeta = hasKnowledgeMetadata(t.root);
      const live = new Set<string>();
      for (const m of meta) if (m.contentHash) live.add(m.contentHash);
      // Old versions dominate a long-lived store, so a 1:1 fetch would come back
      // nearly empty once they are filtered out. Over-fetch, then trim.
      const fetchLimit = includeSuperseded ? limit : supersededOverfetchLimit(limit, live);
      const result = await bridge
        .bridgeSearchEntries({
          query,
          namespace: t.ns,
          limit: fetchLimit,
          threshold: minScore,
          dbPath: t.dbPath,
          skipRerank: opts?.skipRerank,
          includeSuperseded,
          rootDir: t.root,
        })
        .catch(() => null);
      if (!result?.success || !result.results.length) return [];
      const hashToFile = new Map<string, string>();
      const hashToProvenance = new Map<string, CaptureProvenance>();
      for (const m of meta) {
        hashToFile.set(m.contentHash, m.filePath);
        if (m.provenance) hashToProvenance.set(m.contentHash, m.provenance);
      }
      const kept = includeSuperseded
        ? result.results
        : result.results.filter((r: any) => !isSupersededKey(String(r.key ?? ''), live, hasMeta));
      return kept.slice(0, limit).map((r: any) => {
        const parts = r.key.startsWith('doc:') ? r.key.split(':') : [];
        const hash = parts[1] ?? '';
        const idx = parseInt(parts[2] ?? '0', 10);
        // The src: tag stored at ingest is the chunk's OWN provenance — the
        // hash→file map can misattribute when two documents share identical
        // content, and goes empty when a re-ingested file's hash changed.
        const srcTag = (r.tags ?? []).find((tag: string) => tag.startsWith('src:'));
        const superseded = includeSuperseded && isSupersededKey(String(r.key ?? ''), live, hasMeta);
        // RCL-10: offsets ride on the chunk's own `span:` tag, so citing a hit
        // costs nothing here. Chunks stored before span tags simply have none,
        // and `doc cite --chunk` recomputes them from the document.
        const span = parseSpanTag(r.tags as string[] | undefined);
        return {
          id: r.id,
          filePath: srcTag ? srcTag.slice(4) : (hashToFile.get(hash) ?? ''),
          // Serve the head of the chunk only — chunks are heading-anchored, so the
          // head carries the most relevant text, and full chunks (up to ~3.2K
          // chars) bloat every search response.
          text:
            typeof r.content === 'string' && r.content.length > SEARCH_EXCERPT_TEXT_CAP
              ? r.content.slice(0, SEARCH_EXCERPT_TEXT_CAP)
              : r.content,
          similarity: r.score + t.boost,
          chunkIndex: Number.isNaN(idx) ? 0 : idx,
          scope: t.label,
          ...(superseded ? { superseded: true } : {}),
          // RCL-07: only LIVE versions carry provenance here — a superseded
          // chunk's record is no longer in the live metadata. Its `url:` tag
          // still identifies the page it came from.
          ...(hashToProvenance.has(hash) ? { provenance: hashToProvenance.get(hash) } : {}),
          ...(span
            ? {
                startChar: span.startChar,
                endChar: span.endChar,
                anchor: citationAnchor(hash, span.startChar, span.endChar),
              }
            : {}),
        };
      });
    }),
  );

  return perTarget
    .flat()
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

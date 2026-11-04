/**
 * Doctor — memory checks: project root resolution, memory database, knowledge
 * graph, Second Brain model and document extractors, memory proficiency.
 * Extracted from doctor-project-checks.ts.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MEMORY_DB_CANDIDATE_PATHS } from '../utils/paths.js';
import { transformersCacheDir } from '../utils/transformers-loader.js';
import type { HealthCheck } from './doctor-env-checks.js';

/** o-16 (AC-6): the marker walk that resolves "this project" for the Memory
 *  & Knowledge store can silently adopt a wrong ancestor — the incident that
 *  motivated this check was a shared scratch parent's bare `.monomind`
 *  capturing an unrelated fixture, with no visible symptom until a search
 *  came back empty. Disclose the resolved root and why it was chosen, so a
 *  user can see which directory their brain is keyed to without reading code
 *  or debug logs. Always 'info': the resolution itself is never a health
 *  problem, only the failure to see it was.
 *
 *  Named/scoped to "Memory Project Root", not a bare "Project Root" (o-16
 *  revision 1, reviewer MAJOR 2): `MONOMIND_PROJECT_ROOT` has a SECOND,
 *  independent consumer — `mcp-tools/guidance-tools.ts:findProjectRoot()`,
 *  which uses a different marker (`.claude`) and can legitimately resolve a
 *  different directory (see the divergence explained at
 *  `memory-bridge.ts`'s `getProjectRoot()` doc comment). A generic "Project
 *  Root" label would claim there is one true answer when this commit is
 *  what creates a state where two resolvers can disagree — this check must
 *  not be the thing that misleads about that. */
export async function checkProjectRoot(): Promise<HealthCheck> {
  const name = 'Memory Project Root';
  const { getProjectRootResolution } = await import('../memory/memory-bridge.js');
  const { root, reason, ignoredBareMonomind, invalidAnchor } = getProjectRootResolution();
  const reasonText: Record<typeof reason, string> = {
    'explicit-anchor': 'MONOMIND_PROJECT_ROOT anchor',
    git: 'nearest .git ancestor',
    'monomind-at-start': 'starting directory carries .monomind',
    'monomind-with-marker': '.monomind ancestor confirmed by a project manifest',
    'start-fallback': 'no adoptable marker found — using the current directory',
  };
  // o-16 revision 1 (dev-lead Addition 1): the anchor's own disclosure must
  // cover the ambiguous case it exists to resolve — a SET-but-INVALID
  // anchor — not just the happy path, or a typo'd MONOMIND_PROJECT_ROOT
  // silently does nothing and the user has no way to find out why. Appended
  // regardless of which `reason` the walk ultimately fell back to.
  const invalidAnchorNote = invalidAnchor
    ? ` [MONOMIND_PROJECT_ROOT="${invalidAnchor.value}" ignored — ${invalidAnchor.problem}]`
    : '';
  if (reason === 'start-fallback' && ignoredBareMonomind) {
    return {
      name,
      status: 'info',
      message: `${root} (${reasonText[reason]}; ignored bare .monomind at ${ignoredBareMonomind} — add a project marker there, or set MONOMIND_PROJECT_ROOT, to adopt it)${invalidAnchorNote}`,
    };
  }
  return { name, status: 'info', message: `${root} (${reasonText[reason]})${invalidAnchorNote}` };
}

export async function checkMemoryDatabase(): Promise<HealthCheck> {
  const dbPaths = MEMORY_DB_CANDIDATE_PATHS;
  for (const dbPath of dbPaths) {
    if (existsSync(dbPath)) {
      try {
        const sizeMB = (statSync(dbPath).size / 1024 / 1024).toFixed(2);
        return { name: 'Memory Database', status: 'pass', message: `${dbPath} (${sizeMB} MB)` };
      } catch {
        return { name: 'Memory Database', status: 'warn', message: `${dbPath} (unable to stat)` };
      }
    }
  }
  return {
    name: 'Memory Database',
    status: 'warn',
    message: 'Not initialized',
    fix: 'monomind memory init',
  };
}

/** Memory knowledge graph (cognee port): entities/relations/rules distilled
 * from sessions and org runs. Informational — an empty graph on a fresh
 * project is normal, so it never fails. */
export async function checkMemoryKnowledgeGraph(): Promise<HealthCheck> {
  const name = 'Memory Knowledge Graph';
  try {
    const kg = await import('../memory/memory-kg.js');
    const bridge = await import('../memory/memory-bridge.js');
    const project = await kg.kgStats();
    // Org KG facts are namespaced per org (kg:nodes:org:<name> etc.), so an
    // unscoped kgStats against the org store reads the now-unused flat
    // namespaces and reports zero for every org. Sum each org's own scope
    // instead — the org store holds all of them, keyed by scope.
    const orgDb = join(process.cwd(), '.monomind', 'org-memory');
    let org: { nodes: number; edges: number; rules: number } | null = null;
    if (existsSync(orgDb)) {
      const { orgKgScope } = await import('../orgrt/org-memory.js');
      const { listOrgConfigFiles } = await import('./org.js');
      const orgsDir = join(process.cwd(), '.monomind', 'orgs');
      const orgNames = existsSync(orgsDir)
        ? listOrgConfigFiles(orgsDir).map((f) => f.replace(/\.json$/, ''))
        : [];
      org = { nodes: 0, edges: 0, rules: 0 };
      for (const orgName of orgNames) {
        const s = await kg.kgStats({ dbPath: orgDb, scope: orgKgScope(orgName) });
        org.nodes += s.nodes;
        org.edges += s.edges;
        org.rules += s.rules;
      }
    }
    await bridge.shutdownBridge().catch(() => {
      /* best effort */
    });
    const total = project.nodes + (org?.nodes ?? 0);
    const fmt = (s: { nodes: number; edges: number; rules: number }): string =>
      `${s.nodes}n/${s.edges}e/${s.rules}r`;
    if (total === 0) {
      return {
        name,
        status: 'warn',
        message: 'Empty — sessions/org runs have not distilled knowledge yet',
        fix: 'org runs call org_learn automatically; sessions use memory_kg_ingest',
      };
    }
    return {
      name,
      status: 'pass',
      message: `project ${fmt(project)}${org ? ` · org ${fmt(org)}` : ''}`,
    };
  } catch (err) {
    return {
      name,
      status: 'warn',
      message: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Count live (non-tombstoned) ingested documents under a brain root, without
 * creating the directory — `listDocuments` mkdir's its metadata dir, which
 * would materialize an empty global brain just by running doctor. */
async function countBrainDocs(root: string): Promise<number> {
  if (!existsSync(join(root, '.monomind', 'knowledge', 'doc-metadata.jsonl'))) return 0;
  try {
    const { listDocuments } = await import('../knowledge/document-pipeline.js');
    return listDocuments(root).length;
  } catch {
    return 0;
  }
}

/** Second Brain: when there is any indexed knowledge — ingested docs in this
 * project, the personal global brain, or the monograph god-node chunk —
 * semantic search needs the local embedding model. Its absence is silent
 * (search degrades to keyword matching), so surface it here instead. */
export async function checkSecondBrainModel(): Promise<HealthCheck> {
  const name = 'Second Brain Model';
  const { BRIDGE_EMBEDDING_MODEL, getGlobalBrainDir, getProjectRoot } = await import(
    '../memory/memory-bridge.js'
  );
  const projectDocs = await countBrainDocs(getProjectRoot());
  const globalDocs = await countBrainDocs(getGlobalBrainDir());
  // chunks.jsonl holds the monograph god-node chunk — knowledge with no doc
  // ingest. Unlike the document store it is written per-CWD by the session
  // hook, not at the project root, so check both rather than assuming.
  const chunksIn = (root: string): boolean =>
    existsSync(join(root, '.monomind', 'knowledge', 'chunks.jsonl'));
  const hasChunks = chunksIn(getProjectRoot()) || chunksIn(process.cwd());
  if (!projectDocs && !globalDocs && !hasChunks) {
    return { name, status: 'pass', message: 'No knowledge indexed (nothing to check)' };
  }
  const indexed = [
    projectDocs ? `${projectDocs} project doc${projectDocs === 1 ? '' : 's'}` : null,
    globalDocs ? `${globalDocs} global doc${globalDocs === 1 ? '' : 's'}` : null,
    !projectDocs && !globalDocs ? 'monograph god-nodes' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const cacheRoot = transformersCacheDir();
  if (!cacheRoot) {
    return {
      name,
      status: 'warn',
      message:
        'Embedding runtime not installed — semantic search degraded to keyword matching until first use',
      fix: 'run `monomind download-embeddings` (installs @huggingface/transformers into ~/.monomind/deps and fetches the model)',
    };
  }
  // The cached model is whichever one the bridge actually loads. This used to
  // look for '.cache/Xenova', a model the bridge stopped using — so the check
  // reported "not downloaded" with a fully provisioned cache sitting on disk.
  if (existsSync(join(cacheRoot, ...BRIDGE_EMBEDDING_MODEL.split('/')))) {
    return {
      name,
      status: 'pass',
      message: `Local embedding model cached — semantic search active (${indexed})`,
    };
  }
  return {
    name,
    status: 'warn',
    message: 'Embedding model not downloaded yet — searches use keyword matching until it is',
    // Query-time paths all pass local_files_only and never fetch; this is the
    // one command that downloads the weights.
    fix: 'run once while online: monomind doc eval --provision-model (downloads ~270MB locally, one time)',
  };
}

/**
 * AutoMem proficiency check — reports memory learning health
 */
export async function checkMemoryProficiency(): Promise<HealthCheck> {
  try {
    const intelligenceMod = await import('../memory/intelligence.js');
    const stats = intelligenceMod.getMemoryProficiencyStats();
    const bankStats = intelligenceMod.getIntelligenceStats();

    if (stats.totalDecisions === 0) {
      return {
        name: 'Memory Proficiency',
        status: 'pass',
        message: 'AutoMem active — no decisions recorded yet (builds up over sessions)',
      };
    }

    const successPct = Math.round(stats.successRate * 100);
    const hitPct = Math.round(stats.patternHitRate * 100);
    const msg = `${stats.totalDecisions} decisions, ${successPct}% success, ${stats.proficiencyPatterns} patterns, ${hitPct}% hit rate (bank: ${bankStats.patternsLearned} total)`;

    if (stats.successRate < 0.5) {
      return { name: 'Memory Proficiency', status: 'warn', message: msg };
    }
    return { name: 'Memory Proficiency', status: 'pass', message: msg };
  } catch {
    return {
      name: 'Memory Proficiency',
      status: 'warn',
      message: 'Could not load intelligence module',
    };
  }
}

/** Second Brain document ingestion: whether the "documents" capability is
 * active for this project. Read directly from capabilities.json rather than
 * re-running the directory scan — doctor should report on what's actually
 * activated, not re-detect. */
function isDocumentsCapabilityActive(cwd: string): boolean {
  try {
    const capsPath = join(cwd, '.monomind', 'capabilities.json');
    if (!existsSync(capsPath)) return false;
    const parsed = JSON.parse(readFileSync(capsPath, 'utf8')) as { active?: string[] };
    return Array.isArray(parsed.active) && parsed.active.includes('documents');
  } catch {
    return false;
  }
}

/** Per-extractor health for Second Brain document ingestion (MEM-8/MEM-9):
 * one check per format family (PDF, DOCX, XLSX/XLS/ODS, PPTX/ODT/ODP/EPUB,
 * legacy DOC/PPT/Pages) instead of a single blanket "documents" check, so
 * `doctor` can report exactly which formats are functional vs broken.
 * No-op (empty array) when the documents capability isn't active — nothing
 * to report if this project doesn't ingest documents. */
export async function checkDocumentExtractors(): Promise<HealthCheck[]> {
  if (!isDocumentsCapabilityActive(process.cwd())) return [];
  try {
    const { documentsCapability } = await import('../capabilities/cap-documents.js');
    const checks = (await documentsCapability.healthChecks?.()) ?? [];
    return checks.map((c) => ({
      name: c.name,
      status: c.status,
      message: c.message,
      fix: c.hint ?? c.fix,
    }));
  } catch (err) {
    return [
      {
        name: 'Document Extractors',
        status: 'warn',
        message: `Check failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

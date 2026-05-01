import type Database from 'better-sqlite3';

const CHARS_PER_TOKEN = 4;
const DEFAULT_WORDS_PER_NODE = 50;
const DEFAULT_QUESTIONS = [
  'how does authentication work',
  'what is the main entry point',
  'how are errors handled',
  'what connects the data layer to the api',
  'what are the core abstractions',
];

export function estimateTokens(text: string): number {
  return Math.floor(text.length / CHARS_PER_TOKEN);
}

export interface BenchmarkOptions {
  corpusWordCount?: number;
  questions?: string[];
  depth?: number;
}

export interface PerQuestionResult {
  question: string;
  query_tokens: number;
  reduction: number;
}

export interface BenchmarkResult {
  corpus_tokens: number;
  corpus_words: number;
  nodes: number;
  edges: number;
  avg_query_tokens: number;
  reduction_ratio: number;
  per_question: PerQuestionResult[];
}

function buildAdjacency(db: Database.Database): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const edges = db.prepare('SELECT source_id, target_id FROM edges').all() as { source_id: string; target_id: string }[];
  for (const { source_id, target_id } of edges) {
    const list = adj.get(source_id) ?? [];
    list.push(target_id);
    adj.set(source_id, list);
    if (!adj.has(target_id)) adj.set(target_id, []);
  }
  return adj;
}

function querySubgraphTokens(
  db: Database.Database,
  question: string,
  depth: number,
): number {
  const terms = question.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (terms.length === 0) return 0;

  const likeClause = terms.map(() => 'LOWER(name) LIKE ?').join(' OR ');
  const params = terms.map(t => `%${t}%`);
  const startRows = db.prepare(
    `SELECT id, name, label, file_path FROM nodes WHERE ${likeClause} LIMIT 3`
  ).all(...params) as { id: string; name: string; label: string; file_path: string | null }[];

  if (startRows.length === 0) return 0;

  const adj = buildAdjacency(db);
  const visited = new Set(startRows.map(r => r.id));
  let frontier = new Set(startRows.map(r => r.id));

  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          next.add(neighbor);
          visited.add(neighbor);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  const ids = [...visited];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT name, label, file_path FROM nodes WHERE id IN (${placeholders})`
  ).all(...ids) as { name: string; label: string; file_path: string | null }[];

  const lines = rows.map(r => `NODE ${r.label} ${r.name} src=${r.file_path ?? ''}`);
  return estimateTokens(lines.join('\n'));
}

export function runBenchmark(db: Database.Database, options: BenchmarkOptions = {}): BenchmarkResult {
  const { corpusWordCount, questions = DEFAULT_QUESTIONS, depth = 3 } = options;

  const nodeCount = (db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number }).n;
  const edgeCount = (db.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number }).n;

  const corpusWords = corpusWordCount ?? nodeCount * DEFAULT_WORDS_PER_NODE;
  const corpusTokens = Math.floor(corpusWords * 4 / 3);

  const perQuestion: PerQuestionResult[] = [];
  for (const q of questions) {
    const qt = querySubgraphTokens(db, q, depth);
    perQuestion.push({
      question: q,
      query_tokens: qt,
      reduction: corpusTokens > 0 && qt > 0 ? Math.round((corpusTokens / qt) * 10) / 10 : 0,
    });
  }

  const answered = perQuestion.filter(p => p.query_tokens > 0);
  const avgQueryTokens = answered.length > 0
    ? Math.floor(answered.reduce((s, p) => s + p.query_tokens, 0) / answered.length)
    : 0;
  const reductionRatio = corpusTokens > 0 && avgQueryTokens > 0
    ? Math.round((corpusTokens / avgQueryTokens) * 10) / 10
    : 0;

  return {
    corpus_tokens: corpusTokens,
    corpus_words: corpusWords,
    nodes: nodeCount,
    edges: edgeCount,
    avg_query_tokens: avgQueryTokens,
    reduction_ratio: reductionRatio,
    per_question: perQuestion,
  };
}

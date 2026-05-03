import type Database from 'better-sqlite3';

const DIM = 256;

function normalizeText(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-./:]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function charNgrams(text: string, n: number): string[] {
  const padded = ' '.repeat(n - 1) + text + ' '.repeat(n - 1);
  const out: string[] = [];
  for (let i = 0; i <= padded.length - n; i++) {
    out.push(padded.slice(i, i + n));
  }
  return out;
}

// FNV-1a 32-bit
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (Math.imul(h, 16777619)) >>> 0;
  }
  return h;
}

export function computeEmbedding(text: string): number[] {
  const norm = normalizeText(text);
  const vec = new Float32Array(DIM);

  for (const ng of charNgrams(norm, 3)) {
    vec[fnv1a(ng) % DIM]++;
  }

  for (const word of norm.split(' ').filter(Boolean)) {
    vec[fnv1a('w:' + word) % DIM] += 2;
  }

  let mag = 0;
  for (let i = 0; i < DIM; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag);
  if (mag > 0) for (let i = 0; i < DIM; i++) vec[i] /= mag;

  return Array.from(vec);
}

export interface SemanticResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  score: number;
}

export function semanticSearch(
  db: Database.Database,
  query: string,
  limit: number,
  label?: string,
): SemanticResult[] {
  const qVec = computeEmbedding(query);

  let sql = 'SELECT id, name, norm_label, file_path, label, embedding FROM nodes WHERE embedding IS NOT NULL';
  const params: unknown[] = [];
  if (label) {
    sql += ' AND label = ?';
    params.push(label);
  }

  const rows = db.prepare(sql).all(...(params as [unknown])) as Record<string, unknown>[];

  return rows
    .map(r => {
      const emb = JSON.parse(r.embedding as string) as number[];
      let dot = 0;
      for (let i = 0; i < DIM; i++) dot += qVec[i] * emb[i];
      return {
        id: r.id as string,
        name: r.name as string,
        normLabel: r.norm_label as string,
        filePath: (r.file_path as string | null) ?? null,
        label: r.label as string,
        score: dot,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function buildEmbeddings(db: Database.Database): void {
  const rows = db
    .prepare('SELECT id, name, norm_label, file_path, label FROM nodes')
    .all() as Record<string, unknown>[];

  const update = db.prepare('UPDATE nodes SET embedding = ? WHERE id = ?');
  const run = db.transaction((nodes: Record<string, unknown>[]) => {
    for (const r of nodes) {
      const text = [
        r.name as string,
        r.norm_label as string,
        r.label as string,
        ((r.file_path as string | null) ?? '').split('/').join(' '),
      ].join(' ');
      update.run(JSON.stringify(computeEmbedding(text)), r.id as string);
    }
  });
  run(rows);
}

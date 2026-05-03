import type { MonographDb } from '../storage/db.js';

export interface PrivateTypeLeak {
  exportNodeId: string;
  exportName: string;
  exportFilePath: string | null;
  leakedTypeNodeId: string;
  leakedTypeName: string;
  leakedTypeFilePath: string | null;
  reason: string;
}

export interface PrivateTypeLeaksResult {
  leaks: PrivateTypeLeak[];
  totalLeaks: number;
  affectedExports: number;
}

interface LeakRow {
  source_id: string;
  target_id: string;
  src_name: string;
  src_path: string | null;
  tgt_name: string;
  tgt_path: string | null;
}

export function detectPrivateTypeLeaks(db: MonographDb): PrivateTypeLeaksResult {
  const rows = db.prepare(`
    SELECT e.source_id, e.target_id, n1.name as src_name, n1.file_path as src_path,
           n2.name as tgt_name, n2.file_path as tgt_path
    FROM edges e
    JOIN nodes n1 ON n1.id = e.source_id
    JOIN nodes n2 ON n2.id = e.target_id
    WHERE e.relation IN ('IMPORTS', 'REFERENCES')
      AND n1.is_exported = 1
      AND n2.is_exported = 0
      AND n1.community_id != n2.community_id
      AND n1.community_id IS NOT NULL
      AND n2.community_id IS NOT NULL
    LIMIT 200
  `).all() as LeakRow[];

  // Deduplicate by (source_id, target_id) pair
  const seen = new Set<string>();
  const leaks: PrivateTypeLeak[] = [];
  const affectedExportIds = new Set<string>();

  for (const row of rows) {
    const key = `${row.source_id}:${row.target_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    affectedExportIds.add(row.source_id);

    leaks.push({
      exportNodeId: row.source_id,
      exportName: row.src_name,
      exportFilePath: row.src_path,
      leakedTypeNodeId: row.target_id,
      leakedTypeName: row.tgt_name,
      leakedTypeFilePath: row.tgt_path,
      reason: `Exported symbol ${row.src_name} references non-exported ${row.tgt_name} from another community`,
    });
  }

  return {
    leaks,
    totalLeaks: leaks.length,
    affectedExports: affectedExportIds.size,
  };
}

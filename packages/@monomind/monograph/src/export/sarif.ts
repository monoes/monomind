import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { relative } from 'path';

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri?: string;
}

export interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine: number };
    };
  }>;
  fingerprints?: { 'monograph/v1': string };
}

export interface SarifDocument {
  $schema: string;
  version: '2.1.0';
  runs: [{
    tool: { driver: { name: string; version: string; rules: SarifRule[] } };
    results: SarifResult[];
  }];
}

const SARIF_RULES: SarifRule[] = [
  {
    id: 'monograph/god-node',
    name: 'GodNode',
    shortDescription: { text: 'High-centrality node (god node) exceeds fan-in threshold' },
    fullDescription: { text: 'A file or module has an unusually high number of incoming dependencies, making it a central point of coupling. Consider splitting this module into smaller, more focused units.' },
    helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/god-node.md',
  },
  {
    id: 'monograph/unreachable-file',
    name: 'UnreachableFile',
    shortDescription: { text: 'File node unreachable from any entry point' },
    fullDescription: { text: 'A file is not reachable from any known entry point. It may be dead code that can be safely removed.' },
    helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/unreachable-file.md',
  },
  {
    id: 'monograph/circular-import',
    name: 'CircularImport',
    shortDescription: { text: 'Circular import detected' },
    fullDescription: { text: 'A circular import chain was detected between files. Circular imports can cause initialization order issues and make the codebase harder to understand.' },
    helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/circular-import.md',
  },
  {
    id: 'monograph/bridge-node',
    name: 'BridgeNode',
    shortDescription: { text: 'Bridge node — high cross-community coupling' },
    fullDescription: { text: 'A file acts as a bridge between multiple community clusters, creating high cross-community coupling. This may indicate architectural boundaries are not being respected.' },
    helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/bridge-node.md',
  },
  {
    id: 'monograph/hotspot',
    name: 'Hotspot',
    shortDescription: { text: 'File is both frequently changed and highly connected' },
    fullDescription: { text: 'A file is both a churn hotspot (frequently modified) and highly connected in the dependency graph. Changes here have wide blast radius and high risk of regression.' },
    helpUri: 'https://github.com/nokhodian/monomind/blob/main/docs/rules/hotspot.md',
  },
];

// Map ruleId to SARIF level
const RULE_LEVELS: Record<string, 'error' | 'warning' | 'note'> = {
  'monograph/god-node': 'warning',
  'monograph/unreachable-file': 'note',
  'monograph/circular-import': 'error',
  'monograph/bridge-node': 'warning',
  'monograph/hotspot': 'warning',
};

function fingerprint(ruleId: string, filePath: string): string {
  return createHash('sha256').update(`${ruleId}:${filePath}`).digest('hex');
}

function toFileUri(repoRoot: string, filePath: string): string {
  const rel = relative(repoRoot, filePath);
  return `file:///${rel.replace(/\\/g, '/')}`;
}

function makeResult(
  ruleId: string,
  message: string,
  filePath: string,
  startLine: number | null | undefined,
  repoRoot: string,
): SarifResult {
  const result: SarifResult = {
    ruleId,
    level: RULE_LEVELS[ruleId] ?? 'warning',
    message: { text: message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: toFileUri(repoRoot, filePath) },
          ...(startLine != null ? { region: { startLine } } : {}),
        },
      },
    ],
    fingerprints: { 'monograph/v1': fingerprint(ruleId, filePath) },
  };
  return result;
}

export function exportSarif(db: Database.Database, repoRoot: string): SarifDocument {
  const results: SarifResult[] = [];

  // ── God nodes (top 10% by fan-in) ────────────────────────────────────────────
  const totalNodes = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE label = 'File'`).get() as { c: number }).c;
  const top10pct = Math.max(1, Math.floor(totalNodes * 0.1));
  const godNodes = db.prepare(`
    SELECT n.id, n.name, n.file_path, n.start_line,
           COUNT(e.id) AS in_degree
    FROM nodes n
    LEFT JOIN edges e ON e.target_id = n.id
    WHERE n.file_path IS NOT NULL AND n.label = 'File'
    GROUP BY n.id
    ORDER BY in_degree DESC
    LIMIT ?
  `).all(top10pct) as { id: string; name: string; file_path: string; start_line: number | null; in_degree: number }[];

  for (const row of godNodes) {
    if (row.in_degree === 0) continue;
    results.push(makeResult(
      'monograph/god-node',
      `God node: "${row.name}" has ${row.in_degree} incoming dependencies (fan-in).`,
      row.file_path,
      row.start_line,
      repoRoot,
    ));
  }

  // ── Unreachable files ─────────────────────────────────────────────────────────
  const unreachable = db.prepare(`
    SELECT id, name, file_path FROM nodes
    WHERE label = 'File'
    AND (
      json_extract(properties, '$.reachabilityRole') = 'unreachable'
      OR properties LIKE '%"unreachable"%'
    )
    AND file_path IS NOT NULL
  `).all() as { id: string; name: string; file_path: string }[];

  for (const row of unreachable) {
    results.push(makeResult(
      'monograph/unreachable-file',
      `Unreachable file: "${row.name}" is not reachable from any entry point.`,
      row.file_path,
      null,
      repoRoot,
    ));
  }

  // ── Hotspots (churnScore > 0.5) ───────────────────────────────────────────────
  const hotspots = db.prepare(`
    SELECT id, name, file_path, start_line
    FROM nodes
    WHERE file_path IS NOT NULL
    AND json_extract(properties, '$.churnScore') > 0.5
  `).all() as { id: string; name: string; file_path: string; start_line: number | null }[];

  for (const row of hotspots) {
    results.push(makeResult(
      'monograph/hotspot',
      `Hotspot: "${row.name}" has high churn score (>0.5) and is highly connected.`,
      row.file_path,
      row.start_line,
      repoRoot,
    ));
  }

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'monograph',
            version: '1.1.0',
            rules: SARIF_RULES,
          },
        },
        results,
      },
    ],
  };
}

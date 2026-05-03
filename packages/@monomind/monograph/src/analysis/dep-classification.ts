import type { MonographDb } from '../storage/db.js';

export interface PackageDepClassification {
  packageName: string;
  usedAsValue: boolean;       // has any non-type-only import
  usedAsTypeOnly: boolean;    // has any type-only import
  recommendation: 'keep-as-dep' | 'move-to-devdeps' | 'type-only' | 'unused';
  importCount: number;
  typeOnlyImportCount: number;
}

export interface DepClassificationResult {
  packages: PackageDepClassification[];
  typeOnlyCount: number;      // packages only used in type positions
  mixedCount: number;         // packages used in both
  valueOnlyCount: number;
}

interface EdgeRow {
  relation: string;
  confidence: string | null;
  src: string;
  tgt: string;
  tgt_name: string;
  properties: string | null;
}

function isExternalPackage(tgtName: string, tgtFilePath: string): boolean {
  // External if the file_path doesn't start with '/' or '.'
  // and doesn't look like a relative import
  if (!tgtFilePath) {
    // Fall back to name heuristic: starts with alpha, no path separators
    return /^[a-zA-Z@]/.test(tgtName) && !tgtName.includes('/') || /^@[a-zA-Z]/.test(tgtName);
  }
  return !tgtFilePath.startsWith('/') && !tgtFilePath.startsWith('.');
}

function extractPackageName(tgt: string): string {
  // Handle scoped packages like @scope/name
  if (tgt.startsWith('@')) {
    const parts = tgt.split('/');
    return parts.slice(0, 2).join('/');
  }
  // Plain packages: take only the package name portion (before any '/')
  return tgt.split('/')[0];
}

export function classifyDependencies(db: MonographDb): DepClassificationResult {
  const rows = db.prepare(`
    SELECT e.relation, e.confidence, n_src.file_path as src, n_tgt.file_path as tgt, n_tgt.name as tgt_name, e.properties
    FROM edges e
    JOIN nodes n_src ON n_src.id = e.source_id
    JOIN nodes n_tgt ON n_tgt.id = e.target_id
    WHERE e.relation = 'IMPORTS'
  `).all() as EdgeRow[];

  // Aggregate per external package
  const packageMap = new Map<string, { valueImports: number; typeImports: number }>();

  for (const row of rows) {
    const tgtPath = row.tgt ?? '';
    const tgtName = row.tgt_name ?? '';

    if (!isExternalPackage(tgtName, tgtPath)) continue;

    const packageName = extractPackageName(tgtName || tgtPath);
    if (!packageName) continue;

    // Check if type-only: parse properties JSON for isTypeOnly flag
    let isTypeOnly = false;
    if (row.properties) {
      try {
        const props = JSON.parse(row.properties) as Record<string, unknown>;
        isTypeOnly = props['isTypeOnly'] === true;
      } catch {
        // fall through — infer from confidence
      }
    }
    // Infer from confidence field if not set in properties
    if (!isTypeOnly && row.confidence === 'INFERRED') {
      isTypeOnly = true;
    }

    const existing = packageMap.get(packageName) ?? { valueImports: 0, typeImports: 0 };
    if (isTypeOnly) {
      existing.typeImports++;
    } else {
      existing.valueImports++;
    }
    packageMap.set(packageName, existing);
  }

  const packages: PackageDepClassification[] = [];

  for (const [packageName, counts] of packageMap) {
    const usedAsValue = counts.valueImports > 0;
    const usedAsTypeOnly = counts.typeImports > 0;

    let recommendation: PackageDepClassification['recommendation'];
    if (usedAsValue && usedAsTypeOnly) {
      recommendation = 'keep-as-dep';
    } else if (usedAsValue && !usedAsTypeOnly) {
      recommendation = 'keep-as-dep';
    } else if (!usedAsValue && usedAsTypeOnly) {
      recommendation = 'type-only';
    } else {
      recommendation = 'unused';
    }

    packages.push({
      packageName,
      usedAsValue,
      usedAsTypeOnly,
      recommendation,
      importCount: counts.valueImports + counts.typeImports,
      typeOnlyImportCount: counts.typeImports,
    });
  }

  // Sort: 'type-only' first, then 'unused', then rest
  const ORDER: Record<string, number> = { 'type-only': 0, 'unused': 1, 'move-to-devdeps': 2, 'keep-as-dep': 3 };
  packages.sort((a, b) => (ORDER[a.recommendation] ?? 3) - (ORDER[b.recommendation] ?? 3));

  const typeOnlyCount = packages.filter(p => p.recommendation === 'type-only').length;
  const mixedCount = packages.filter(p => p.usedAsValue && p.usedAsTypeOnly).length;
  const valueOnlyCount = packages.filter(p => p.usedAsValue && !p.usedAsTypeOnly).length;

  return {
    packages,
    typeOnlyCount,
    mixedCount,
    valueOnlyCount,
  };
}

// Walks source files, extracts function declarations, and uploads a keyed inventory
// for the "untracked functions" three-state coverage model.

export const INVENTORY_MAX_FUNCTIONS = 200_000;

export interface InventoryFunction {
  name: string;
  filePath: string;
  startLine: number;   // 1-based, Istanbul-compatible
  endLine: number;
}

export interface UploadInventoryArgs {
  projectId: string;
  root: string;
  pathPrefix?: string;
  apiKey?: string;
  apiBase?: string;
  failOnDirty?: boolean;
}

export interface UploadInventoryResult {
  uploaded: number;
  skipped: number;
  warnings: string[];
}

/** Rebase container WORKDIR path prefix to repo-relative path. */
export function normalizePathPrefix(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/\/$/, '');
}

/** Attempt to derive a project ID slug from a git remote URL. */
export function parseGitRemoteToProjectId(url: string): string {
  const match = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1].replace('/', '_') : 'unknown';
}

/** Extract function inventory from a source text (heuristic, no full AST). */
export function extractFunctionInventory(source: string, filePath: string): InventoryFunction[] {
  const results: InventoryFunction[] = [];
  const lines = source.split('\n');
  const funcRe = /(?:^|\s)(?:function|async function|const|let|var)\s+([a-zA-Z_$][\w$]*)\s*(?:=\s*(?:async\s*)?\(|[(<])/;
  const arrowRe = /(?:^|\s)(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\(/;
  const methodRe = /^\s*(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = funcRe.exec(line) ?? arrowRe.exec(line) ?? methodRe.exec(line);
    if (m && m[1] && !['if', 'while', 'for', 'switch', 'catch'].includes(m[1])) {
      results.push({ name: m[1], filePath, startLine: i + 1, endLine: i + 1 });
    }
  }
  return results;
}

/** Upload a function inventory to the cloud API. */
export async function uploadInventory(
  args: UploadInventoryArgs,
  functions: InventoryFunction[],
): Promise<UploadInventoryResult> {
  const base = args.apiBase ?? 'https://api.fallow.cloud/v1';
  const capped = functions.slice(0, INVENTORY_MAX_FUNCTIONS);
  const warnings: string[] = [];
  if (functions.length > INVENTORY_MAX_FUNCTIONS) {
    warnings.push(`Inventory capped at ${INVENTORY_MAX_FUNCTIONS} functions (${functions.length} found)`);
  }

  const res = await fetch(`${base}/projects/${encodeURIComponent(args.projectId)}/inventory`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ functions: capped, pathPrefix: args.pathPrefix }),
  });

  if (!res.ok) {
    warnings.push(`Upload failed: HTTP ${res.status}`);
    return { uploaded: 0, skipped: functions.length, warnings };
  }

  return { uploaded: capped.length, skipped: functions.length - capped.length, warnings };
}

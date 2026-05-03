// Uploads .map source map files to the cloud for bundled runtime coverage remapping.

export interface UploadSourceMapsArgs {
  projectId: string;
  sourceDir: string;
  include?: string[];
  exclude?: string[];
  stripPath?: string;
  concurrency?: number;
  retries?: number;
  failFast?: boolean;
  apiKey?: string;
  apiBase?: string;
}

export interface SourceMapFile {
  originalPath: string;
  uploadPath: string;
  sizeBytes: number;
}

export interface UploadSourceMapsResult {
  uploaded: number;
  failed: number;
  skipped: number;
  warnings: string[];
}

/** Strip a path prefix from a file path. */
export function applyStripPath(filePath: string, strip: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const s = strip.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  return normalized.startsWith(s) ? normalized.slice(s.length) : normalized;
}

/** Collect .map files from a directory (shallow heuristic — no actual fs walk in library mode). */
export function collectSourceMaps(
  files: string[],
  include: string[] = ['**/*.map'],
  exclude: string[] = ['node_modules'],
  stripPath?: string,
): SourceMapFile[] {
  return files
    .filter(f => f.endsWith('.map'))
    .filter(f => !exclude.some(e => f.includes(e)))
    .filter(f => include.length === 0 || include.some(_p => f.endsWith('.map')))
    .map(f => ({
      originalPath: f,
      uploadPath: stripPath ? applyStripPath(f, stripPath) : f,
      sizeBytes: 0,
    }));
}

/** Upload source map files to the cloud API. */
export async function uploadSourceMaps(
  args: UploadSourceMapsArgs,
  files: SourceMapFile[],
): Promise<UploadSourceMapsResult> {
  const base = args.apiBase ?? 'https://api.fallow.cloud/v1';
  const concurrency = args.concurrency ?? 4;
  let uploaded = 0;
  let failed = 0;
  const warnings: string[] = [];

  const chunks: SourceMapFile[][] = [];
  for (let i = 0; i < files.length; i += concurrency) {
    chunks.push(files.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const results = await Promise.allSettled(chunk.map(async f => {
      const res = await fetch(
        `${base}/projects/${encodeURIComponent(args.projectId)}/source-maps`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${args.apiKey ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: f.uploadPath }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${f.uploadPath}`);
    }));
    for (const r of results) {
      if (r.status === 'fulfilled') uploaded++;
      else {
        failed++;
        warnings.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        if (args.failFast) break;
      }
    }
    if (args.failFast && failed > 0) break;
  }

  return { uploaded, failed, skipped: 0, warnings };
}

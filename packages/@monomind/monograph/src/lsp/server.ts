import { createInterface } from 'readline';
import type { MonographDb } from '../storage/db.js';

// Minimal LSP stdio server exposing monograph diagnostics
// Start with: node server.js --db /path/to/monograph.db

export interface LspDiagnostic {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity: 1 | 2 | 3 | 4;   // Error=1, Warning=2, Information=3, Hint=4
  source: 'monograph';
  message: string;
  code?: string;
}

const FILE_RANGE = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

export function buildDiagnosticsFromDb(db: MonographDb, repoRoot: string): Map<string, LspDiagnostic[]> {
  const result = new Map<string, LspDiagnostic[]>();

  const normRoot = repoRoot.replace(/\/$/, '');

  function uriForPath(filePath: string): string {
    if (filePath.startsWith('/')) {
      return `file://${filePath}`;
    }
    return `file:///${normRoot}/${filePath}`.replace(/\/+/g, '/').replace(/^file:\/\/\//, 'file:///');
  }

  function addDiag(filePath: string, diag: LspDiagnostic): void {
    const uri = uriForPath(filePath);
    const list = result.get(uri) ?? [];
    list.push(diag);
    result.set(uri, list);
  }

  // Unreachable files → Warning
  try {
    const unreachableFiles = db.prepare(
      `SELECT file_path FROM nodes
       WHERE label = 'File'
         AND json_extract(properties, '$.reachabilityRole') = 'unreachable'`
    ).all() as { file_path: string }[];

    for (const row of unreachableFiles) {
      if (!row.file_path) continue;
      const uri = uriForPath(row.file_path);
      addDiag(row.file_path, {
        uri,
        range: FILE_RANGE,
        severity: 2,
        source: 'monograph',
        message: 'Unreachable file: not imported by any runtime entry point',
        code: 'unreachable-file',
      });
    }
  } catch {
    // Table or column not available; skip
  }

  // God nodes — query node_properties for the threshold used during build
  try {
    // Use p95 fan-in as the threshold (consistent with god-nodes pipeline phase)
    const GOD_NODE_DEGREE_THRESHOLD = 10; // fallback if we can't compute from DB

    const fanInRows = db.prepare(
      `SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id`
    ).all() as { target_id: string; c: number }[];

    const sorted = fanInRows.map(r => r.c).sort((a, b) => a - b);
    let threshold = GOD_NODE_DEGREE_THRESHOLD;
    if (sorted.length > 0) {
      const idx = Math.min(Math.floor(0.95 * sorted.length), sorted.length - 1);
      threshold = sorted[idx];
    }

    const fanInByNode = new Map<string, number>();
    for (const row of fanInRows) {
      fanInByNode.set(row.target_id, row.c);
    }

    const godNodeRows = db.prepare(
      `SELECT n.id, n.file_path, COUNT(e.source_id) as fan_in
       FROM nodes n
       JOIN edges e ON e.target_id = n.id
       WHERE n.label = 'File'
       GROUP BY n.id
       HAVING COUNT(e.source_id) > ?`
    ).all(threshold) as { id: string; file_path: string; fan_in: number }[];

    const totalNodes = (db.prepare('SELECT COUNT(*) as n FROM nodes').get() as { n: number }).n;

    for (const row of godNodeRows) {
      if (!row.file_path) continue;
      const pct = totalNodes > 0 ? Math.round((row.fan_in / totalNodes) * 100) : 0;
      const uri = uriForPath(row.file_path);
      addDiag(row.file_path, {
        uri,
        range: FILE_RANGE,
        severity: 2,
        source: 'monograph',
        message: `God node: ${row.fan_in} incoming dependencies (p${pct})`,
        code: 'god-node',
      });
    }
  } catch {
    // Skip if edges table not available
  }

  // STRUCTURALLY_SIMILAR edges → Information
  try {
    const similarEdges = db.prepare(
      `SELECT e.source_id, e.target_id, e.confidence_score,
              ns.file_path as source_path, nt.file_path as target_path
       FROM edges e
       JOIN nodes ns ON ns.id = e.source_id
       JOIN nodes nt ON nt.id = e.target_id
       WHERE e.relation = 'STRUCTURALLY_SIMILAR'`
    ).all() as {
      source_id: string;
      target_id: string;
      confidence_score: number;
      source_path: string;
      target_path: string;
    }[];

    for (const row of similarEdges) {
      if (!row.source_path || !row.target_path) continue;
      const score = Math.round((row.confidence_score ?? 0) * 100);
      const uri = uriForPath(row.source_path);
      addDiag(row.source_path, {
        uri,
        range: FILE_RANGE,
        severity: 3,
        source: 'monograph',
        message: `Similar to ${row.target_path} (similarity: ${score}%)`,
        code: 'structurally-similar',
      });
    }
  } catch {
    // Skip if not available
  }

  return result;
}

// LSP JSON-RPC 2.0 over stdio
function writeMessage(msg: unknown): void {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n`;
  process.stdout.write(header + json);
}

function sendResponse(id: number | string | null, result: unknown): void {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendNotification(method: string, params: unknown): void {
  writeMessage({ jsonrpc: '2.0', method, params });
}

function publishDiagnostics(diagnosticsMap: Map<string, LspDiagnostic[]>): void {
  for (const [uri, diagnostics] of diagnosticsMap) {
    sendNotification('textDocument/publishDiagnostics', { uri, diagnostics });
  }
}

export function startLspServer(db: MonographDb, repoRoot: string): void {
  // Build diagnostics once on startup
  const diagnosticsMap = buildDiagnosticsFromDb(db, repoRoot);

  // LSP header framing: read Content-Length header, then body
  let buffer = Buffer.alloc(0);
  let expectedLength: number | null = null;

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      if (expectedLength === null) {
        // Try to parse headers
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const headerStr = buffer.slice(0, headerEnd).toString('utf-8');
        const contentLengthMatch = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!contentLengthMatch) {
          // Malformed; skip
          buffer = buffer.slice(headerEnd + 4);
          break;
        }
        expectedLength = parseInt(contentLengthMatch[1], 10);
        buffer = buffer.slice(headerEnd + 4);
      }

      if (buffer.length < expectedLength) break;

      const body = buffer.slice(0, expectedLength).toString('utf-8');
      buffer = buffer.slice(expectedLength);
      expectedLength = null;

      let msg: { jsonrpc: string; id?: number | string; method?: string; params?: unknown };
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }

      const { id, method } = msg;

      switch (method) {
        case 'initialize':
          sendResponse(id ?? null, {
            capabilities: {
              textDocumentSync: 1,
              diagnosticProvider: {},
            },
          });
          break;

        case 'initialized':
          // Push all diagnostics on connection established
          publishDiagnostics(diagnosticsMap);
          break;

        case 'shutdown':
          sendResponse(id ?? null, null);
          break;

        case 'exit':
          process.exit(0);
          break;

        default:
          // Unhandled request — send method not found
          if (id !== undefined && id !== null) {
            writeMessage({
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: 'Method not found' },
            });
          }
          break;
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

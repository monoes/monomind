import { statSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import type { PipelineContext } from '../../types.js';
import type { BridgeAdapter, BridgeEndpoint } from './types.js';

const JS_TS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

const IPC_MAIN_RE = /\bipcMain\.(?:handle|on)\(\s*['"]([^'"]+)['"]/g;
const IPC_RENDERER_RE = /\bipcRenderer\.(?:invoke|send)\(\s*['"]([^'"]+)['"]/g;

function safeReadSource(absPath: string, maxBytes: number): string | undefined {
  try {
    const stat = statSync(absPath);
    if (stat.size > maxBytes) return undefined;
    return readFileSync(absPath, 'utf-8');
  } catch {
    return undefined;
  }
}

function extractChannels(re: RegExp, source: string): string[] {
  re.lastIndex = 0;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.push(m[1]!);
  return names;
}

/**
 * Electron IPC (main process JS <-> renderer/preload JS): both sides are the
 * same language, so nothing in the existing same-file import resolution
 * connects them — the only link is the shared channel-name string literal
 * passed to `ipcMain.handle/on` (definition) and `ipcRenderer.invoke/send`
 * (call site). Neither side has call-expression-level node granularity from
 * a plain regex scan, so both attach to their containing File node.
 */
export const electronIpcAdapter: BridgeAdapter = {
  name: 'electron-ipc',

  detect(ctx, filePaths) {
    let hasMain = false;
    let hasRenderer = false;
    for (const relPath of filePaths) {
      if (!JS_TS_EXT.has(extname(relPath))) continue;
      const source = safeReadSource(join(ctx.repoPath, relPath), ctx.options.maxFileSizeBytes);
      if (!source) continue;
      if (!hasMain && /\bipcMain\.(?:handle|on)\(/.test(source)) hasMain = true;
      if (!hasRenderer && /\bipcRenderer\.(?:invoke|send)\(/.test(source)) hasRenderer = true;
      if (hasMain && hasRenderer) return true;
    }
    return false;
  },

  findDefinitions(ctx, filePaths) {
    const endpoints: BridgeEndpoint[] = [];
    for (const relPath of filePaths) {
      if (!JS_TS_EXT.has(extname(relPath))) continue;
      const source = safeReadSource(join(ctx.repoPath, relPath), ctx.options.maxFileSizeBytes);
      if (!source) continue;
      const channels = extractChannels(IPC_MAIN_RE, source);
      if (channels.length === 0) continue;

      const fileRow = ctx.db
        .prepare(`SELECT id FROM nodes WHERE label = 'File' AND file_path = ?`)
        .get(relPath) as { id: string } | undefined;
      if (!fileRow) continue;

      for (const channel of channels) endpoints.push({ key: channel, nodeId: fileRow.id, language: 'javascript' });
    }
    return endpoints;
  },

  findCallSites(ctx, filePaths) {
    const endpoints: BridgeEndpoint[] = [];
    for (const relPath of filePaths) {
      if (!JS_TS_EXT.has(extname(relPath))) continue;
      const source = safeReadSource(join(ctx.repoPath, relPath), ctx.options.maxFileSizeBytes);
      if (!source) continue;
      const channels = extractChannels(IPC_RENDERER_RE, source);
      if (channels.length === 0) continue;

      const fileRow = ctx.db
        .prepare(`SELECT id FROM nodes WHERE label = 'File' AND file_path = ?`)
        .get(relPath) as { id: string } | undefined;
      if (!fileRow) continue;

      for (const channel of channels) endpoints.push({ key: channel, nodeId: fileRow.id, language: 'javascript' });
    }
    return endpoints;
  },
};

import { statSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import type { PipelineContext } from '../../types.js';
import type { BridgeAdapter, BridgeEndpoint } from './types.js';

const RUST_EXT = new Set(['.rs']);
const JS_TS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

/** `#[tauri::command]` (with or without args) directly above an fn declaration. */
const TAURI_COMMAND_RE = /#\[tauri::command(?:\([^)]*\))?\]\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/g;

/**
 * Tauri's `invoke(...)` call from the JS/TS side, e.g.
 * `import { invoke } from '@tauri-apps/api/core'; invoke('my_command', {...})`.
 * We don't verify the import — matching the call shape is enough signal here,
 * same tradeoff extractor.ts already makes for plain call-site regexes.
 */
const TAURI_INVOKE_RE = /\binvoke\(\s*['"]([^'"]+)['"]/g;

function safeReadSource(absPath: string, maxBytes: number): string | undefined {
  try {
    const stat = statSync(absPath);
    if (stat.size > maxBytes) return undefined;
    return readFileSync(absPath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Tauri (Rust <-> JS/TS): a `#[tauri::command]`-annotated Rust fn is invoked
 * from the frontend by name via `invoke("name", ...)` — a string-literal
 * match, not a generated file. The Rust side already has a real Function
 * node (from the Rust extractor); the JS/TS call site does not, so it's
 * attached to its containing File node.
 */
export const tauriAdapter: BridgeAdapter = {
  name: 'tauri',

  // A bare .rs file isn't a Tauri signal by itself (a repo can have unrelated
  // Rust code alongside a JS/TS frontend) — require an actual
  // #[tauri::command] annotation before this adapter runs at all.
  detect(ctx, filePaths) {
    for (const relPath of filePaths) {
      if (!RUST_EXT.has(extname(relPath))) continue;
      const source = safeReadSource(join(ctx.repoPath, relPath), ctx.options.maxFileSizeBytes);
      if (!source) continue;
      TAURI_COMMAND_RE.lastIndex = 0;
      if (TAURI_COMMAND_RE.test(source)) return true;
    }
    return false;
  },

  findDefinitions(ctx, filePaths) {
    const endpoints: BridgeEndpoint[] = [];
    for (const relPath of filePaths) {
      if (!RUST_EXT.has(extname(relPath))) continue;
      const source = safeReadSource(join(ctx.repoPath, relPath), ctx.options.maxFileSizeBytes);
      if (!source) continue;

      TAURI_COMMAND_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      const names: string[] = [];
      while ((m = TAURI_COMMAND_RE.exec(source)) !== null) names.push(m[1]!);
      if (names.length === 0) continue;

      const rows = ctx.db
        .prepare(`SELECT id, name FROM nodes WHERE label = 'Function' AND language = 'rust' AND file_path = ?`)
        .all(relPath) as { id: string; name: string }[];
      const byName = new Map(rows.map((r) => [r.name, r.id]));
      for (const name of names) {
        const nodeId = byName.get(name);
        if (nodeId) endpoints.push({ key: name, nodeId, language: 'rust' });
      }
    }
    return endpoints;
  },

  findCallSites(ctx, filePaths) {
    const endpoints: BridgeEndpoint[] = [];
    for (const relPath of filePaths) {
      if (!JS_TS_EXT.has(extname(relPath))) continue;
      const source = safeReadSource(join(ctx.repoPath, relPath), ctx.options.maxFileSizeBytes);
      if (!source) continue;

      TAURI_INVOKE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      const commandNames: string[] = [];
      while ((m = TAURI_INVOKE_RE.exec(source)) !== null) commandNames.push(m[1]!);
      if (commandNames.length === 0) continue;

      const fileRow = ctx.db
        .prepare(`SELECT id FROM nodes WHERE label = 'File' AND file_path = ?`)
        .get(relPath) as { id: string } | undefined;
      if (!fileRow) continue;

      for (const name of commandNames) {
        endpoints.push({ key: name, nodeId: fileRow.id, language: 'javascript' });
      }
    }
    return endpoints;
  },
};

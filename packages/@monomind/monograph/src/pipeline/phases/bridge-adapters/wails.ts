import type { PipelineContext } from '../../types.js';
import type { BridgeAdapter, BridgeEndpoint } from './types.js';

const WAILS_BINDING_RE = /wailsjs\/go\//i;

/**
 * Wails (Go <-> JS/TS): `wails` generates a JS/TS binding file per bound Go
 * struct at `frontend/**\/wailsjs/go/<package>/<Struct>.js`, exporting one
 * function per Go method with the exact same name. Both sides are already
 * parsed into real Function/Method nodes by the Go and TS/JS extractors —
 * this adapter just links them by name across the language boundary.
 */
export const wailsAdapter: BridgeAdapter = {
  name: 'wails',

  detect(_ctx, filePaths) {
    return filePaths.some((p) => WAILS_BINDING_RE.test(p));
  },

  findDefinitions(ctx) {
    const rows = ctx.db
      .prepare(`SELECT id, name, language FROM nodes WHERE label = 'Method' AND language = 'go' AND file_path IS NOT NULL`)
      .all() as { id: string; name: string; language: string }[];
    return rows.map((r): BridgeEndpoint => ({ key: r.name, nodeId: r.id, language: r.language }));
  },

  findCallSites(ctx) {
    const rows = ctx.db
      .prepare(`SELECT id, name, language, file_path FROM nodes WHERE label = 'Function' AND file_path LIKE '%wailsjs/go/%'`)
      .all() as { id: string; name: string; language: string; file_path: string }[];
    return rows.map((r): BridgeEndpoint => ({ key: r.name, nodeId: r.id, language: r.language ?? 'javascript' }));
  },
};

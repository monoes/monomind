import type { BridgeAdapter } from './types.js';
import { wailsAdapter } from './wails.js';
import { tauriAdapter } from './tauri.js';
import { electronIpcAdapter } from './electron-ipc.js';

// Every adapter here has an unambiguous detect() signal (a generated binding
// path, or a framework-specific call shape that only appears when its
// framework is actually in use) — so all run unconditionally; detect() is
// what keeps the no-op cost near zero for repos that don't use any of them.
export const BUILTIN_BRIDGE_ADAPTERS: BridgeAdapter[] = [
  wailsAdapter,
  tauriAdapter,
  electronIpcAdapter,
];

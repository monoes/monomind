/**
 * Browser MCP Tools
 *
 * Uses @monoes/monobrowse CDP client directly — no external binary required.
 * Sessions are keyed by session ID; each maps to a persistent CDP connection
 * on the configured port (default: MONOBROWSE_CDP_PORT env var or 9422).
 */

import { browserInstrumentTools } from './browser-instrument-tools.js';
import { browserProfileTools } from './browser-profile-tools.js';
import { browserInfoTools } from './browser-tools-info.js';
import { browserInteractionTools } from './browser-tools-interaction.js';
import { browserNavigationTools } from './browser-tools-navigation.js';
import type { MCPTool } from './types.js';

// ---------------------------------------------------------------------------
// Exported tool list
// ---------------------------------------------------------------------------

export const browserTools: MCPTool[] = [
  // Navigation, snapshot, interaction, info/wait/eval/session tools live in
  // sibling modules to keep each file readable; they are part of the same
  // `browser_*` surface.
  ...browserNavigationTools,
  ...browserInteractionTools,
  ...browserInfoTools,
  // ==========================================================================
  // Instrumentation Tools
  // ==========================================================================
  // Console/network/vitals and profiling/emulation live in sibling modules to
  // keep each file readable; they are part of the same `browser_*` surface.
  ...browserInstrumentTools,
  ...browserProfileTools,
];

export default browserTools;

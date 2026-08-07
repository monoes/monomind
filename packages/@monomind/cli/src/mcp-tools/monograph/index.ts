import type { MCPTool } from '../types.js';

// Re-export shared utilities that were previously exported from monograph-tools.ts
export { preferSymbolHits } from './shared.js';

// ── Tool imports ────────────────────────────────────────────────────────────

import { monographBuildTool, monographWatchTool, monographWatchStopTool, monographDetectChangesTool, monographInjectContextTool, monographSkillGenTool, monographInstallSkillsTool } from './build-tools.js';
import { monographQueryTool, monographSuggestTool, monographContextTool, monographNeighborsTool, monographGetNodeTool, monographGodNodesTool, monographAugmentTool, monographCypherTool, monographShortestPathTool } from './query-tools.js';
import { monographImpactTool, monographApiImpactTool, monographDeadCodeTool, monographRouteMapTool, monographShapeCheckTool, monographRenameTool, monographToolMapTool } from './impact-tools.js';
import { monographCommunityTool, monographSurprisesTool, monographGroupListTool, monographGroupQueryTool, monographGroupSyncTool, monographGroupContractsTool, monographGroupStatusTool, monographListReposTool } from './group-tools.js';
import { monographVisualizeTool, monographExportTool, monographSnapshotTool, monographDiffTool, monographReportTool, monographWikiTool, monographWikiBuildTool, monographServeTool } from './visualize-tools.js';
import { monographStatsTool, monographHealthTool, monographStalenessTool, monographDoctorTool } from './health-tools.js';
import { monographAgentHistoryTool, monographAgentPatternsTool, monographAgentRecordTool } from './agent-history-tools.js';

// ── Tool arrays ─────────────────────────────────────────────────────────────

// Advanced tools are only exposed over MCP when MONOGRAPH_MCP_ADVANCED=1.
const ADVANCED = process.env['MONOGRAPH_MCP_ADVANCED'] === '1';

/** Default-exposed core tools (19). */
const coreMonographTools: MCPTool[] = [
  monographBuildTool,
  monographQueryTool,
  monographSuggestTool,
  monographImpactTool,
  monographContextTool,
  monographNeighborsTool,
  monographDeadCodeTool,
  monographStatsTool,
  monographHealthTool,
  monographAugmentTool,
  monographGodNodesTool,
  monographDetectChangesTool,
  monographGetNodeTool,
  monographApiImpactTool,
  monographRouteMapTool,
  monographStalenessTool,
  monographWatchTool,
  monographWatchStopTool,
  monographDoctorTool,
];

/** Advanced tools — gated behind MONOGRAPH_MCP_ADVANCED=1. */
const advancedMonographTools: MCPTool[] = [
  monographCypherTool,
  monographShortestPathTool,
  monographCommunityTool,
  monographSurprisesTool,
  monographShapeCheckTool,
  monographRenameTool,
  monographToolMapTool,
  monographServeTool,
  monographVisualizeTool,
  monographSnapshotTool,
  monographDiffTool,
  monographReportTool,
  monographExportTool,
  monographWikiTool,
  monographWikiBuildTool,
  monographSkillGenTool,
  monographInstallSkillsTool,
  monographInjectContextTool,
  monographGroupListTool,
  monographGroupQueryTool,
  monographGroupSyncTool,
  monographGroupContractsTool,
  monographGroupStatusTool,
  monographListReposTool,
  monographAgentHistoryTool,
  monographAgentPatternsTool,
  monographAgentRecordTool,
];

/**
 * Full tool list regardless of gating — used by the graphify compat shims,
 * which must resolve targets (e.g. monograph_community) even when the
 * advanced set is not exposed over MCP.
 */
export const allMonographTools: MCPTool[] = [...coreMonographTools, ...advancedMonographTools];

export const monographTools: MCPTool[] = ADVANCED ? allMonographTools : coreMonographTools;

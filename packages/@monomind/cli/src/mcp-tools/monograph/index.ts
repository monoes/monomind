import type { MCPTool } from '../types.js';

// Re-export shared utilities that were previously exported from monograph-tools.ts
export { preferSymbolHits } from './shared.js';

// ── Tool imports ────────────────────────────────────────────────────────────

import {
  monographAgentHistoryTool,
  monographAgentPatternsTool,
  monographAgentRecordTool,
} from './agent-history-tools.js';
import {
  monographBuildTool,
  monographDetectChangesTool,
  monographInjectContextTool,
  monographInstallSkillsTool,
  monographSkillGenTool,
  monographWatchStopTool,
  monographWatchTool,
} from './build-tools.js';
import {
  monographCommunityTool,
  monographGroupContractsTool,
  monographGroupListTool,
  monographGroupQueryTool,
  monographGroupStatusTool,
  monographGroupSyncTool,
  monographListReposTool,
  monographSurprisesTool,
} from './group-tools.js';
import {
  monographDoctorTool,
  monographHealthTool,
  monographStalenessTool,
  monographStatsTool,
} from './health-tools.js';
import {
  monographApiImpactTool,
  monographDeadCodeTool,
  monographImpactTool,
  monographRenameTool,
  monographRouteMapTool,
  monographShapeCheckTool,
  monographToolMapTool,
} from './impact-tools.js';
import {
  monographAugmentTool,
  monographContextTool,
  monographCypherTool,
  monographGetNodeTool,
  monographGodNodesTool,
  monographNeighborsTool,
  monographQueryTool,
  monographShortestPathTool,
  monographSuggestTool,
} from './query-tools.js';
import {
  monographDiffTool,
  monographExportTool,
  monographReportTool,
  monographServeTool,
  monographSnapshotTool,
  monographVisualizeTool,
  monographWikiBuildTool,
  monographWikiTool,
} from './visualize-tools.js';

// ── Tool arrays ─────────────────────────────────────────────────────────────

// Advanced tools are only exposed over MCP when MONOGRAPH_MCP_ADVANCED=1.
const ADVANCED = process.env.MONOGRAPH_MCP_ADVANCED === '1';

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

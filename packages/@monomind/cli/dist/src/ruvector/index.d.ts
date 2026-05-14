/**
 * RuVector Integration Module for Monomind CLI
 *
 * Provides integration with @ruvector packages for:
 * - Q-Learning based task routing
 * - Mixture of Experts (MoE) routing
 * - AST code analysis
 * - Diff classification
 * - Coverage-based routing
 * - Graph boundary analysis
 * - Flash Attention for faster similarity computations
 *
 * @module @monomind/cli/ruvector
 */
export { QLearningRouter, createQLearningRouter, type QLearningRouterConfig, type RouteDecision } from './q-learning-router.js';
export { MoERouter, getMoERouter, resetMoERouter, createMoERouter, EXPERT_NAMES, NUM_EXPERTS, INPUT_DIM, HIDDEN_DIM, type ExpertType, type MoERouterConfig, type RoutingResult, type LoadBalanceStats, } from './moe-router.js';
export { ASTAnalyzer, createASTAnalyzer, type ASTAnalysis, type ASTNode, type ASTAnalyzerConfig } from './ast-analyzer.js';
export { DiffClassifier, createDiffClassifier, analyzeDiff, analyzeDiffSync, assessFileRisk, assessOverallRisk, classifyDiff, suggestReviewers, getGitDiffNumstat, getGitDiffNumstatAsync, clearDiffCache, clearAllDiffCaches, type DiffClassification, type DiffHunk, type DiffChange, type FileDiff, type DiffAnalysis, type DiffClassifierConfig, type DiffFile, type RiskLevel, type FileRisk, type OverallRisk, type DiffAnalysisResult, } from './diff-classifier.js';
export { CoverageRouter, createCoverageRouter, coverageRoute, coverageSuggest, coverageGaps, clearCoverageCache, getCoverageCacheStats, type CoverageRouterConfig, type FileCoverage, type CoverageReport, type CoverageRouteResult, type CoverageSuggestResult, type CoverageGapsResult, type CoverageRouteOptions, type CoverageSuggestOptions, type CoverageGapsOptions, } from './coverage-router.js';
export { coverageRouterTools, hooksCoverageRoute, hooksCoverageSuggest, hooksCoverageGaps } from './coverage-tools.js';
export { buildDependencyGraph, analyzeGraph, analyzeMinCutBoundaries, analyzeModuleCommunities, detectCircularDependencies, exportToDot, loadRuVector, fallbackMinCut, fallbackLouvain, clearGraphCaches, getGraphCacheStats, type GraphNode, type GraphEdge, type DependencyGraph, type MinCutBoundary, type ModuleCommunity, type CircularDependency, type GraphAnalysisResult, } from './graph-analyzer.js';
export { FlashAttention, getFlashAttention, resetFlashAttention, computeAttention, benchmarkFlashAttention, getFlashAttentionSpeedup, type FlashAttentionConfig, type AttentionResult, type BenchmarkResult, } from './flash-attention.js';
export { ModelRouter, getModelRouter, resetModelRouter, createModelRouter, routeToModel, routeToModelFull, analyzeTaskComplexity, getModelRouterStats, recordModelOutcome, MODEL_CAPABILITIES, COMPLEXITY_INDICATORS, type ClaudeModel, type ModelRouterConfig, type ModelRoutingResult, type ComplexityAnalysis, } from './model-router.js';
export { SemanticRouter, createSemanticRouter, type Intent, type RouteResult, type RouterConfig, } from './semantic-router.js';
export { isRuvllmWasmAvailable, initRuvllmWasm, getRuvllmStatus, createHnswRouter, createSonaInstant, createMicroLora, formatChat, createKvCache, createGenerateConfig, createBufferPool, createInferenceArena, HNSW_MAX_SAFE_PATTERNS, type HnswRouterConfig, type HnswPattern, type HnswRouteResult, type SonaConfig, type MicroLoraConfig, type ChatMessage, type GenerateOptions, type RuvllmStatus, } from './ruvllm-wasm.js';
export { isAgentWasmAvailable, initAgentWasm, createWasmAgent, promptWasmAgent, executeWasmTool, getWasmAgent, listWasmAgents, terminateWasmAgent, getWasmAgentState, getWasmAgentTools, getWasmAgentTodos, exportWasmState, createWasmMcpServer, listGalleryTemplates, getGalleryCount, getGalleryCategories, searchGalleryTemplates, getGalleryTemplate, createAgentFromTemplate, buildRvfContainer, buildRvfFromTemplate, type WasmAgentConfig, type WasmAgentInfo, type GalleryTemplate, type GalleryTemplateDetail, type ToolResult, } from './agent-wasm.js';
/**
 * Check if ruvector packages are available
 */
export declare function isRuvectorAvailable(): Promise<boolean>;
/**
 * Check if @ruvector/learning-wasm is available and loadable
 */
export declare function isWasmBackendAvailable(): Promise<boolean>;
/**
 * Get ruvector version if available
 */
export declare function getRuvectorVersion(): Promise<string | null>;
//# sourceMappingURL=index.d.ts.map
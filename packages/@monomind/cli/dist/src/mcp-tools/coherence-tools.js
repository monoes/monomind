/**
 * Coherence Tools — built-in coherence MCP tools
 *
 * Wraps all 6 tools for coherence check, spectral, causal, consensus, topology, memory gate
 * (coherence_*). Their inputSchemas are already plain JSON Schema.
 */
import { coherenceCheckTool } from './coherence/coherence-check.js';
import { spectralAnalyzeTool } from './coherence/spectral-analyze.js';
import { causalInferTool } from './coherence/causal-infer.js';
import { consensusVerifyTool } from './coherence/consensus-verify.js';
import { quantumTopologyTool } from './coherence/quantum-topology.js';
import { memoryGateTool } from './coherence/memory-gate.js';
// monolean: remap name only; all other fields (inputSchema, handler, etc.) reused as-is
function renamed(tool, name) {
    return { ...tool, name };
}
export const coherenceTools = [
    renamed(coherenceCheckTool, 'coherence_check'),
    renamed(spectralAnalyzeTool, 'coherence_spectral'),
    renamed(causalInferTool, 'coherence_causal'),
    renamed(consensusVerifyTool, 'coherence_consensus'),
    renamed(quantumTopologyTool, 'coherence_topology'),
    renamed(memoryGateTool, 'coherence_memory_gate'),
];
//# sourceMappingURL=coherence-tools.js.map
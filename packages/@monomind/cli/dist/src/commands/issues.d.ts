/**
 * v1 Issues Command
 *
 * Implements ADR-016: Collaborative Issue Claims for Human-Agent Workflows
 *
 * Commands:
 * - issues list       List all claims
 * - issues claim      Claim an issue
 * - issues release    Release a claim
 * - issues handoff    Request handoff
 * - issues status     Update claim status
 * - issues stealable  List stealable issues
 * - issues steal      Steal an issue
 * - issues load       View agent load
 * - issues rebalance  Rebalance swarm
 * - issues board      Visual board view
 */
import type { Command } from '../types.js';
export declare const issuesCommand: Command;
export default issuesCommand;
//# sourceMappingURL=issues.d.ts.map
/**
 * Hive-Mind MCP Tools for CLI
 *
 * Tool definitions for multi-agent coordination and voting.
 *
 * Honest scope note: the "consensus strategies" here are vote-count thresholds
 * applied to a single in-process tally — NOT distributed consensus protocols.
 * There is no log replication, leader election, network partitioning, or
 * adversarial fault model. 'bft' = require 2f+1 votes, 'raft' = require
 * majority, 'quorum' = configurable preset (majority/supermajority/unanimous).
 * The names are kept for CLI/API compatibility.
 */
import { type MCPTool } from './types.js';
export declare const hiveMindTools: MCPTool[];
//# sourceMappingURL=hive-mind-tools.d.ts.map
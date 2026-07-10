/**
 * CLI Hive Mind Command
 * Single-process vote-counting coordination for multi-agent decisions.
 * Consensus strategies (BFT, Raft, Quorum) implement threshold arithmetic
 * with Ed25519 vote signing — not distributed networking protocols.
 * Gossip and CRDT strategies are planned but not yet implemented.
 */
import type { Command } from '../types.js';
export declare const hiveMindCommand: Command;
export default hiveMindCommand;
//# sourceMappingURL=hive-mind.d.ts.map
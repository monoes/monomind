/**
 * Communication Flow Types (Task 40)
 *
 * Directed communication graph types for swarm flow enforcement.
 */

/** Directed edge: [senderSlug, receiverSlug] */
export type FlowEdge = [string, string];

/** Configuration for a swarm's communication graph */
export interface SwarmFlowConfig {
  swarmId: string;
  topology: 'hierarchical' | 'mesh' | 'ring' | 'star' | 'adaptive';
  communicationFlows: FlowEdge[];
  enforceFlows: boolean;
}

/** Recorded violation of a communication flow rule */
export interface FlowViolation {
  violationId: string;
  swarmId: string;
  fromAgentSlug: string;
  toAgentSlug: string;
  messagePreview: string;
  detectedAt: string;
  action: 'blocked' | 'logged';
}

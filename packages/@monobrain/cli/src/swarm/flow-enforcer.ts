/**
 * FlowEnforcer (Task 40)
 *
 * Checks messages against the communication graph and records violations.
 * No database dependency — violations stored in memory.
 */

import { randomUUID } from 'crypto';
import type { FlowViolation } from '../../../shared/src/types/communication-flow.js';
import type { CommunicationGraph } from './communication-graph.js';

export class FlowEnforcer {
  private readonly graph: CommunicationGraph;
  private readonly swarmId: string;
  private readonly enforce: boolean;
  private readonly violations: FlowViolation[] = [];

  constructor(graph: CommunicationGraph, swarmId: string, enforceMode: boolean) {
    this.graph = graph;
    this.swarmId = swarmId;
    this.enforce = enforceMode;
  }

  /**
   * Check whether a message is authorized and record any violation.
   *
   * - Authorized: returns { authorized: true }
   * - Unauthorized + enforce=true: returns { authorized: false, violation } (blocked)
   * - Unauthorized + enforce=false: returns { authorized: true, violation } (logged)
   */
  checkAndRecord(
    fromSlug: string,
    toSlug: string,
    messageContent: string,
  ): { authorized: boolean; violation?: FlowViolation } {
    if (this.graph.isAuthorized(fromSlug, toSlug)) {
      return { authorized: true };
    }

    const violation: FlowViolation = {
      violationId: randomUUID(),
      swarmId: this.swarmId,
      fromAgentSlug: fromSlug,
      toAgentSlug: toSlug,
      messagePreview: messageContent.slice(0, 120),
      detectedAt: new Date().toISOString(),
      action: this.enforce ? 'blocked' : 'logged',
    };

    this.violations.push(violation);

    return {
      authorized: !this.enforce,
      violation,
    };
  }

  /** Return all recorded violations */
  getViolations(): FlowViolation[] {
    return [...this.violations];
  }
}

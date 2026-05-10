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
  private static readonly MAX_VIOLATIONS = 1000;

  constructor(graph: CommunicationGraph, swarmId: string, enforceMode: boolean) {
    this.graph = graph;
    this.swarmId = swarmId;
    this.enforce = enforceMode;
  }

  /**
   * Check whether a message is authorized and record any violation.
   *
   * Returns BOTH `authorized` (the policy decision) and `enforced` (whether the
   * decision is actually applied). Callers must read both — taking action based
   * solely on `authorized` would let `enforce=false` silently bypass the policy.
   */
  checkAndRecord(
    fromSlug: string,
    toSlug: string,
    messageContent: string,
  ): { authorized: boolean; enforced: boolean; violation?: FlowViolation } {
    if (this.graph.isAuthorized(fromSlug, toSlug)) {
      return { authorized: true, enforced: this.enforce };
    }

    const violation: FlowViolation = {
      violationId: randomUUID(),
      swarmId: this.swarmId,
      fromAgentSlug: fromSlug,
      toAgentSlug: toSlug,
      // Truncated preview only; for sensitive traffic, redact via a hook before
      // it reaches this enforcer. Cap means an attacker can't fill memory with
      // long messages either.
      messagePreview: messageContent.slice(0, 120),
      detectedAt: new Date().toISOString(),
      action: this.enforce ? 'blocked' : 'logged',
    };

    // FIFO eviction so a sustained attack can't grow violations to GB-scale.
    if (this.violations.length >= FlowEnforcer.MAX_VIOLATIONS) {
      this.violations.shift();
    }
    this.violations.push(violation);

    return {
      // Policy decision: NOT authorized. Whether the caller blocks the send is
      // governed by `enforced`, which is exposed separately so callers cannot
      // accidentally treat audit-mode as "permitted".
      authorized: false,
      enforced: this.enforce,
      violation,
    };
  }

  /** Return all recorded violations */
  getViolations(): FlowViolation[] {
    return [...this.violations];
  }
}

/**
 * μACP — Minimal Agent Coordination Protocol
 *
 * A four-verb, formally-minimal coordination substrate for multi-agent
 * agreement.  Designed to be the smallest possible contract two agents
 * need to coordinate a decision without a heavyweight consensus stack.
 *
 * Verbs:
 *   INIT     — initiator announces a coordination session and the proposal
 *   PROPOSE  — initiator (or any participant) submits a concrete proposal
 *   ACCEPT   — a participant signals acceptance of the current proposal
 *   COMMIT   — once quorum is reached, the session is finalised
 *
 * Usage (two-agent example):
 *   const session = MuACP.init('agent-a', 'agent-b', 'Use hierarchical topology?');
 *   MuACP.propose(session, 'agent-a', 'hierarchical');
 *   MuACP.accept(session, 'agent-b');
 *   const result = MuACP.commit(session);
 *   // result.committed === true, result.value === 'hierarchical'
 *
 * Source: arXiv:2601.03938 — μACP: A Minimal Agent Coordination Protocol for LLM-Based Multi-Agent Systems
 *
 * @module v1/hooks/messaging/muacp
 */

// ============================================================
// Types
// ============================================================

export type MuACPVerb = 'init' | 'propose' | 'accept' | 'commit';

export interface MuACPEvent {
  verb: MuACPVerb;
  agentId: string;
  value?: string;
  timestamp: number;
}

export interface MuACPSession {
  /** Unique session identifier */
  id: string;
  /** Initiator agent ID */
  initiator: string;
  /** All participants (includes initiator) */
  participants: readonly string[];
  /** Human-readable subject of coordination */
  subject: string;
  /** Current proposal (set by first PROPOSE verb) */
  proposal: string | undefined;
  /** Agents that have ACCEPTed the current proposal */
  acceptors: Set<string>;
  /** Whether the session has been committed */
  committed: boolean;
  /** Final committed value */
  committedValue: string | undefined;
  /** Full event log */
  events: MuACPEvent[];
  /** Session creation timestamp */
  createdAt: number;
}

export interface MuACPCommitResult {
  sessionId: string;
  committed: boolean;
  value: string | undefined;
  /** Quorum fraction achieved (acceptors / participants) */
  quorum: number;
  reason?: string;
}

// ============================================================
// Protocol implementation
// ============================================================

let _sessionCounter = 0;

/**
 * μACP — static four-verb coordination protocol.
 *
 * All state lives in the MuACPSession object which callers own.
 * There is no global registry — sessions are ephemeral unless the
 * caller persists them via ThreadedMessageBus or another store.
 */
export class MuACP {
  /**
   * INIT — create a new coordination session.
   *
   * @param initiator    ID of the agent starting the session
   * @param participants All agent IDs that must reach quorum
   * @param subject      Human-readable description of what is being coordinated
   */
  static init(
    initiator: string,
    participants: string[],
    subject: string,
  ): MuACPSession {
    if (!participants.includes(initiator)) {
      participants = [initiator, ...participants];
    }
    const session: MuACPSession = {
      id: `muacp-${++_sessionCounter}-${Date.now()}`,
      initiator,
      participants: Object.freeze([...participants]),
      subject,
      proposal: undefined,
      acceptors: new Set(),
      committed: false,
      committedValue: undefined,
      events: [],
      createdAt: Date.now(),
    };
    session.events.push({ verb: 'init', agentId: initiator, timestamp: Date.now() });
    return session;
  }

  /**
   * PROPOSE — submit a concrete proposal to the session.
   *
   * Only valid before COMMIT.  A new proposal resets the acceptors set.
   *
   * @param session  Active session
   * @param agentId  Agent making the proposal (must be a participant)
   * @param value    The proposed value / decision
   */
  static propose(session: MuACPSession, agentId: string, value: string): void {
    MuACP.assertOpen(session);
    MuACP.assertParticipant(session, agentId);
    session.proposal = value;
    session.acceptors.clear();
    // Proposer implicitly accepts their own proposal
    session.acceptors.add(agentId);
    session.events.push({ verb: 'propose', agentId, value, timestamp: Date.now() });
  }

  /**
   * ACCEPT — signal acceptance of the current proposal.
   *
   * @param session  Active session
   * @param agentId  Agent accepting (must be a participant)
   */
  static accept(session: MuACPSession, agentId: string): void {
    MuACP.assertOpen(session);
    MuACP.assertParticipant(session, agentId);
    if (session.proposal === undefined) {
      throw new Error('μACP: cannot ACCEPT before a PROPOSE has been issued');
    }
    session.acceptors.add(agentId);
    session.events.push({ verb: 'accept', agentId, timestamp: Date.now() });
  }

  /**
   * COMMIT — finalise the session if quorum is reached.
   *
   * Quorum: strict majority (> 50%) by default.
   * Returns a result object indicating whether the commit succeeded.
   *
   * @param session         Active session
   * @param quorumFraction  Required fraction of participants (default: 0.5 strict majority)
   */
  static commit(session: MuACPSession, quorumFraction = 0.5): MuACPCommitResult {
    MuACP.assertOpen(session);

    const achieved = session.acceptors.size / session.participants.length;
    const quorumReached = achieved > quorumFraction;

    if (quorumReached && session.proposal !== undefined) {
      session.committed = true;
      session.committedValue = session.proposal;
      session.events.push({ verb: 'commit', agentId: session.initiator, value: session.proposal, timestamp: Date.now() });
      return {
        sessionId: session.id,
        committed: true,
        value: session.committedValue,
        quorum: achieved,
      };
    }

    return {
      sessionId: session.id,
      committed: false,
      value: undefined,
      quorum: achieved,
      reason: session.proposal === undefined
        ? 'No proposal has been made'
        : `Quorum not reached (${session.acceptors.size}/${session.participants.length} accepted, need >${Math.floor(quorumFraction * 100)}%)`,
    };
  }

  // ----------------------------------------------------------------
  // Convenience: run a single-round coordination synchronously
  // ----------------------------------------------------------------

  /**
   * Convenience method: run a complete single-round μACP session where the
   * initiator proposes a value and requests acceptance from all peers.
   *
   * The returned result is committed if the `acceptFn` returns true for
   * a strict majority of peers.
   *
   * @param initiator    Initiating agent ID
   * @param peers        Other participant agent IDs
   * @param subject      Subject of coordination
   * @param proposal     Value the initiator proposes
   * @param acceptFn     Synchronous decision function for each peer
   */
  static coordinate(
    initiator: string,
    peers: string[],
    subject: string,
    proposal: string,
    acceptFn: (agentId: string, proposal: string) => boolean,
  ): MuACPCommitResult {
    const session = MuACP.init(initiator, peers, subject);
    MuACP.propose(session, initiator, proposal);

    for (const peer of peers) {
      if (peer !== initiator && acceptFn(peer, proposal)) {
        MuACP.accept(session, peer);
      }
    }

    return MuACP.commit(session);
  }

  // ----------------------------------------------------------------
  // Private guards
  // ----------------------------------------------------------------

  private static assertOpen(session: MuACPSession): void {
    if (session.committed) {
      throw new Error(`μACP session ${session.id} is already committed`);
    }
  }

  private static assertParticipant(session: MuACPSession, agentId: string): void {
    if (!session.participants.includes(agentId)) {
      throw new Error(`μACP: agent "${agentId}" is not a participant in session ${session.id}`);
    }
  }
}

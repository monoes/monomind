// packages/@monomind/cli/src/orgrt/state-detector.ts

export type AgentState = 'idle' | 'working' | 'tool-call' | 'blocked' | 'error' | 'completed';

export interface StatePattern {
  pattern: RegExp;
  state: AgentState;
}

const DEFAULT_PATTERNS: StatePattern[] = [
  { pattern: /\berror\b.*\b(failed|crash|exception|traceback)\b/i, state: 'error' },
  { pattern: /\b(waiting|blocked|pending)\b.*\b(approval|gate|human|input)\b/i, state: 'blocked' },
  { pattern: /\b(calling|invoking|running|executing)\b.*\btool\b/i, state: 'tool-call' },
  { pattern: /\b(completed?|finished|done|achieved)\b/i, state: 'completed' },
];

export class StateDetector {
  private state: AgentState = 'idle';
  private lastActivity = Date.now();
  private patterns: StatePattern[];
  private idleThresholdMs: number;

  constructor(customPatterns?: StatePattern[], idleThresholdMs = 30_000) {
    this.patterns = customPatterns ?? DEFAULT_PATTERNS;
    this.idleThresholdMs = idleThresholdMs;
  }

  /** Process an SDK message and infer the agent's state. */
  onMessage(type: string, subtype?: string, text?: string): AgentState {
    this.lastActivity = Date.now();

    if (type === 'result') {
      if (subtype === 'success') {
        this.state = 'idle';
        return this.state;
      }
      if (subtype === 'error_max_turns') {
        this.state = 'idle';
        return this.state;
      }
      this.state = 'error';
      return this.state;
    }

    if (type === 'tool_use') {
      this.state = 'tool-call';
      return this.state;
    }

    if (type === 'assistant' && text) {
      for (const { pattern, state } of this.patterns) {
        if (pattern.test(text)) {
          this.state = state;
          return this.state;
        }
      }
      this.state = 'working';
    }

    return this.state;
  }

  /** Check if agent has gone idle based on time since last activity. */
  checkIdle(): AgentState {
    if (this.state === 'working' || this.state === 'tool-call') {
      if (Date.now() - this.lastActivity > this.idleThresholdMs) {
        this.state = 'idle';
      }
    }
    return this.state;
  }

  current(): AgentState {
    return this.state;
  }
  lastActiveAt(): number {
    return this.lastActivity;
  }
}

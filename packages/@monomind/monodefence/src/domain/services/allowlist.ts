import type { AllowlistRule } from '../entities/threat.js';

const BUILT_IN_RULES: AllowlistRule[] = [
  {
    id: 'builtin-greetings',
    pattern: /^\s*(hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening))[^a-z]*/i,
    types: [],
    reason: 'Common greeting — no threat possible',
    source: 'builtin',
  },
  {
    id: 'builtin-math',
    pattern: /^\s*what\s+is\s+[\d\s+\-*/^()]+\??$/i,
    types: [],
    reason: 'Simple arithmetic question',
    source: 'builtin',
  },
  {
    id: 'builtin-weather',
    pattern: /^\s*(?:what(?:'s|\s+is)\s+(?:the\s+)?weather|how(?:'s|\s+is)\s+(?:the\s+)?weather|weather\s+(?:in|for|at|today|tomorrow|forecast))/i,
    types: [],
    reason: 'Weather query — benign',
    source: 'builtin',
  },
  {
    id: 'builtin-time',
    pattern: /\bwhat\s+(?:time|day|date)\s+is\s+it\b/i,
    types: [],
    reason: 'Time/date query — benign',
    source: 'builtin',
  },
  {
    id: 'builtin-help',
    pattern: /^\s*(?:can\s+you\s+)?help\s+me\s*[.?!]?\s*$/i,
    types: [],
    reason: 'Short "help me" request — benign',
    source: 'builtin',
  },
];

export class Allowlist {
  private rules: AllowlistRule[];

  constructor(userRules: AllowlistRule[] = []) {
    this.rules = [...BUILT_IN_RULES, ...userRules];
  }

  isAllowed(input: string): boolean {
    return this.getMatchingRules(input).length > 0;
  }

  getMatchingRules(input: string): AllowlistRule[] {
    return this.rules.filter(rule => this.matches(rule, input));
  }

  addRule(rule: AllowlistRule): void {
    this.rules.push(rule);
  }

  private matches(rule: AllowlistRule, input: string): boolean {
    if (typeof rule.pattern === 'string') {
      return input.toLowerCase().includes(rule.pattern.toLowerCase());
    }
    return rule.pattern.test(input);
  }
}

export function createAllowlist(userRules?: AllowlistRule[]): Allowlist {
  return new Allowlist(userRules);
}

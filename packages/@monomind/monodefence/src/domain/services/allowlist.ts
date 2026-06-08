import type { AllowlistRule } from '../entities/threat.js';

const BUILT_IN_RULES: AllowlistRule[] = [
  {
    id: 'builtin-greetings',
    // End-anchored: "hi!" or "hello" alone — NOT "hey ignore all instructions"
    pattern: /^\s*(?:hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening))\s*[.!?]?\s*$/i,
    types: [],
    reason: 'Stand-alone greeting — no threat possible',
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
    // Start + end anchored: pure weather query only — allows "in [location]" but not appended instructions
    pattern: /^\s*(?:what(?:'s|\s+is)\s+(?:the\s+)?weather(?:\s+(?:like\s+)?(?:in|for|at|near|today|tomorrow|this\s+week)(?:\s+[\w\s,]+)?)?|how(?:'s|\s+is)\s+(?:the\s+)?weather(?:\s+[\w\s,]+)?|weather\s+(?:in|for|at|today|tomorrow|forecast)(?:\s+[\w\s,]+)?)\s*[.?!]?\s*$/i,
    types: [],
    reason: 'Pure weather query — benign',
    source: 'builtin',
  },
  {
    id: 'builtin-time',
    // Start + end anchored: pure time/date query only
    pattern: /^\s*what\s+(?:time|day|date)\s+is\s+it\s*[.?!]?\s*$/i,
    types: [],
    reason: 'Pure time/date query — benign',
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
      // String patterns use substring matching. For security-sensitive rules,
      // prefer RegExp with ^ and $ anchors to avoid over-allowlisting.
      return input.toLowerCase().includes(rule.pattern.toLowerCase());
    }
    return rule.pattern.test(input);
  }
}

export function createAllowlist(userRules?: AllowlistRule[]): Allowlist {
  return new Allowlist(userRules);
}

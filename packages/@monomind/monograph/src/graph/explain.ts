export interface RuleDef {
  id: string;               // e.g. 'god-node', 'unreachable-file', 'circular-deps'
  name: string;             // human readable
  description: string;      // what it detects
  rationale: string;        // why it matters
  remediation: string;      // how to fix
  severity: 'error' | 'warning' | 'info';
  docsUrl?: string;
}

export const CHECK_RULES: RuleDef[] = [
  {
    id: 'god-node',
    name: 'God Node',
    description: 'A file or class with too many incoming dependencies (high fan-in).',
    rationale: 'God nodes create fragile coupling — any change ripples across many files.',
    remediation: 'Split into smaller, focused modules. Extract shared logic into utility files.',
    severity: 'warning',
  },
  {
    id: 'unreachable-file',
    name: 'Unreachable File',
    description: 'A file that cannot be reached from any runtime or test entry point.',
    rationale: 'Unreachable files are dead code — they increase build size and maintenance burden.',
    remediation: 'Delete or connect the file to a live import chain. Check if it was accidentally disconnected.',
    severity: 'warning',
  },
  {
    id: 'circular-deps',
    name: 'Circular Dependencies',
    description: 'Files that form an import cycle.',
    rationale: 'Circular imports complicate initialization order, testing, and refactoring.',
    remediation: 'Extract shared types/utilities to a new file that neither participant imports from.',
    severity: 'error',
  },
  {
    id: 'high-coupling',
    name: 'High Coupling Concentration',
    description: 'A disproportionate share of imports targeting a small number of files.',
    rationale: 'Over-coupled files become change bottlenecks — every feature touches them.',
    remediation: 'Break up the central file using the facade pattern or dependency inversion.',
    severity: 'warning',
  },
  {
    id: 'isolated-node',
    name: 'Isolated Node',
    description: 'A file with no imports and no importers.',
    rationale: 'Isolated files have no connection to the codebase — likely dead or forgotten.',
    remediation: 'Either connect it to the dependency graph or delete it.',
    severity: 'info',
  },
  {
    id: 'boundary-violation',
    name: 'Boundary Zone Violation',
    description: 'An import that crosses a forbidden architectural boundary.',
    rationale: 'Boundary violations break layer isolation and make the architecture drift over time.',
    remediation: 'Introduce an anti-corruption layer or move the logic to the correct zone.',
    severity: 'error',
  },
  {
    id: 'low-cohesion',
    name: 'Low Community Cohesion',
    description: 'A module community with a low ratio of internal to possible edges.',
    rationale: 'Low cohesion means the community is an arbitrary grouping, not a real module.',
    remediation: 'Re-organize files so that related functionality is co-located.',
    severity: 'info',
  },
];

export function explainRule(ruleId: string): RuleDef | undefined {
  return CHECK_RULES.find(r => r.id === ruleId);
}

export function listRules(): RuleDef[] {
  return CHECK_RULES;
}

export function getRulesByFinding(findingTitle: string): RuleDef[] {
  const lower = findingTitle.toLowerCase();
  return CHECK_RULES.filter(r => lower.includes(r.id) || lower.includes(r.name.toLowerCase()));
}

// ── Round 10: health + duplication rule catalogs ──────────────────────────────

export interface RuleGuide {
  rule: string;
  checklist: string[];
  relatedRules: string[];
  antiPatterns: string[];
  examples: string[];
}

export const HEALTH_RULES: RuleDef[] = [
  { id: 'health/cyclomatic', title: 'High Cyclomatic Complexity', description: 'Function has too many independent execution paths', docs: 'https://en.wikipedia.org/wiki/Cyclomatic_complexity' },
  { id: 'health/cognitive', title: 'High Cognitive Complexity', description: 'Function is hard to understand for human readers', docs: 'https://www.sonarsource.com/docs/CognitiveComplexity.pdf' },
  { id: 'health/crap', title: 'High CRAP Score', description: 'Function has high complexity and low test coverage', docs: '' },
  { id: 'health/maintainability', title: 'Low Maintainability Index', description: 'File has a low maintainability index score', docs: '' },
  { id: 'health/large-function', title: 'Large Function', description: 'Function exceeds the maximum allowed lines of code', docs: '' },
];

export const DUPES_RULES: RuleDef[] = [
  { id: 'duplication/clone', title: 'Code Duplication', description: 'Code block is duplicated across multiple files', docs: '' },
];

export function getRuleGuide(ruleId: string): RuleGuide | null {
  const guides: Record<string, RuleGuide> = {
    'health/cyclomatic': {
      rule: 'health/cyclomatic',
      checklist: ['Extract complex conditionals into named predicates', 'Split large functions into smaller helpers', 'Use early returns to reduce nesting'],
      relatedRules: ['health/cognitive', 'health/crap'],
      antiPatterns: ['Deeply nested if/else chains', 'Long switch statements without extraction'],
      examples: ['Extract `isEligible()` from a 15-branch function'],
    },
    'health/crap': {
      rule: 'health/crap',
      checklist: ['Add tests to increase coverage', 'Refactor to reduce cyclomatic complexity', 'Break into smaller testable units'],
      relatedRules: ['health/cyclomatic', 'health/cognitive'],
      antiPatterns: ['Complex functions with zero test coverage'],
      examples: [],
    },
  };
  return guides[ruleId] ?? null;
}

export function healthMeta(): Record<string, unknown> {
  return { version: 1, rules: HEALTH_RULES.map(r => ({ id: r.id, title: r.title, description: r.description })) };
}

export function dupesMeta(): Record<string, unknown> {
  return { version: 1, rules: DUPES_RULES.map(r => ({ id: r.id, title: r.title, description: r.description })) };
}

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

export interface RuleDef {
    id: string;
    name?: string;
    title?: string;
    description: string;
    rationale?: string;
    remediation?: string;
    severity?: 'error' | 'warning' | 'info';
    docsUrl?: string;
    docs?: string;
}
export declare const CHECK_RULES: RuleDef[];
export declare function explainRule(ruleId: string): RuleDef | undefined;
export declare function listRules(): RuleDef[];
export declare function getRulesByFinding(findingTitle: string): RuleDef[];
export interface RuleGuide {
    rule: string;
    checklist: string[];
    relatedRules: string[];
    antiPatterns: string[];
    examples: string[];
}
export declare const HEALTH_RULES: RuleDef[];
export declare const DUPES_RULES: RuleDef[];
export declare function getRuleGuide(ruleId: string): RuleGuide | null;
export declare function healthMeta(): Record<string, unknown>;
export declare function dupesMeta(): Record<string, unknown>;
//# sourceMappingURL=explain.d.ts.map
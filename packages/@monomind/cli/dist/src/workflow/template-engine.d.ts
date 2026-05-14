/**
 * Substitute {{variable}} and {{step-id.field}} placeholders in a template
 * string using values from a context object.
 *
 * - `{{variable}}` resolves to `context[variable]`
 * - `{{a.b.c}}` resolves to nested path `context.a.b.c`
 *
 * Safe regex-based — no eval.
 */
export declare function substitute(template: string, context: Record<string, unknown>): string;
//# sourceMappingURL=template-engine.d.ts.map
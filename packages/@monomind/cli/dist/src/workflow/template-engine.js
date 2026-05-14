/**
 * Substitute {{variable}} and {{step-id.field}} placeholders in a template
 * string using values from a context object.
 *
 * - `{{variable}}` resolves to `context[variable]`
 * - `{{a.b.c}}` resolves to nested path `context.a.b.c`
 *
 * Safe regex-based — no eval.
 */
export function substitute(template, context) {
    return template.replace(/\{\{([\w./-]+)\}\}/g, (_match, path) => {
        const value = resolvePath(context, path);
        if (value === undefined) {
            return `{{${path}}}`;
        }
        return String(value);
    });
}
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function resolvePath(obj, path) {
    const segments = path.split('.');
    let current = obj;
    for (const segment of segments) {
        if (current === null || current === undefined) {
            return undefined;
        }
        if (typeof current !== 'object') {
            return undefined;
        }
        if (BLOCKED_KEYS.has(segment)) {
            return undefined;
        }
        if (!Object.prototype.hasOwnProperty.call(current, segment)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
//# sourceMappingURL=template-engine.js.map
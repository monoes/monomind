/**
 * Substitute {{variable}} and {{step-id.field}} placeholders in a template
 * string using values from a context object.
 *
 * - `{{variable}}` resolves to `context[variable]`
 * - `{{a.b.c}}` resolves to nested path `context.a.b.c`
 *
 * Safe regex-based — no eval.
 */
export function substitute(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{([\w./-]+)\}\}/g, (_match, path: string) => {
    const value = resolvePath(context, path);
    if (value === undefined) {
      return `{{${path}}}`;
    }
    return String(value);
  });
}

function resolvePath(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

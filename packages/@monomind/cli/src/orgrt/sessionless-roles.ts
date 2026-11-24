/**
 * Roles that run no model session (#835). The endpoint and decision kinds.
 * Kept free of imports so endpoint and decision role files can both use it without a cycle.
 *
 * "No session" and "is an HTTP endpoint" are different questions: use `isSessionlessRole` for
 * sessions, mailboxes, slots and budget shares, and `isEndpointRole` for reply tracking and POST delivery.
 */
export const SESSIONLESS_ROLE_KINDS = ['endpoint', 'decision'] as const;

export function isSessionlessRole(role: unknown): boolean {
  const kind = (role as { kind?: unknown } | undefined)?.kind;
  return (SESSIONLESS_ROLE_KINDS as readonly unknown[]).includes(kind);
}

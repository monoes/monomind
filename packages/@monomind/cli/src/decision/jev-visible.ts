/**
 * The catalog egress filter for the Jev picker, moved out of catalogs.ts
 * (which re-exports it) so the Org Runtime can use it without importing
 * catalogs.ts, which in turn reads the Org Runtime's skill library.
 */
import { verifyEntry } from '../catalog/digest.js';
import { buildSnapshot, eligible } from '../catalog/snapshot.js';

type MaybeCatalog = { origin?: string; catalogId?: string };

/** Catalog skills leave the machine only with the `jev` target; legacy skills
 *  are unchanged. Without a root no catalog skill is sent. */
export function jevVisible<T>(root: string | undefined, items: readonly T[]): T[] {
  // `T` is deliberately unconstrained: rankOrgSkills's own `T extends {name,
  // description, tags}` has neither field, and constraining here fails to compile.
  const cat = (s: T): MaybeCatalog => s as MaybeCatalog;
  if (!items.some((s) => cat(s).origin === 'catalog')) return [...items];
  // Re-verify at the egress boundary: the snapshot cache is keyed on state.json,
  // so a package tampered after a warm cache must not leave the machine.
  const allowed = new Set(
    root
      ? eligible(buildSnapshot(root), 'jev')
          .filter((a) => verifyEntry(root, a).ok)
          .map((a) => a.id)
      : [],
  );
  return items.filter((s) => cat(s).origin !== 'catalog' || allowed.has(cat(s).catalogId ?? ''));
}

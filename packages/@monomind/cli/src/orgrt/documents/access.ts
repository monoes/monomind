// packages/@monomind/cli/src/orgrt/documents/access.ts
/**
 * Org sections spec 13.1.2 item 5 (piece P3.6): the STATIC access rules of the document tools, a reduction of
 * the grants of 6.1 and 6.7. Pure functions of the definition and the bindings built from it; the role is the
 * session's own role id, never a tool argument.
 *
 *  - publish: the roles of the producing section (its lead and members).
 *  - read: the root and the roles of the producing section read every version; the lead (declared decider) of a
 *    consuming section reads every version of a type it consumes; the other members of a consuming section, and
 *    any role when the contract says `visibility: "org"`, read accepted versions only; nobody else reads.
 *  - decide: only the declared deciders (the lead) of a consuming section.
 * Every refusal is text naming the rule, so the tool result can say what is allowed instead.
 */
import { rootRoleId } from './routing.js';
import type { TypeBinding } from './store-types.js';

export type ReadLevel = 'all' | 'accepted';
/** How a role relates to a type; also the `role` the listing shows. */
export type TypeRole = 'root' | 'producer' | 'consumer-lead' | 'consumer' | 'reader';

interface DefLike {
  sections?: unknown;
  roles: { id: string; type?: string; reports_to?: string | null }[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Lead and members of a section, as declared. */
export function sectionRoster(def: Pick<DefLike, 'sections'>, name: string): string[] {
  const s = isObject(def.sections) ? def.sections[name] : undefined;
  if (!isObject(s)) return [];
  const out: string[] = [];
  if (typeof s.lead === 'string') out.push(s.lead);
  if (Array.isArray(s.members)) for (const m of s.members) if (typeof m === 'string') out.push(m);
  return [...new Set(out)];
}

export class DocAccess {
  readonly root: string | undefined;
  private readonly byType = new Map<string, TypeBinding>();
  private readonly rosters = new Map<string, string[]>();

  constructor(def: DefLike, bindings: readonly TypeBinding[]) {
    this.root = rootRoleId(def);
    for (const b of bindings) {
      this.byType.set(b.contract.type, b);
      for (const c of b.consumers) this.rosters.set(c.id, sectionRoster(def, c.id));
    }
  }

  knows(type: string): boolean {
    return this.byType.has(type);
  }

  /** Types `role` may publish. */
  publishable(role: string): string[] {
    return [...this.byType].filter(([, b]) => b.producers.includes(role)).map(([t]) => t);
  }

  consumerIds(type: string): string[] {
    return this.byType.get(type)?.consumers.map((c) => c.id) ?? [];
  }

  /** How `role` relates to `type`, or undefined when it does not (and may not read it). */
  roleFor(role: string, type: string): TypeRole | undefined {
    const b = this.byType.get(type);
    if (!b) return undefined;
    if (role === this.root) return 'root';
    if (b.producers.includes(role)) return 'producer';
    if (b.consumers.some((c) => c.deciders.includes(role))) return 'consumer-lead';
    if (b.consumers.some((c) => this.rosters.get(c.id)?.includes(role))) return 'consumer';
    if (b.contract.visibility === 'org') return 'reader';
    return undefined;
  }

  readLevel(role: string, type: string): ReadLevel | undefined {
    const r = this.roleFor(role, type);
    if (!r) return undefined;
    return r === 'consumer' || r === 'reader' ? 'accepted' : 'all';
  }

  /** The types `role` may see in a listing, in declaration order. */
  typesFor(role: string): { type: string; role: TypeRole }[] {
    const out: { type: string; role: TypeRole }[] = [];
    for (const type of this.byType.keys()) {
      const r = this.roleFor(role, type);
      if (r) out.push({ type, role: r });
    }
    return out;
  }

  publishRefusal(role: string, type: string): string | undefined {
    const b = this.byType.get(type);
    if (!b || b.producers.includes(role)) return undefined;
    return `${role} may not publish "${type}": only roles of section ${b.section} (${b.producers.join(', ')}) publish it`;
  }

  readRefusal(role: string, type: string): string | undefined {
    const b = this.byType.get(type);
    if (!b || this.roleFor(role, type)) return undefined;
    const consumers = b.consumers.map((c) => c.id);
    return `${role} may not read "${type}": it is readable by the root, the roles of section ${b.section} (its producers), and the lead of ${consumers.length === 1 ? 'the consuming section' : 'each consuming section'} ${consumers.join(', ')} (other members of a consuming section read accepted versions only)`;
  }

  /** A role limited to accepted versions asked for one that is not. */
  acceptedOnlyRefusal(role: string, type: string, version: number, status: string): string {
    return `${role} may read only accepted versions of "${type}", and version ${version} is ${status}: the producing section, the consuming lead and the root read versions that are not accepted yet`;
  }

  decideRefusal(role: string, type: string): string | undefined {
    const b = this.byType.get(type);
    if (!b || b.consumers.some((c) => c.deciders.includes(role))) return undefined;
    const who = b.consumers.flatMap((c) => c.deciders.map((d) => `${d} (lead of ${c.id})`));
    return `${role} may not decide "${type}": only ${who.join(', ')} decide${who.length === 1 ? 's' : ''}`;
  }
}

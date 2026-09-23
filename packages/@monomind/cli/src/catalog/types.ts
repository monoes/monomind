import { z } from 'zod';

export const CATALOG_SCHEMA_VERSION = 1 as const;
/** Same shape as skill-library's SKILL_NAME_RE, so a catalog skill is a valid library name. */
export const CATALOG_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const CatalogKindSchema = z.enum(['skill', 'archetype', 'blueprint']);
export const CatalogIdSchema = z
  .string()
  .regex(/^(skill|archetype|blueprint):[a-z0-9][a-z0-9-]{0,63}$/);
export const CatalogStatusSchema = z.enum([
  'staged',
  'quarantined',
  'approved',
  'active',
  'disabled',
  'revoked',
]);
export const CatalogTargetSchema = z.enum(['org', 'jev', 'platform:claude', 'platform:agents']);
/** MCP tools a catalog skill may be granted: graph READS only. Excluded on purpose:
 *  monograph_suggest (its health-aware mode triggers a background rebuild) and
 *  monodesign_detect (reads any path `resolve(cwd, target)` reaches, no containment). */
export const CATALOG_GRANTABLE_TOOLS = [
  'monograph_query',
  'monograph_context',
  'monograph_impact',
  'monograph_neighbors',
] as const;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Iso = z.string().datetime();

export const CatalogSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('git'),
      // No userinfo on https: a `user:token@` URL would persist the credential.
      url: z.string().regex(/^(?:https:\/\/[^\s/@]+(?:\/\S*)?|git@[\w.-]+:[^\s]+)$/),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
      path: z.string(),
      license: z.enum(['MIT', 'Apache-2.0']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('local'),
      path: z.string().startsWith('/'),
      commit: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .optional(),
      path_in_source: z.string(),
      license: z.enum(['MIT', 'Apache-2.0']),
    })
    .strict(),
]);

export const InspectionSchema = z
  .object({
    verdict: z.enum(['clean', 'quarantine']),
    accepted: z.array(z.string()),
    rejected: z.array(z.object({ path: z.string(), reason: z.string() }).strict()),
    requestedTools: z.array(z.string()),
    scanner: z
      .object({ ok: z.boolean(), blocked: z.boolean(), summary: z.string().max(500) })
      .strict(),
    at: Iso,
    /** Set only by `release`: a human accepted THIS revision despite the verdict. Cleared on restage. */
    override: z
      .object({ actor: z.string().min(1).max(64), reason: z.string().min(1).max(500), at: Iso })
      .strict()
      .optional(),
  })
  .strict();

export const HistorySchema = z
  .object({
    from: CatalogStatusSchema.nullable(),
    to: CatalogStatusSchema,
    actor: z.string().min(1).max(64),
    at: Iso,
    reason: z.string().max(500).optional(),
  })
  .strict();

export const CatalogEntrySchema = z
  .object({
    id: CatalogIdSchema,
    kind: CatalogKindSchema,
    status: CatalogStatusSchema,
    sha256: Sha256,
    source: CatalogSourceSchema,
    inspection: InspectionSchema,
    targets: z.array(CatalogTargetSchema).default([]),
    grantedTools: z.array(z.enum(CATALOG_GRANTABLE_TOOLS)).default([]),
    replacesLegacy: z.boolean().default(false),
    createdAt: Iso,
    updatedAt: Iso,
    history: z.array(HistorySchema).max(20),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.id.split(':')[0] !== e.kind)
      ctx.addIssue({ code: 'custom', message: 'id prefix must equal kind' });
    if (new Set(e.targets).size !== e.targets.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate target' });
    if (e.targets.includes('jev') && !e.targets.includes('org'))
      ctx.addIssue({ code: 'custom', message: 'jev requires org' });
    if ((e.status === 'approved' || e.status === 'active') && e.targets.length === 0)
      ctx.addIssue({ code: 'custom', message: `${e.status} entry needs a target` });
    if (e.kind !== 'skill' && e.grantedTools.length > 0)
      ctx.addIssue({ code: 'custom', message: 'only skills take tool grants' });
  });

export const CatalogStateSchema = z
  .object({
    schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
    entries: z.array(CatalogEntrySchema),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.entries.map((e) => e.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'duplicate id' });
  });

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogState = z.infer<typeof CatalogStateSchema>;
export type CatalogStatus = z.infer<typeof CatalogStatusSchema>;
export type CatalogTarget = z.infer<typeof CatalogTargetSchema>;

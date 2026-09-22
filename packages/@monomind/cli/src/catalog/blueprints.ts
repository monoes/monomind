import { z } from 'zod';
import { CATALOG_NAME_RE } from './types.js';

export const BlueprintSchema = z
  .object({
    name: z.string().regex(CATALOG_NAME_RE),
    description: z.string().min(1).max(500),
    archetype: z.string().regex(CATALOG_NAME_RE).optional(),
    skills: z.array(z.string().regex(CATALOG_NAME_RE)).max(20).default([]),
    skill_pool: z
      .array(z.string().regex(/^(tag:)?[a-z0-9][a-z0-9-]{0,63}$/))
      .max(50)
      .default([]),
    runtimeHints: z
      .object({ reasoning: z.enum(['low', 'medium', 'high']).optional() })
      .strict()
      .optional(),
    recommendedPolicy: z
      .object({ git: z.enum(['none', 'read', 'commit', 'push']).optional() })
      .strict()
      .optional(),
  })
  .strict();

export type Blueprint = z.infer<typeof BlueprintSchema>;

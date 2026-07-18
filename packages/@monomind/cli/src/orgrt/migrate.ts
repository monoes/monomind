// packages/@monomind/cli/src/orgrt/migrate.ts
/** v1 → v2 org config conversion. Pure transform + validation, plus the file
 * IO orchestration for the `org migrate` subcommand — kept out of org.ts to
 * stay under the 500-line file cap; org.ts's migrateAction is a thin wrapper
 * that only does the name-validation / isOrgRunning guard and delegates here. */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { OrgDefSchema } from './types.js';

const V1_TOP_LEVEL_KEYS = [
  'topology', 'consensus', 'strategy', 'maxAgents', 'communication',
  'board_id', 'todo_col_id', 'doing_col_id', 'done_col_id', 'loop',
  'version', 'channels', 'differentiation', 'outputDir', 'runBehavior', 'created',
] as const;
const V1_ROLE_KEYS = ['agent_type', 'delegates_to', 'board_id'] as const;

export function migrateOrgConfig(raw: Record<string, unknown>): {
  def: Record<string, unknown>; dropped: string[]; notes: string[];
} {
  const def: Record<string, unknown> = { ...raw };
  const dropped: string[] = [];
  const notes: string[] = [];

  // v1 loop → v2 schedule ("<N>m"); only when no v2 schedule already set
  const loop = def['loop'] as { poll_interval_minutes?: number } | null | undefined;
  if (loop && typeof loop.poll_interval_minutes === 'number' && def['schedule'] == null) {
    def['schedule'] = `${loop.poll_interval_minutes}m`;
    notes.push(`loop.poll_interval_minutes=${loop.poll_interval_minutes} → schedule "${def['schedule']}"`);
  }

  for (const k of V1_TOP_LEVEL_KEYS) {
    if (k in def) { delete def[k]; dropped.push(k); }
  }

  if (Array.isArray(def['roles'])) {
    def['roles'] = (def['roles'] as Record<string, unknown>[]).map(role => {
      const r = { ...role };
      if (typeof r['agent_type'] === 'string') {
        if (r['type'] == null || r['type'] === 'specialist') { r['type'] = r['agent_type']; notes.push(`role ${String(r['id'])}: agent_type → type`); }
      }
      for (const k of V1_ROLE_KEYS) delete r[k];
      return r;
    });
  }

  if (def['schedule'] === undefined) def['schedule'] = null;
  if (typeof def['status'] !== 'string') def['status'] = 'stopped';

  // Throws ZodError on an unmigratable config — caller surfaces it.
  OrgDefSchema.parse(def);
  return { def, dropped, notes };
}

/** Reads `cfgPath`, migrates it, and (unless already v2) backs up the
 * original to `backupPath` and overwrites `cfgPath` with the migrated def.
 * Throws on an unmigratable config — caller decides how to report it. */
export function migrateOrgFile(cfgPath: string, backupPath: string): {
  status: 'migrated' | 'already-v2'; dropped: string[]; notes: string[];
} {
  const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  const result = migrateOrgConfig(raw);
  if (result.dropped.length === 0 && result.notes.length === 0) {
    return { status: 'already-v2', dropped: [], notes: [] };
  }
  if (!existsSync(backupPath)) writeFileSync(backupPath, JSON.stringify(raw, null, 2));
  const tmpPath = `${cfgPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(result.def, null, 2));
  renameSync(tmpPath, cfgPath);
  return { status: 'migrated', dropped: result.dropped, notes: result.notes };
}

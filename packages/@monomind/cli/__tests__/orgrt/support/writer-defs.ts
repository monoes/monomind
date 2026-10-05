// packages/@monomind/cli/__tests__/orgrt/support/writer-defs.ts
// P4.2: the definition of the overlay golden and the snapshot taken of it.
import {
  overlayFor,
  type WriterDef,
  type WriterOptions,
  writerPreflight,
} from '../../../src/orgrt/documents/writer-policy.js';

export function goldenDef(workspace: string): WriterDef {
  return {
    name: 'gold',
    run_config: { workspace },
    sections: {
      build: { members: ['dev'], writes: ['src/**', 'docs/**'] },
      review: { lead: 'qa-lead', members: ['qa-lead', 'qa', 'stray'] },
    },
    roles: [
      { id: 'boss', type: 'boss', reports_to: null },
      { id: 'dev', reports_to: 'boss', policy: { fileWrite: ['src/app/**', 'lib/**'], denyTools: ['Bash'] } },
      {
        id: 'qa-lead',
        reports_to: 'boss',
        policy: {
          git: 'commit',
          fileWrite: ['reports/**'],
          sandbox: { mode: 'off', denyWrite: ['build'], allowWrite: ['.', '/tmp/scratch', 'src/gen'] },
        },
      },
      { id: 'qa', reports_to: 'qa-lead' },
      { id: 'stray', reports_to: 'boss', policy: { sandbox: { denyWrite: ['.'] } } },
    ],
  };
}

export const snapshot = (def: WriterDef, opts: WriterOptions) => {
  const pre = writerPreflight(def, opts);
  return {
    overlays: Object.fromEntries(def.roles.map((r) => [r.id, overlayFor(def, r.id, opts) ?? null])),
    preflight: {
      codes: pre.findings.map((f) => `${f.severity} ${f.code} ${f.path}`),
      errors: pre.errors,
      warnings: pre.warnings,
      writers: pre.writers,
    },
  };
};


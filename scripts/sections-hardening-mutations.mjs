// scripts/sections-hardening-mutations.mjs
//
// GA row R7 (org sections spec 9.3): the guards of the release build (rows R1 to R6),
// each paired with one way of weakening it. scripts/sections-hardening-mutation.mjs
// applies them one at a time and requires the probe suite
// (packages/@monomind/cli/__tests__/orgrt/documents/hardening-probes.test.ts) to
// FAIL for every one. tests/repo/sections-hardening-mutations.test.ts keeps this
// table honest on every test run: each `find` must still occur exactly once in its
// file, so a refactor cannot silently turn a mutation into a no-op.

/** Paths are relative to packages/@monomind/cli/src/orgrt/. */
export const ORGRT = 'packages/@monomind/cli/src/orgrt';

export const MUTATIONS = [
  {
    row: 'R1',
    name: 'the daemon lock is never taken',
    file: 'org-start-steps.ts',
    find: 'daemon.daemonLocks.set(name, await acquireDaemonLock(daemon.root, name));',
    replace: 'daemon.daemonLocks.set(name, { release() {} });',
  },
  {
    row: 'R2',
    name: 'an envelope verifies whatever its MAC',
    file: 'documents/envelope.ts',
    find: 'return want.length === got.length && timingSafeEqual(want, got);',
    replace: 'return true;',
  },
  {
    row: 'R2',
    name: 'a task tag is sealed for a task neither party holds',
    file: 'cross-org-mail.ts',
    find: 'if (!claimed || (holder !== from && holder !== to)) return clean;',
    replace: 'if (!claimed) return clean;',
  },
  {
    row: 'R2',
    name: 'the route parser honours a subject tag without verifying it',
    file: 'session-ledger.ts',
    find: '? tagged && (!verify || verify(head[1], head[2], tagged))',
    replace: '? tagged',
  },
  {
    row: 'R3',
    name: "other roles' mail digests are not denied",
    file: 'documents/role-protection.ts',
    find: 'const denyRead = [...otherMailDirs(def, orgDir, args.roleId), ...hiddenDirs];',
    replace: 'const denyRead = [...hiddenDirs];',
  },
  {
    row: 'R4',
    name: 'the mail root is not write-denied',
    file: 'documents/role-protection.ts',
    find: 'const denyWrite = [mailRootFor(orgDir), ...hiddenDirs];',
    replace: 'const denyWrite = [...hiddenDirs];',
  },
  {
    row: 'R4',
    name: 'a digest is written without exclusive create',
    file: 'documents/mail-integrity.ts',
    find: "{ flag: 'wx', mode: 0o444 }",
    replace: "{ flag: 'w', mode: 0o644 }",
  },
  {
    row: 'R4',
    name: "a digest's hash is not checked on retry",
    file: 'documents/mail-integrity.ts',
    find: 'if (sha256(readFileSync(file)) !== want)',
    replace: 'if (false as boolean)',
  },
  {
    row: 'R4',
    name: 'the same id may carry different content',
    file: 'documents/mail-integrity.ts',
    find: 'if (known.sha256 !== hash)',
    replace: 'if (false as boolean)',
  },
  {
    row: 'R5',
    name: "no private native copy directories are bound over Claude's",
    file: 'documents/copy-inventory.ts',
    find: "if (runtime === 'claude')",
    replace: 'if (false as boolean)',
  },
  {
    row: 'R5',
    name: "another runtime's private directory is not bound",
    file: 'documents/copy-inventory.ts',
    find: 'if (!usesPrivateDir(runtimeIsolation(runtime, env))) return [];',
    replace: 'return [];',
  },
  {
    row: 'R5',
    name: "the other roles' runner directories are not hidden from a role with a private directory",
    file: 'documents/role-protection.ts',
    find: '...otherRunnerDirs(def, orgDir, args.roleId),',
    replace: '...(otherRunnerDirs(def, orgDir, args.roleId), []),',
  },
  {
    row: 'R5',
    name: "a role's runner is not started in its private directory",
    file: 'session-stream.ts',
    find: '...runtimeEnv,',
    replace: '...(runtimeEnv ? {} : {}),',
  },
  {
    row: 'R6',
    name: 'an unprotected host is never refused',
    file: 'documents/preflight.ts',
    find: 'const refusals = evalMode ? [] : [...gaps, ...inventory.errors];',
    replace: 'const refusals: string[] = [];',
  },
];

// packages/@monomind/cli/src/orgrt/daemon-lock.ts
// The daemon lock lives in shared/daemon-lock.ts (the mesh hub uses it too);
// re-exported here for the Org Runtime and existing importers.
export {
  acquireDaemonLock,
  assertSupportedFilesystem,
  DaemonLockError,
  type DaemonLockHandle,
  mountFsTypeOf,
} from '../shared/daemon-lock.js';

// packages/@monomind/cli/src/orgrt/org-state-file.ts
// Extracted from daemon.ts — the daemon's on-disk state: runtime.json
// (persistState, persistCrashStateAll) and the serve heartbeat.
import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonFileAtomic } from '../shared/json-file.js';
import { captureCheckpoint, generateChecksum, type OrgCheckpoint } from './checkpoint.js';
import type { OrgDaemon } from './daemon.js';
import type { RunningOrg } from './daemon-types.js';
import { ownStartId } from './run-liveness.js';
import { ORG_DIR } from './types.js';

function pidStartField(): { pidStart?: string } {
  const pidStart = ownStartId();
  return pidStart ? { pidStart } : {};
}

export function persistState(
  daemon: OrgDaemon,
  name: string,
  status: string,
  run: string,
  org?: RunningOrg,
  checkpointOverride?: OrgCheckpoint | null,
  closedBy?: string,
): void {
  const p = join(daemon.root, ORG_DIR, name, 'runtime.json');
  const missing = [...(daemon.abandoned.get(name) ?? [])];
  const memoryError = daemon.memoryErrors.get(name);
  const running = org ?? daemon.orgs.get(name);
  const validStatus = status === 'stopped' || status === 'crashed' ? status : 'running';
  // Pattern 3: Capture full checkpoint state for resume. On stop, finishStop
  // passes a snapshot captured BEFORE mailboxes close and sessions drain —
  // otherwise the queue is always empty by persist time.
  let checkpoint: OrgCheckpoint | null = checkpointOverride ?? null;
  if (!checkpoint && running) {
    // Best-effort, like the snapshot in finishStop: persisting the run's
    // state matters more than the resume checkpoint inside it, and a stop
    // must not fail because a checkpoint could not be built.
    try {
      checkpoint = captureCheckpoint(running, validStatus as 'running' | 'stopped' | 'crashed');
    } catch (err) {
      console.error(
        `org ${name}: could not capture the ${validStatus} checkpoint:`,
        err instanceof Error ? err.message : err,
      );
      checkpoint = null;
    }
  } else if (checkpoint && checkpoint.status !== validStatus) {
    const { checksum: _, ...state } = checkpoint;
    checkpoint = {
      ...state,
      status: validStatus as 'running' | 'stopped' | 'crashed',
      checksum: generateChecksum({
        ...state,
        status: validStatus as 'running' | 'stopped' | 'crashed',
      }),
    };
  }
  // C4: writeJsonFileAtomic (tmp + rename) — a direct writeFileSync here
  // could leave runtime.json truncated on Ctrl-C during `org stop`, which
  // would brick every subsequent `org status` / isOrgRunning / scheduler
  // call. The state files in 6 other daemon paths already use this helper.
  writeJsonFileAtomic(p, {
    status,
    run,
    pid: process.pid,
    // #573: the pid's start identity, so a reader can tell this process from
    // an unrelated one that later got the same pid.
    ...pidStartField(),
    updated: new Date().toISOString(),
    ...(missing.length ? { abandonedRoles: missing } : {}),
    ...(memoryError ? { memoryError } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(closedBy ? { closedBy } : {}),
  });
}

export function persistCrashStateAll(daemon: OrgDaemon, error?: string): void {
  for (const [name, org] of daemon.orgs) {
    try {
      const p = join(daemon.root, ORG_DIR, name, 'runtime.json');
      // Capture separately from the write below: a throw here (e.g. a
      // cyclic structure in roleState reaching generateChecksum) must not
      // suppress the base crash record, which is the actually-important
      // best-effort write this method exists for.
      let checkpoint: ReturnType<typeof captureCheckpoint> | undefined;
      try {
        checkpoint = captureCheckpoint(org, 'crashed');
      } catch {
        /* best effort — proceed without a checkpoint */
      }
      // C4: atomic write — crash handler is the most likely place to hit
      // a partial write since the process is mid-teardown.
      writeJsonFileAtomic(p, {
        status: 'crashed',
        run: org.run,
        pid: process.pid,
        ...pidStartField(),
        updated: new Date().toISOString(),
        closedBy: 'crash-handler',
        ...(checkpoint ? { checkpoint } : {}),
        ...(error ? { error } : {}),
      });
    } catch {
      /* best effort — filesystem may be unavailable */
    }
  }
}

function heartbeatPath(daemon: OrgDaemon): string {
  return join(daemon.root, '.monomind', 'serve-heartbeat.json');
}

export function writeHeartbeat(daemon: OrgDaemon): void {
  try {
    const p = heartbeatPath(daemon);
    mkdirSync(join(daemon.root, '.monomind'), { recursive: true });
    // C4: atomic write — heartbeat corruption is how `org status` reports
    // a phantom daemon after a crash.
    writeJsonFileAtomic(p, {
      pid: process.pid,
      updatedAt: new Date().toISOString(),
      running: daemon.listRunning(),
    });
  } catch {
    /* best effort */
  }
}

export function clearHeartbeat(daemon: OrgDaemon): void {
  try {
    unlinkSync(heartbeatPath(daemon));
  } catch {
    /* already gone or never written */
  }
}

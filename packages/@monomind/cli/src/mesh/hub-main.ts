import { hostname } from 'node:os';
import { DaemonLockError } from '../orgrt/daemon-lock.js';
import { MeshHub, meshDir } from './hub.js';

let hub: MeshHub | undefined;
try {
  hub = await MeshHub.start({
    dir: meshDir(),
    host: hostname().replace(/[^A-Za-z0-9._-]/g, '-'),
    onIdle: () => void hub?.stop().then(() => process.exit(0)),
  });
} catch (e) {
  // Another hub won the race to start: nothing to do.
  if (e instanceof DaemonLockError && e.code === 'HELD') process.exit(0);
  throw e;
}

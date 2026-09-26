// Child process for build-lock.test.ts: takes the build lock for argv[2]'s
// database, reports whether it got it, then idles until it is killed or a
// line on stdin makes it call process.exit().
import { acquireBuildLock } from '../../src/pipeline/build-lock.js';

const lock = acquireBuildLock(process.argv[2] ?? '');
process.stdout.write(lock.acquired ? 'held\n' : 'busy\n');
process.stdin.on('data', () => process.exit(0));

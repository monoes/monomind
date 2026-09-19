#!/usr/bin/env node
/**
 * o-18 test fixture: a hermetic stand-in for a vendor CLI binary.
 *
 * Ignores every argv it is given (each runner constructs its own real
 * vendor's CLI flags — this stub does not need to understand any of them)
 * and writes the process's actual environment, as JSON, to the file named
 * by the O18_DUMP_ENV_OUT env var — a var the test sets on ITS OWN process
 * before spawning, so it always survives whatever the runner under test
 * does to the child env (it is never one of the ANTHROPIC_* keys under
 * test, so no stripping logic here could ever remove it).
 *
 * Exits 0 immediately after writing. No stdout/stderr protocol is emulated
 * — tests read the dumped file, not the runner's parsed message stream.
 */
import { writeFileSync } from 'node:fs';

const out = process.env.O18_DUMP_ENV_OUT;
if (!out) {
  console.error('O18_DUMP_ENV_OUT not set — this stub only works under the o-18 test harness');
  process.exit(1);
}
writeFileSync(out, JSON.stringify(process.env), 'utf8');
process.exit(0);

#!/usr/bin/env node
/**
 * Cross-platform filesystem primitives for npm build scripts.
 *
 * Every package's build used POSIX shell directly — recursive delete, mkdir -p,
 * cp -r. npm runs scripts through cmd.exe on Windows, which does not understand
 * any of them and answers "The syntax of the command is incorrect". Seven of
 * eight packages had this shape, so monomind could not be BUILT on Windows at
 * all. That does not affect users installing from npm (they get prebuilt dist
 * output), but it locks out Windows contributors entirely.
 *
 * Node's own fs covers all of it, so this adds no dependency — rimraf, shx and
 * friends would each be a new supply-chain edge for something the stdlib
 * already does. Node >= 20 is the floor, where rmSync and cpSync are both
 * available.
 *
 * Subcommands are deliberately explicit rather than mirroring `cp`'s
 * file-vs-directory inference, so a caller can never get directory semantics by
 * accident:
 *
 *   clean <path...>              recursive delete, no error if absent
 *   copy-into <destDir> <src...> copy each src INTO destDir, keeping basenames
 *   copy-dir <src> <dest>        recursive directory copy
 */
import { rmSync, mkdirSync, cpSync, existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const [cmd, ...args] = process.argv.slice(2);

const fail = (msg) => {
  console.error(`build-fs: ${msg}`);
  process.exit(1);
};

switch (cmd) {
  case 'clean': {
    if (args.length === 0) fail('clean needs at least one path');
    for (const target of args) {
      rmSync(target, { recursive: true, force: true });
    }
    break;
  }

  case 'copy-into': {
    const [destDir, ...sources] = args;
    if (!destDir || sources.length === 0) {
      fail('copy-into needs a destination directory and at least one source');
    }
    mkdirSync(destDir, { recursive: true });
    for (const src of sources) {
      // Fail loudly on a missing source. The shell `cp` this replaces would
      // also error, and a build that silently omits a file produces a dist
      // that looks fine until something 404s at runtime.
      if (!existsSync(src)) fail(`source does not exist: ${src}`);
      cpSync(src, join(destDir, basename(src)), {
        recursive: statSync(src).isDirectory(),
      });
    }
    break;
  }

  case 'copy-dir': {
    const [src, dest] = args;
    if (!src || !dest) fail('copy-dir needs a source and a destination');
    if (!existsSync(src)) fail(`source does not exist: ${src}`);
    cpSync(src, dest, { recursive: true });
    break;
  }

  default:
    fail(
      `unknown subcommand ${cmd ? `"${cmd}"` : '(none given)'} — ` +
      'expected clean, copy-into, or copy-dir',
    );
}

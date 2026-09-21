import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #312: `npx -y @monoes/monomindcli@<v> mcp start` failed with
 * "could not determine executable to run". npx picks a bin only when the
 * package declares exactly one, or when one is named after the package's
 * short name. This package declares several, and none was `monomindcli`,
 * so the MCP server silently never started — Claude Code showed
 * CONNECTION_CLOSED, graph tools never loaded, and agents fell back to grep.
 */
describe('#312 — every publishable CLI package is npx-resolvable by its own name', () => {
  const pkgs = [
    join(__dirname, '..', '..', 'package.json'), // @monoes/monomindcli
    join(__dirname, '..', '..', '..', '..', '..', 'package.json'), // monomind umbrella
  ];

  for (const path of pkgs) {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
      name: string;
      bin?: Record<string, string> | string;
    };

    it(`${pkg.name} declares a bin npx can pick`, () => {
      const bin = pkg.bin;
      expect(bin, `${pkg.name} declares no bin`).toBeDefined();
      if (typeof bin === 'string') return; // single-string bin form is always resolvable

      const names = Object.keys(bin ?? {});
      const short = pkg.name.split('/').pop() as string;

      // Either exactly one bin (npx has no choice to make), or one named
      // after the package. Anything else is the #312 failure.
      const resolvable = names.length === 1 || names.includes(short);
      expect(
        resolvable,
        `${pkg.name} declares ${names.length} bins (${names.join(', ')}) and none is "${short}", ` +
          `so \`npx ${pkg.name}\` cannot choose one — see #312`,
      ).toBe(true);
    });
  }
});

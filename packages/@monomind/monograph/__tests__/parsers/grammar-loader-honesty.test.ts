import { parseFile } from '../../src/parsers/loader.js';

// MEM-2: C, C#, PHP, Dart, and Vue grammars historically either failed to load
// silently (0 nodes, no error) or loaded an ABI-incompatible Language object
// that crashed later during parsing. This test asserts that for each language
// we either (a) get non-zero nodes from a working grammar/fallback, or
// (b) get an explicit parseError explaining the failure — never a silent
// empty result.
describe('grammar loader honesty (MEM-2)', () => {
  const samples: Record<string, string> = {
    '.c': 'int add(int a, int b) { return a + b; }\n',
    '.cs': 'class Calculator { int Add(int a, int b) { return a + b; } }\n',
    '.php': '<?php\nfunction add($a, $b) { return $a + $b; }\n',
    '.dart': 'int add(int a, int b) { return a + b; }\n',
    '.vue':
      '<template><div/></template>\n<script lang="ts">\nexport function add(a: number, b: number) { return a + b; }\n</script>\n',
  };

  for (const [ext, source] of Object.entries(samples)) {
    it(`${ext}: produces nodes from a working grammar, or reports why it fell back/failed`, async () => {
      const result = await parseFile(`/tmp/sample${ext}`, source, `sample${ext}`);
      if (result.nodes.length === 0) {
        // Not silently empty — must explain itself.
        expect(result.parseErrors.length).toBeGreaterThan(0);
      } else if (result.parseErrors.length > 0) {
        // Non-zero nodes with parseErrors is only acceptable when the errors
        // are informational (e.g. "fell back to regex extraction" for Dart,
        // or recovered-with-errors) rather than a hidden fatal failure.
        for (const err of result.parseErrors) {
          expect(err).toMatch(/fell back to regex extraction|recovered/);
        }
      }
    });
  }
});

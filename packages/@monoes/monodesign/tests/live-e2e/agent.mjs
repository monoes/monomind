/**
 * Fake live-mode agent for end-to-end tests.
 *
 * Plays the role the LLM plays in production: given the output of
 * live-wrap.mjs (insertLine + cssAuthoring) it writes a faithful three-variant
 * block into the wrapped source file. The scoped CSS here is intentionally a
 * canonical template for `styleMode: "scoped"` authoring: every rule steps
 * INTO the replacement element (`:scope > ...`) instead of styling the
 * variant wrapper itself. reference/live.md points at this file as the
 * example of correct `:scope` usage.
 */

import fs from 'node:fs';

/**
 * Build the style + variant markup block for a replace-mode session.
 * `original` is the picked element's outerHTML (one root element).
 */
export function buildVariantBlock({ sessionId, original, indent = '    ' }) {
  const reindent = (html, pad) => html
    .split('\n')
    .map((line) => pad + line.trim())
    .join('\n');

  const css = [
    `@scope ([data-monodesign-variant="1"]) {`,
    `  :scope > section { padding: 48px; background: #fff7f4; }`,
    `  :scope > section h1 { font-size: 40px; color: #1f1a17; }`,
    `}`,
    `@scope ([data-monodesign-variant="2"]) {`,
    `  :scope > section { padding: 48px; background: #d94f30; }`,
    `  :scope > section h1 { font-size: 34px; color: #ffffff; }`,
    `}`,
    `@scope ([data-monodesign-variant="3"]) {`,
    `  :scope > section { padding: 32px; text-align: center; }`,
    `  :scope > section h1 { font-size: 28px; letter-spacing: 1px; }`,
    `}`,
  ].map((line) => indent + '  ' + line).join('\n');

  const variant = (n, hidden) =>
    `${indent}<div data-monodesign-variant="${n}"${hidden ? ' style="display: none"' : ''}>\n`
    + reindent(original, indent + '  ')
    + `\n${indent}</div>`;

  return [
    `${indent}<style data-monodesign-css="${sessionId}">`,
    css,
    `${indent}</style>`,
    variant(1, false),
    variant(2, true),
    variant(3, true),
  ].join('\n') + '\n';
}

/**
 * Write the variant block into `file` directly below the wrap helper's
 * "Variants: insert below this line" marker (wrap reports it as insertLine,
 * 1-based). Mirrors the single-edit contract from reference/live.md.
 */
export function writeVariantsAtInsertLine(file, insertLine, block) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  lines.splice(insertLine, 0, block.replace(/\n$/, ''));
  fs.writeFileSync(file, lines.join('\n'));
}

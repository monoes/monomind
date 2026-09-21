/**
 * OKF bundles — export the indexed documents to a portable Markdown bundle
 * (frontmatter + `index.md`), and ingest one back.
 *
 * A bundle is plain files, so a round trip goes back through the ordinary
 * ingest path rather than restoring index records directly: whatever comes
 * back is re-extracted, re-chunked and re-versioned like any other document.
 *
 * Split out of document-pipeline.ts.
 *
 * @module v1/cli/knowledge/okf-bundle
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractText } from '../capabilities/cap-documents.js';
// Static import is safe and deliberate: memory-bridge imports only node builtins
// at module scope (everything heavy is lazy), and the project-root rule must not
// be duplicated — two copies of "which directory is this project" is exactly the
// bug this default exists to fix.
import { getProjectRoot } from '../memory/memory-bridge.js';
import { listDocuments } from './document-index.js';
import { ingestDocument, toFileEntry } from './document-ingest.js';
import type { BatchIngestResult } from './document-types.js';

export async function exportToOKF(
  outputDir: string,
  rootDir = getProjectRoot(),
  scope = 'shared',
): Promise<{ exported: number; outputDir: string }> {
  const docs = listDocuments(rootDir, scope);
  fs.mkdirSync(outputDir, { recursive: true });

  let exported = 0;
  const indexEntries: string[] = [];

  for (const doc of docs) {
    // Read original content
    let content = '';
    try {
      if (fs.existsSync(doc.filePath)) {
        const entry = toFileEntry(doc.filePath);
        content = await extractText(entry);
      }
    } catch {
      continue;
    }

    if (!content) continue;

    const title = path.basename(doc.filePath, path.extname(doc.filePath));
    const ext = path.extname(doc.filePath).toLowerCase();
    const relativePath = path.relative(rootDir, doc.filePath);
    const slug = title.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase();
    const outFile = path.join(outputDir, `${slug}.md`);

    const yamlEscape = (s: string) =>
      /[:"'[\]{}#&*!|>%@`]/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
    const frontmatter = [
      '---',
      `type: Document`,
      `title: ${yamlEscape(title)}`,
      `description: ${yamlEscape(`Extracted from ${path.basename(doc.filePath)}`)}`,
      `resource: ${yamlEscape(relativePath)}`,
      `tags: ["document", ${yamlEscape(ext.slice(1))}]`,
      `timestamp: ${yamlEscape(doc.indexedAt)}`,
      `contentHash: ${yamlEscape(doc.contentHash)}`,
      `chunkCount: ${doc.chunkCount}`,
      '---',
      '',
    ].join('\n');

    fs.writeFileSync(outFile, frontmatter + content, 'utf-8');
    indexEntries.push(
      `* [${title}](${slug}.md) - ${path.basename(doc.filePath)} (${doc.chunkCount} chunks)`,
    );
    exported++;
  }

  // Write index.md
  const indexContent = [
    `# Knowledge Bundle`,
    '',
    `Exported from monomind on ${new Date().toISOString().slice(0, 10)}`,
    '',
    ...indexEntries,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'index.md'), indexContent, 'utf-8');

  return { exported, outputDir };
}

// ── OKF Import ─────────────────────────────────────────────────────

export async function importFromOKF(
  bundleDir: string,
  scope = 'shared',
  rootDir = getProjectRoot(),
): Promise<BatchIngestResult> {
  const resolved = path.resolve(bundleDir);
  const files = fs
    .readdirSync(resolved)
    .filter((f) => f.endsWith('.md') && f !== 'index.md' && f !== 'log.md')
    .map((f) => path.join(resolved, f));

  const result: BatchIngestResult = {
    filesProcessed: 0,
    filesSkipped: 0,
    totalChunks: 0,
    errors: [],
    results: [],
  };

  for (const file of files) {
    const r = await ingestDocument(file, scope, rootDir);
    result.results.push(r);
    if (r.skipped) {
      result.filesSkipped++;
    } else {
      result.filesProcessed++;
      result.totalChunks += r.chunksIndexed;
    }
    if (r.error && !r.skipped) result.errors.push(`${r.filePath}: ${r.error}`);
  }

  return result;
}

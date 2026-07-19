/**
 * Auto-fix engine: detect -> apply safe codemods -> re-detect -> report.
 *
 * Single-pass by design: every fixer is idempotent and lands values on the
 * safe side of its detector threshold, so the re-detect step only verifies —
 * it never triggers another round of edits (no oscillation).
 *
 * Honors the same filter pipeline as `detect`: project config ignores
 * (.monodesign/config.json), inline monodesign-disable* directives, and file
 * ignores — an ignored finding is never "fixed".
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadDesignSystemForCwd } from '../design-system.mjs';
import { detectHtml } from '../engines/static-html/detect-html.mjs';
import { detectText } from '../engines/regex/detect-text.mjs';
import {
  filterDetectionFindings,
  readDetectionConfig,
  shouldIgnoreDetectionFile,
} from '../../lib/monodesign-config.mjs';
import { HTML_EXTENSIONS, walkDir } from '../node/file-system.mjs';
import { UNFIXABLE_REASONS, getFixer, fixableRuleIds, FIXERS } from './fixers.mjs';

// ---------------------------------------------------------------------------
// Edit application
// ---------------------------------------------------------------------------

/** Apply edits to content. Edits are sorted; overlapping edits are dropped
 *  (first wins). Returns { content, applied } — applied lists the edits used. */
function applyEdits(content, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept = [];
  let lastEnd = -1;
  for (const edit of sorted) {
    if (edit.start < lastEnd) continue; // overlap — first edit wins
    kept.push(edit);
    lastEnd = Math.max(edit.end, edit.start);
  }
  let result = content;
  for (let i = kept.length - 1; i >= 0; i--) {
    const { start, end, replacement } = kept[i];
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return { content: result, applied: kept };
}

/** Atomic write: temp file in the same directory, then rename over target. */
function writeFileAtomic(filePath, content) {
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.monodesign-tmp`,
  );
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Unified diff (minimal single-hunk implementation for --dry-run)
// ---------------------------------------------------------------------------

function unifiedDiff(oldText, newText, label) {
  if (oldText === newText) return '';
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const aEnd = a.length - s;
  const bEnd = b.length - s;
  const ctxStart = Math.max(0, p - 3);
  const ctxEnd = Math.min(a.length, aEnd + 3);
  const oldLen = ctxEnd - ctxStart;
  const newLen = (p - ctxStart) + (bEnd - p) + (ctxEnd - aEnd);
  const lines = [`--- a/${label}`, `+++ b/${label}`, `@@ -${ctxStart + 1},${oldLen} +${ctxStart + 1},${newLen} @@`];
  for (let i = ctxStart; i < p; i++) lines.push(` ${a[i]}`);
  for (let i = p; i < aEnd; i++) lines.push(`-${a[i]}`);
  for (let i = p; i < bEnd; i++) lines.push(`+${b[i]}`);
  for (let i = aEnd; i < ctxEnd; i++) lines.push(` ${a[i]}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Linked stylesheet resolution (HTML findings whose declaration lives in CSS)
// ---------------------------------------------------------------------------

function extractLinkedStylesheets(html, htmlPath) {
  const out = [];
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(?:https?:)?\/\//i.test(href) || href.startsWith('data:')) continue;
    const resolved = path.resolve(path.dirname(htmlPath), href.split(/[?#]/)[0]);
    if (fs.existsSync(resolved)) out.push(resolved);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fix run
// ---------------------------------------------------------------------------

function groupByRule(findings) {
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.antipattern)) byRule.set(f.antipattern, []);
    byRule.get(f.antipattern).push(f);
  }
  return byRule;
}

/**
 * Run the fix loop over file/directory targets.
 *
 * options:
 *   cwd       — project root for config + design-system loading
 *   dryRun    — compute edits and diffs; write nothing
 *   rules     — restrict fixing to these rule ids
 *   noConfig  — skip project config + inline-ignore filtering
 *
 * Returns a report:
 *   { dryRun, fixed, remaining, skipped, filesChanged, diffs, warnings }
 */
async function runFix(targets, options = {}) {
  const cwd = options.cwd || process.cwd();
  const dryRun = Boolean(options.dryRun);
  const ruleFilter = options.rules && options.rules.length ? new Set(options.rules) : null;
  const config = options.noConfig
    ? { ignoreRules: [], ignoreFiles: [], ignoreValues: [] }
    : readDetectionConfig(cwd);
  const designSystemEnabled = !options.noConfig && config.designSystem?.enabled !== false;
  const designSystem = designSystemEnabled ? loadDesignSystemForCwd(cwd) : null;
  const scanOptions = { providers: [], inlineIgnores: !options.noConfig };
  if (designSystem) scanOptions.designSystem = designSystem;

  const warnings = [];
  const files = [];
  for (const target of targets) {
    if (/^https?:\/\//i.test(target)) {
      warnings.push(`Skipping URL target ${target}: fix operates on local files only.`);
      continue;
    }
    const resolved = path.resolve(cwd, target);
    let stat;
    try { stat = fs.statSync(resolved); }
    catch { warnings.push(`Warning: cannot access ${target}`); continue; }
    if (stat.isDirectory()) {
      files.push(...walkDir(resolved).filter(f => !shouldIgnoreDetectionFile(f, cwd, config)));
    } else if (!shouldIgnoreDetectionFile(resolved, cwd, config)) {
      files.push(resolved);
    }
  }
  const uniqueFiles = [...new Set(files)];

  const detectFile = async (file) => {
    const ext = path.extname(file).toLowerCase();
    const found = HTML_EXTENSIONS.has(ext)
      ? await detectHtml(file, scanOptions)
      : detectText(fs.readFileSync(file, 'utf-8'), file, scanOptions);
    return filterDetectionFindings(found, config);
  };

  // 1. Detect
  const findingsByFile = new Map();
  for (const file of uniqueFiles) {
    const found = await detectFile(file);
    if (found.length > 0) findingsByFile.set(file, found);
  }

  // 2. Plan + apply fixes in memory. Buffers exist only for files that carry
  //    findings (or are stylesheets linked from such a file) — files with no
  //    findings are never touched.
  const buffers = new Map(); // path -> { original, content, changed, parents:Set }
  const loadBuffer = (file) => {
    let buf = buffers.get(file);
    if (!buf) {
      const original = fs.readFileSync(file, 'utf-8');
      buf = { original, content: original, changed: false, parents: new Set() };
      buffers.set(file, buf);
    }
    return buf;
  };

  const skipped = []; // { file, antipattern, count, reason }
  const attempts = []; // { file, antipattern, before, notes, targetFile }

  for (const [file, findings] of findingsByFile) {
    const ext = path.extname(file).toLowerCase();
    for (const [rule, ruleFindings] of groupByRule(findings)) {
      const count = ruleFindings.length;
      if (ruleFilter && !ruleFilter.has(rule)) {
        skipped.push({ file, antipattern: rule, count, reason: 'excluded by --rule' });
        continue;
      }
      const fixer = getFixer(rule);
      if (!fixer) {
        skipped.push({
          file,
          antipattern: rule,
          count,
          reason: UNFIXABLE_REASONS[rule] || 'no deterministic safe fix exists for this rule',
        });
        continue;
      }
      const buf = loadBuffer(file);
      let edits = fixer.fix(buf.content, ext);
      let targetFile = file;
      if (edits.length === 0 && HTML_EXTENSIONS.has(ext)) {
        // The offending declaration may live in a linked stylesheet — the
        // detector cascades linked CSS into HTML findings.
        for (const cssPath of extractLinkedStylesheets(buf.original, file)) {
          const cssBuf = loadBuffer(cssPath);
          const cssEdits = fixer.fix(cssBuf.content, path.extname(cssPath).toLowerCase());
          if (cssEdits.length > 0) {
            edits = cssEdits;
            targetFile = cssPath;
            cssBuf.parents.add(file);
            break;
          }
        }
      }
      if (edits.length === 0) {
        skipped.push({
          file,
          antipattern: rule,
          count,
          reason: 'no safely rewritable declaration found in source',
        });
        continue;
      }
      const targetBuf = loadBuffer(targetFile);
      const { content, applied } = applyEdits(targetBuf.content, edits);
      if (content !== targetBuf.content) {
        targetBuf.content = content;
        targetBuf.changed = true;
      }
      attempts.push({
        file,
        antipattern: rule,
        before: count,
        targetFile,
        notes: applied.map(e => e.note).filter(Boolean),
      });
    }
  }

  const changedFiles = [...buffers.entries()].filter(([, b]) => b.changed);
  const filesChanged = changedFiles.map(([p]) => p);

  // 3. Write (atomic) or diff (dry-run)
  const diffs = [];
  if (dryRun) {
    for (const [p, b] of changedFiles) {
      diffs.push({ file: p, diff: unifiedDiff(b.original, b.content, path.relative(cwd, p) || p) });
    }
  } else {
    for (const [p, b] of changedFiles) writeFileAtomic(p, b.content);
  }

  // 4. Re-detect touched files to verify (skip in dry-run — nothing changed
  //    on disk). Linked-CSS edits are verified through their parent HTML.
  const remaining = [];
  if (!dryRun && changedFiles.length > 0) {
    const recheck = new Set();
    for (const [p, b] of changedFiles) {
      if (findingsByFile.has(p)) recheck.add(p);
      for (const parent of b.parents) recheck.add(parent);
    }
    const after = new Map();
    for (const p of recheck) after.set(p, await detectFile(p));
    for (const attempt of attempts) {
      const afterFindings = after.get(attempt.file) || [];
      const stillThere = afterFindings.filter(f => f.antipattern === attempt.antipattern).length;
      attempt.after = stillThere;
      attempt.fixed = Math.max(0, attempt.before - stillThere);
      if (stillThere > 0) {
        remaining.push({ file: attempt.file, antipattern: attempt.antipattern, count: stillThere });
      }
    }
  } else {
    for (const attempt of attempts) {
      attempt.after = dryRun ? null : attempt.before;
      attempt.fixed = dryRun ? attempt.before : 0;
    }
  }

  return {
    dryRun,
    fixed: attempts.map(a => ({
      file: a.file,
      antipattern: a.antipattern,
      before: a.before,
      after: a.after,
      fixed: a.fixed,
      targetFile: a.targetFile,
      notes: a.notes,
    })),
    remaining,
    skipped,
    filesChanged,
    diffs,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printFixUsage() {
  console.log(`Usage: monodesign fix [options] <file-or-dir...>

Auto-fix detector findings where a deterministic, safe codemod exists.
Runs detect, applies fixes, re-detects to verify, and reports
fixed / remaining / skipped findings. Files without findings are never touched.

Options:
  --dry-run           Print unified diffs of would-be changes; write nothing
  --json              Output the fix report as JSON
  --rule <id,...>     Only fix the given rule ids
  --no-config         Skip project config and inline-ignore filtering
  --help              Show this help message

Fixable rules:
${Object.entries(FIXERS).map(([id, f]) => `  ${id.padEnd(26)} ${f.description}`).join('\n')}

Everything else is reported as skipped with a reason (e.g. broken-image:
choosing a real image is a content decision, not a codemod).

Examples:
  monodesign fix src/
  monodesign fix --dry-run index.html
  monodesign fix --rule tight-leading,tiny-text styles.css`);
}

function formatFixReport(report, jsonMode) {
  if (jsonMode) return JSON.stringify(report, null, 2);
  const out = [];
  if (report.dryRun) {
    for (const { diff } of report.diffs) {
      if (diff) out.push(diff, '');
    }
  }
  const verb = report.dryRun ? 'would fix' : 'fixed';
  for (const item of report.fixed) {
    const where = item.targetFile && item.targetFile !== item.file
      ? `${item.file} (edited ${item.targetFile})`
      : item.file;
    out.push(`${verb} [${item.antipattern}] ${item.fixed}/${item.before} in ${where}`);
  }
  for (const item of report.remaining) {
    out.push(`remaining [${item.antipattern}] ${item.count} in ${item.file}`);
  }
  for (const item of report.skipped) {
    out.push(`skipped [${item.antipattern}] ${item.count} in ${item.file} — ${item.reason}`);
  }
  const fixedTotal = report.fixed.reduce((n, f) => n + (f.fixed || 0), 0);
  const remainingTotal = report.remaining.reduce((n, f) => n + f.count, 0);
  const skippedTotal = report.skipped.reduce((n, f) => n + f.count, 0);
  out.push(`\n${report.dryRun ? 'Would fix' : 'Fixed'} ${fixedTotal}, remaining ${remainingTotal}, skipped ${skippedTotal}. ${report.filesChanged.length} file${report.filesChanged.length === 1 ? '' : 's'} ${report.dryRun ? 'would change' : 'changed'}.`);
  return out.join('\n');
}

async function runFixCli(args) {
  const targets = [];
  const options = { dryRun: false, rules: null, noConfig: false };
  let jsonMode = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { printFixUsage(); process.exit(0); }
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') jsonMode = true;
    else if (arg === '--no-config') options.noConfig = true;
    else if (arg === '--rule' || arg.startsWith('--rule=')) {
      const value = arg.startsWith('--rule=') ? arg.slice('--rule='.length) : args[++i];
      if (!value || value.startsWith('--')) {
        process.stderr.write('Error: --rule requires a comma-separated list of rule ids.\n');
        process.exit(1);
      }
      options.rules = [...(options.rules || []), ...value.split(',').map(s => s.trim()).filter(Boolean)];
    } else if (arg.startsWith('--')) {
      process.stderr.write(`Error: unknown option ${arg}\n\nRun: monodesign fix --help\n`);
      process.exit(1);
    } else {
      targets.push(arg);
    }
  }

  if (options.rules) {
    const fixable = new Set(fixableRuleIds());
    const unknown = options.rules.filter(r => !fixable.has(r));
    if (unknown.length > 0) {
      process.stderr.write(`Error: no fixer for rule(s): ${unknown.join(', ')}.\nFixable rules: ${fixableRuleIds().join(', ')}\n`);
      process.exit(1);
    }
  }

  if (targets.length === 0) {
    process.stderr.write('Error: fix requires at least one file or directory target.\n\nRun: monodesign fix --help\n');
    process.exit(1);
  }

  const report = await runFix(targets, options);
  for (const warning of report.warnings) process.stderr.write(`${warning}\n`);
  const formatted = formatFixReport(report, jsonMode);
  if (jsonMode || report.dryRun) process.stdout.write(formatted + '\n');
  else process.stderr.write(formatted + '\n');
  process.exit(!report.dryRun && report.remaining.length > 0 ? 2 : 0);
}

export {
  runFix,
  runFixCli,
  applyEdits,
  unifiedDiff,
  writeFileAtomic,
  extractLinkedStylesheets,
  printFixUsage,
  formatFixReport,
};

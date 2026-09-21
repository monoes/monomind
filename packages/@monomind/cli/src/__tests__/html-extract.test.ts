/**
 * RCL-01 — HTML and MHTML ingest.
 *
 * Boilerplate stripping is the quality-critical half: an unstripped nav,
 * header, footer and cookie banner are byte-identical across every page of a
 * site, so every captured document's embedding drifts toward the chrome
 * instead of the article. These tests assert the chrome is GONE, not merely
 * that the article survived.
 *
 * The MHTML fixtures are hand-written MIME containers (see
 * `fixtures/capture/`): `page.mhtml` carries a quoted-printable root frame
 * plus a base64 sub-frame that must NOT win root selection, and `legacy.mht`
 * is a base64 windows-1252 single-part archive.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractHtmlDocument, htmlToMarkdown } from '../knowledge/html-extract.js';
import { mhtmlToHtml, parseMhtml } from '../knowledge/mhtml.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'capture');
const messyHtml = fs.readFileSync(path.join(FIXTURES, 'messy.html'), 'utf-8');

describe('htmlToMarkdown — structure', () => {
  const text = htmlToMarkdown(messyHtml);

  it('preserves headings as ATX headings at their original level', () => {
    expect(text).toContain('# Sprocket Calibration');
    expect(text).toContain('## Tolerances');
    expect(text).toContain('### Torque table');
  });

  it('renders list items as "- " bullets', () => {
    expect(text).toContain('- Check the hub');
    expect(text).toContain('- Seat the bearing');
  });

  it('keeps link text and drops the markup around it', () => {
    expect(text).toContain('the sprocket bench');
    expect(text).not.toContain('href');
    expect(text).not.toContain('<a ');
  });

  it('collapses block-level whitespace inside a paragraph', () => {
    expect(text).toContain(
      'Calibrating a sprocket requires a torque wrench and the sprocket bench.',
    );
  });

  it('decodes HTML entities', () => {
    expect(text).toContain('Hold the gap to <0.2 mm — anything wider chatters.');
  });

  it('reads the document title out of <head>', () => {
    expect(extractHtmlDocument(messyHtml).title).toBe('Sprocket Calibration & You');
  });

  it('emits table rows with cell separators', () => {
    expect(text).toContain('Bolt | Nm');
    expect(text).toContain('M6 | 9');
  });

  it('never emits a raw tag', () => {
    expect(text).not.toMatch(/<\/?[a-z]/i);
  });
});

describe('htmlToMarkdown — boilerplate stripping', () => {
  const text = htmlToMarkdown(messyHtml);

  it('drops script, style and noscript content', () => {
    expect(text).not.toContain('dataLayer');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('Enable JavaScript');
  });

  it('drops inline svg (including its <title>)', () => {
    expect(text).not.toContain('diagram');
    expect(text).not.toContain('M0 0');
  });

  it('drops the cookie/consent banner', () => {
    expect(text).not.toMatch(/cookies/i);
    expect(text).not.toContain('Accept all');
  });

  it('drops header, nav, aside and footer containers', () => {
    expect(text).not.toContain('Widgetcorp'); // header brand + footer copyright
    expect(text).not.toContain('Alpha');
    expect(text).not.toContain('Beta');
    expect(text).not.toContain('Chainring');
    expect(text).not.toContain('All rights reserved');
  });

  it('drops newsletter/subscribe promos by class', () => {
    expect(text).not.toMatch(/newsletter/i);
  });

  it('drops aria-hidden subtrees', () => {
    expect(text).not.toContain('Decorative separator');
  });

  it('drops role=navigation on a non-nav element', () => {
    const out = htmlToMarkdown(
      '<div role="navigation"><a href="/x">Menu item</a></div><p>Body copy.</p>',
    );
    expect(out).not.toContain('Menu item');
    expect(out).toContain('Body copy.');
  });

  it('drops display:none and hidden subtrees', () => {
    const out = htmlToMarkdown(
      '<div style="display:none">Hidden tracker</div><div hidden>Also hidden</div><p>Visible.</p>',
    );
    expect(out).not.toContain('Hidden tracker');
    expect(out).not.toContain('Also hidden');
    expect(out).toContain('Visible.');
  });

  it('keeps everything when boilerplate stripping is switched off', () => {
    const out = htmlToMarkdown(messyHtml, { stripBoilerplate: false });
    expect(out).toContain('Widgetcorp');
    // script/style are never "boilerplate" — they are non-text and always go.
    expect(out).not.toContain('dataLayer');
  });

  it('survives unclosed and malformed tags', () => {
    const out = htmlToMarkdown('<p>One<p>Two<div><span>Three</div></p></span>');
    expect(out).toContain('One');
    expect(out).toContain('Two');
    expect(out).toContain('Three');
  });

  it('returns empty text for an empty or tag-only document', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('<html><head></head><body></body></html>')).toBe('');
  });
});

describe('parseMhtml', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'page.mhtml'), 'latin1');

  it('reads the container headers, including a folded Content-Type', () => {
    const parsed = parseMhtml(raw);
    expect(parsed.snapshotLocation).toBe('https://example.com/sprockets/calibration');
    expect(parsed.subject).toBe('Sprocket Calibration');
    expect(parsed.parts).toHaveLength(3);
  });

  it('selects the root frame by Snapshot-Content-Location, not document order', () => {
    const parsed = parseMhtml(raw);
    expect(parsed.root?.location).toBe('https://example.com/sprockets/calibration');
    expect(parsed.root?.encoding).toBe('quoted-printable');
  });

  it('decodes quoted-printable soft breaks and =XX escapes', () => {
    const html = mhtmlToHtml(raw).html;
    // `we=\r\nekly` is a soft break; `=3D` is a literal "="; `=E2=80=94` is —.
    expect(html).toContain('calibrated weekly');
    expect(html).toContain('9=Nm — no more');
  });

  it('decodes a base64 part under its declared charset', () => {
    const legacy = fs.readFileSync(path.join(FIXTURES, 'legacy.mht'), 'latin1');
    const parsed = parseMhtml(legacy);
    expect(parsed.root?.charset).toBe('windows-1252');
    expect(mhtmlToHtml(legacy).html).toContain('Espresso © 1998 — pulled at 93°C.');
  });

  it('falls back to the whole document when there is no MIME boundary', () => {
    const plain = '<html><body><p>Not really an archive.</p></body></html>';
    expect(mhtmlToHtml(plain).html).toContain('Not really an archive.');
  });
});

describe('mhtml → readable text', () => {
  it('runs the selected root frame through the HTML extractor', () => {
    const raw = fs.readFileSync(path.join(FIXTURES, 'page.mhtml'), 'latin1');
    const text = htmlToMarkdown(mhtmlToHtml(raw).html);

    expect(text).toContain('# Sprocket Calibration');
    expect(text).toContain('Torque to 9=Nm — no more.');
    expect(text).toContain('- Check the hub');
    // The base64 sub-frame is a different Content-Location — it is not the root.
    expect(text).not.toContain('Advertisement iframe body');
    // nav/footer inside the archived page are stripped like any other page.
    expect(text).not.toContain('Home Docs');
    expect(text).not.toContain('2026 Widgetcorp');
  });

  it('prepends the <title> when the page has no h1 of its own', () => {
    const out = htmlToMarkdown(
      '<html><head><title>Quarterly Notes</title></head><body><p>Body copy.</p></body></html>',
    );
    expect(out.startsWith('# Quarterly Notes')).toBe(true);
  });

  it('does not duplicate a title the page already carries as an h1', () => {
    const legacy = fs.readFileSync(path.join(FIXTURES, 'legacy.mht'), 'latin1');
    const text = htmlToMarkdown(mhtmlToHtml(legacy).html);
    expect(text.match(/# Café Notes/g)).toHaveLength(1);
  });
});

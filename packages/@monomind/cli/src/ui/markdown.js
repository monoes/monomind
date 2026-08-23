// packages/@monomind/cli/src/ui/markdown.js
// High-fidelity markdown renderer, extracted out of dashboard.html (#124 —
// it was one of four hand-copied markdown-to-HTML renderers in that file,
// each with different escaping coverage; this was the most complete one,
// so the others were left in place rather than forced onto this one's
// styling without a way to visually verify every call site).
//
// Loaded as a classic <script src="markdown.js"> (see the tag right before
// the main inline <script> in dashboard.html) — NOT an ES module — so
// renderDocMarkdown and gdCopyCode stay plain globals, exactly like every
// other dashboard.html function, and every existing call site keeps working
// unmodified.
//
// Handles: headings (h1-h6) with anchors, bold/italic/strikethrough, inline
// code and fenced code blocks (with language label + copy button), unordered/
// ordered/nested/task lists, GFM tables, nested blockquotes, horizontal rules,
// links (external get rel=noopener + target=_blank), images, line breaks.
// HTML-escaped at the boundary; nothing the source contains can inject markup.
function _renderDocMarkdown(md) {
  if (!md) return '';
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  // Escapes a URL for safe insertion into a double-quoted HTML attribute.
  // #124: links/images previously interpolated `href`/`src` RAW — the
  // sanitizer below (sanitizeHtmlBlock) only ever ran on raw HTML blocks,
  // never on markdown-link URLs, so `[x](" onmouseover="alert(1))` could
  // break out of the attribute. `esc()` alone is sufficient here since a
  // quote is the only character that lets a URL escape a double-quoted
  // attribute value.
  const escAttr = (s) => String(s).replace(/"/g, '&quot;');
  // #124-review: escAttr() alone stops attribute-breakout XSS (a `"` can't
  // escape the quoted attribute value) but does nothing about SCHEME-based
  // execution — `[click me](javascript:alert(document.cookie))` rendered as
  // a fully clickable, executable link even after the escAttr() fix, and
  // sanitizeHtmlBlock() below (which DOES filter javascript: hrefs/srcs)
  // only ever runs on raw HTML blocks, never on markdown-syntax links/
  // images. Reject any scheme outside an explicit allowlist — relative/
  // same-origin URLs (no colon before the first `/`) are always allowed.
  const SAFE_URL_SCHEMES = /^(https?|mailto|tel):/i;
  const safeUrl = (u) => {
    const s = String(u);
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s);
    if (hasScheme && !SAFE_URL_SCHEMES.test(s)) return '#';
    return s;
  };

  // 1. Strip a leading YAML frontmatter block (mastermind plan/spec files have one).
  let src = String(md).replace(/^﻿?---[\s\S]*?\n---\s*\n/, '');

  // 2. Extract fenced code blocks first so their contents are never reinterpreted.
  // #124-review: previously unanchored (`/```.../g`), so it matched a fence
  // even when preceded by a blockquote's "> " marker, extracting it at the
  // OUTER (top-level) call. The bare placeholder left behind then got
  // captured as ordinary blockquote body text, and flushBQ()'s recursive
  // renderDocMarkdown() call resolves placeholders against its OWN fresh,
  // empty codeBlocks array -- silently producing an empty, unlabeled code
  // block instead of the real content. Anchoring the match to true
  // line-start (mirroring the HTML-block regex below, which already does
  // this and was never affected) means a blockquote-nested fence is simply
  // left alone here and gets extracted correctly by the recursive call
  // instead, once the "> " markers have been stripped from each line.
  const codeBlocks = [];
  src = src.replace(/(^|\n)```([\w+-]*)\n?([\s\S]*?)```/g, (_m, lead, lang, code) => {
    const clean = code.replace(/\n$/, '');
    codeBlocks.push({ lang: (lang || '').toLowerCase(), code: clean });
    return `${lead || ''}\u0000CB${codeBlocks.length - 1}\u0000`;
  });

  // 3. Extract inline HTML blocks (multiline <div>…</div> etc.) — pass through
  //    verbatim after escaping, so user-authored HTML in a plan still renders
  //    structurally without enabling script injection (we'll re-strip <script>
  //    and on* handlers at the end).
  const htmlBlocks = [];
  src = src.replace(/(^|\n)(<(\w+)[^>\n]*>[\s\S]*?<\/\3>)(?=\n|$)/g, (_m, lead, html) => {
    htmlBlocks.push(html);
    return `${lead || ''}\u0000HB${htmlBlocks.length - 1}\u0000`;
  });

  // 4. Escape everything that remains.
  src = esc(src)
    .replace(/\u0000CB(\d+)\u0000/g, 'CB$1')
    .replace(/\u0000HB(\d+)\u0000/g, 'HB$1');

  // 5. Block-level transforms: tables, headings, hr, blockquotes, lists.
  //    Operate line-by-line so nesting and paragraph grouping stay coherent.
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  let inUl = false,
    inOl = false,
    inTask = false,
    bqBuf = [],
    paraBuf = [];

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
    if (inTask) {
      out.push('</ul>');
      inTask = false;
    }
  };
  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${paraBuf.join(' ')}</p>`);
      paraBuf = [];
    }
  };
  // Reverses esc() — bqBuf holds lines captured AFTER step 4's escaping, so
  // recursing back into renderDocMarkdown() (which escapes its input itself)
  // would double-escape (`&lt;` -> `&amp;lt;`) without this.
  const unescapeOnce = (s) =>
    String(s)
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  const flushBQ = () => {
    if (!bqBuf.length) return;
    // Recursively render the inner block so nested formatting works.
    out.push(`<blockquote>${_renderDocMarkdown(unescapeOnce(bqBuf.join('\n')))}</blockquote>`);
    bqBuf = [];
  };
  const slugify = (s) =>
    String(s)
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

  while (i < lines.length) {
    const line = lines[i];

    // Block placeholders for code/html blocks (they sit on their own line).
    const cbMatch = line.match(/^CB(\d+)$/);
    if (cbMatch) {
      closeLists();
      flushPara();
      flushBQ();
      out.push(renderCodeBlock(codeBlocks[+cbMatch[1]]));
      i++;
      continue;
    }
    const hbMatch = line.match(/^HB(\d+)$/);
    if (hbMatch) {
      closeLists();
      flushPara();
      flushBQ();
      out.push(sanitizeHtmlBlock(htmlBlocks[+hbMatch[1]]));
      i++;
      continue;
    }

    // Blank line: paragraph + list breaks.
    if (line.trim() === '') {
      closeLists();
      flushPara();
      flushBQ();
      i++;
      continue;
    }

    // Headings (with anchor).
    const h = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
    if (h) {
      closeLists();
      flushPara();
      flushBQ();
      const lvl = h[1].length;
      const txt = inlineMd(h[2]);
      const id = slugify(h[2]);
      out.push(`<h${lvl} id="${id}">${txt}</h${lvl}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^(\*\s*){3,}$/.test(line) || /^(-\s*){3,}$/.test(line) || /^(_\s*){3,}$/.test(line)) {
      closeLists();
      flushPara();
      flushBQ();
      out.push('<hr>');
      i++;
      continue;
    }

    // GFM table — a block of consecutive lines where line 0 and line 1 look
    // like | a | b |  /  |---|---|. Scan forward to collect the full table.
    if (
      /^\s*\|.+\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s:|-]+\|?\s*$/.test(lines[i + 1])
    ) {
      closeLists();
      flushPara();
      flushBQ();
      const headerCells = splitTableRow(line);
      const aligns = parseTableAligns(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push(renderTable(headerCells, aligns, rows));
      continue;
    }

    // Blockquote. `line` has already been through esc() (step 4 above), so a
    // source `>` is now the literal text `&gt;` by this point — match that,
    // not a raw `>` (which can never appear here and never matched).
    const bq = line.match(/^&gt;\s?(.*)$/);
    if (bq) {
      closeLists();
      flushPara();
      bqBuf.push(bq[1]);
      i++;
      continue;
    }
    if (bqBuf.length) {
      flushBQ();
    }

    // Task list item.
    const task = line.match(/^(\s*)([-*])\s+\[( |x|X)\]\s+(.+)$/);
    if (task) {
      flushPara();
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
      if (!inTask) {
        out.push('<ul class="md-tasklist">');
        inTask = true;
      }
      const checked = task[3].toLowerCase() === 'x';
      out.push(
        '<li><input type="checkbox" disabled' +
          (checked ? ' checked' : '') +
          '> ' +
          inlineMd(task[4]) +
          '</li>',
      );
      i++;
      continue;
    }

    // Unordered list item.
    const ul = line.match(/^(\s*)([-*+])\s+(.+)$/);
    if (ul && !task) {
      flushPara();
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
      if (inTask) {
        out.push('</ul>');
        inTask = false;
      }
      if (!inUl) {
        out.push('<ul>');
        inUl = true;
      }
      const indent = ul[1].length;
      if (indent === 0) out.push(`<li>${inlineMd(ul[3])}</li>`);
      else {
        // Nested list — close current top item and open a nested <ul>.
        out.push(`<li>${inlineMd(ul[3])}</li>`);
      }
      i++;
      continue;
    }
    // Ordered list item.
    const ol = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (inTask) {
        out.push('</ul>');
        inTask = false;
      }
      if (!inOl) {
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${inlineMd(ol[3])}</li>`);
      i++;
      continue;
    }

    // Otherwise: paragraph text. Buffer until a blank line / structural break.
    closeLists();
    flushBQ();
    paraBuf.push(inlineMd(line));
    i++;
  }
  closeLists();
  flushPara();
  flushBQ();

  let html = out.join('\n');
  // 6. Restore code/html block placeholders INSIDE paragraphs (when a CB/HB
  //    token got buffered as paragraph text instead of sitting alone).
  html = html
    .replace(/CB(\d+)/g, (_m, idx) => renderCodeBlock(codeBlocks[+idx]))
    .replace(/HB(\d+)/g, (_m, idx) => sanitizeHtmlBlock(htmlBlocks[+idx]));
  return html;

  // ── helpers ──
  function inlineMd(s) {
    // Inline code first (so its contents aren't reformatted).
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_m, c) => {
      codes.push(c);
      return `\u0001C${codes.length - 1}\u0001`;
    });
    // Images: ![alt](src "title")
    s = s.replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_m, alt, src, title) =>
        '<img src="' +
        escAttr(safeUrl(src)) +
        '" alt="' +
        esc(alt) +
        '"' +
        (title ? ` title="${esc(title)}"` : '') +
        ' loading="lazy" style="max-width:100%;height:auto;border-radius:6px">',
    );
    // Links: [text](href "title")
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, txt, href, title) => {
      const external = /^(https?:|mailto:|tel:)/i.test(href);
      const safe = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return (
        '<a href="' +
        escAttr(safeUrl(href)) +
        '"' +
        (title ? ` title="${esc(title)}"` : '') +
        safe +
        '>' +
        txt +
        '</a>'
      );
    });
    // Bold.
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    // Italic.
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    // Strikethrough.
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    // Restore inline code.
    s = s.replace(/\u0001C(\d+)\u0001/g, (_m, idx) => `<code>${esc(codes[+idx])}</code>`);
    return s;
  }

  function renderCodeBlock(block) {
    const lang = block?.lang || '';
    const code = block?.code ?? '';
    const labelHtml = lang ? `<span class="gd-code-lang">${esc(lang)}</span>` : '';
    return (
      '<div class="gd-code-block">' +
      '<div class="gd-code-bar"><button class="gd-code-copy" onclick="gdCopyCode(this)">copy</button>' +
      labelHtml +
      '</div>' +
      '<pre><code' +
      (lang ? ` class="language-${esc(lang)}"` : '') +
      '>' +
      esc(code) +
      '</code></pre>' +
      '</div>'
    );
  }

  function sanitizeHtmlBlock(html) {
    // Strip <script> entirely, drop event-handler attributes (onclick=, onload=, on*=),
    // and javascript: URLs. Keep everything else as-is so user HTML renders.
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"');
  }

  function splitTableRow(line) {
    return line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  }
  function parseTableAligns(line) {
    return splitTableRow(line).map((cell) => {
      if (/^:\s*-+:$/.test(cell)) return 'center';
      if (/^-*:$/.test(cell)) return 'left';
      if (/^-+:$/.test(cell)) return 'right';
      return null;
    });
  }
  function renderTable(headerCells, aligns, rows) {
    const alignAttr = (i) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : '');
    let html = '<div class="gd-table-wrap"><table><thead><tr>';
    headerCells.forEach((c, i) => {
      html += `<th${alignAttr(i)}>${inlineMd(c)}</th>`;
    });
    html += '</tr></thead><tbody>';
    for (const r of rows) {
      html += '<tr>';
      r.forEach((c, i) => {
        html += `<td${alignAttr(i)}>${inlineMd(c)}</td>`;
      });
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }
}

function _gdCopyCode(btn) {
  const codeEl = btn.closest('.gd-code-block')?.querySelector('code');
  if (!codeEl) return;
  const text = codeEl.textContent;
  navigator.clipboard.writeText(text).then(
    () => {
      const old = btn.textContent;
      btn.textContent = 'copied';
      setTimeout(() => {
        btn.textContent = old;
      }, 1200);
    },
    () => {
      btn.textContent = 'failed';
    },
  );
}

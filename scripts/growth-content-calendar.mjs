#!/usr/bin/env node
// Renders the public content calendar (HTML + MD) from monomind-growth's
// workspace/articles.md (6 pillar articles) + workspace/posts.md (channel
// posts derived from those articles, reusing their images). Regenerate
// after any growth org run:
//   node scripts/growth-content-calendar.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ORGS = [
  { name: 'monomind-growth', dir: path.join(ROOT, '.monomind/orgs/monomind-growth/workspace') },
  { name: 'growth-execution', dir: path.join(ROOT, '.monomind/orgs/growth-execution/workspace') },
];
const OUT_DIR = path.join(ROOT, '.monomind/orgs/monomind-growth/workspace/reports/content-calendar');

// Record format in articles.md (one per pillar article):
//
// ### <slug> — <Title>
// HeroImage: <filename>
// SupportingImages: <filename>, <filename>
// <full article body>
function parseArticles(text, org) {
  const articles = [];
  const blocks = text.split(/^### /m).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    const m = lines[0].match(/^(.+?)\s*—\s*(.+?)\s*$/);
    if (!m) continue;
    const [, slug, title] = m;
    let heroImage = null;
    let supportingImages = [];
    const bodyLines = [];
    for (const line of lines.slice(1)) {
      const heroMatch = line.match(/^HeroImage:\s*(.+?)\s*$/i);
      const suppMatch = line.match(/^SupportingImages:\s*(.+?)\s*$/i);
      if (heroMatch) { heroImage = heroMatch[1]; continue; }
      if (suppMatch) { supportingImages = suppMatch[1].split(',').map((s) => s.trim()).filter(Boolean); continue; }
      bodyLines.push(line);
    }
    const body = bodyLines.join('\n').trim();
    if (!body) continue;
    articles.push({ org, slug: slug.trim(), title: title.trim(), heroImage, supportingImages, body });
  }
  return articles;
}

// Record format in posts.md (one per finalized, ready-to-publish post):
//
// ### <Channel> — <YYYY-MM-DD>
// Article: <slug>
// Image: <filename>
// <final publish-ready text, until the next "### " or EOF>
function parsePosts(text, org) {
  const posts = [];
  const blocks = text.split(/^### /m).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    const m = lines[0].match(/^(.+?)\s*—\s*(\d{4}-\d{2}-\d{2})\s*$/);
    if (!m) continue;
    const [, channel, date] = m;
    let image = null;
    let article = null;
    const bodyLines = [];
    for (const line of lines.slice(1)) {
      const imgMatch = line.match(/^Image:\s*(.+?)\s*$/i);
      const articleMatch = line.match(/^Article:\s*(.+?)\s*$/i);
      if (imgMatch) { image = imgMatch[1]; continue; }
      if (articleMatch) { article = articleMatch[1]; continue; }
      bodyLines.push(line);
    }
    const text = bodyLines.join('\n').trim();
    if (!text) continue;
    posts.push({ org, channel: channel.trim(), date, article, text, image });
  }
  return posts;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mdToHtml(md) {
  // Minimal renderer: paragraphs, headings, code fences, bold/italic, links, tables.
  return escapeHtml(md)
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>');
}

function render() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let articles = [];
  let posts = [];
  for (const org of ORGS) {
    const articlesFile = path.join(org.dir, 'articles.md');
    if (fs.existsSync(articlesFile)) articles.push(...parseArticles(fs.readFileSync(articlesFile, 'utf8'), org.name));
    const postsFile = path.join(org.dir, 'posts.md');
    if (fs.existsSync(postsFile)) posts.push(...parsePosts(fs.readFileSync(postsFile, 'utf8'), org.name));
  }

  // dedupe articles by slug (growth-execution mirrors monomind-growth)
  { const bySlug = new Map(); for (const a of articles) if (!bySlug.has(a.slug)) bySlug.set(a.slug, a); articles = [...bySlug.values()]; }

  // dedupe identical posts mirrored across both orgs
  const merged = new Map();
  for (const p of posts) {
    const key = `${p.channel}|${p.date}|${p.text}`;
    const existing = merged.get(key);
    if (existing) { if (!existing.orgs.includes(p.org)) existing.orgs.push(p.org); }
    else merged.set(key, { ...p, orgs: [p.org] });
  }
  posts = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date));

  const articleBySlug = new Map(articles.map((a) => [a.slug, a]));

  // copy every referenced image (article hero/supporting + post images) alongside html/md
  const copied = new Set();
  const allImageNames = new Set([
    ...articles.flatMap((a) => [a.heroImage, ...a.supportingImages].filter(Boolean)),
    ...posts.map((p) => p.image).filter(Boolean),
  ]);
  for (const name of allImageNames) {
    for (const org of ORGS) {
      const src = path.join(org.dir, 'assets', name);
      if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(OUT_DIR, name)); copied.add(name); break; }
    }
  }

  // --- MD ---
  const md = [];
  md.push('# Monomind Growth — Content Calendar (auto-generated)');
  md.push('');
  md.push("Regenerated by `scripts/growth-content-calendar.mjs` from workspace/articles.md (pillar articles) + workspace/posts.md (channel posts derived from them). Newest publish date first.");
  md.push('');
  md.push(`## Pillar Articles (${articles.length}/6)`);
  for (const a of articles) {
    md.push(`\n### ${a.title}  \`${a.slug}\``);
    if (a.heroImage) md.push(`\n![${a.title}](./${a.heroImage})`);
    md.push(`\n${a.body}`);
  }
  md.push('\n---\n\n## Channel Calendar');
  let lastDate = null;
  for (const p of posts) {
    if (p.date !== lastDate) { md.push(`\n## ${p.date}`); lastDate = p.date; }
    const src = articleBySlug.get(p.article);
    md.push(`\n### ${p.channel}${src ? ` — based on _"${src.title}"_` : ''}\n`);
    md.push(p.text);
    if (p.image) md.push(`\n![${p.channel} image](./${p.image})`);
  }
  if (!articles.length && !posts.length) md.push('\n_Nothing finalized yet — articles.md and posts.md are empty for both orgs._');
  fs.writeFileSync(path.join(OUT_DIR, 'content-calendar.md'), md.join('\n') + '\n');

  // --- HTML (monoes design system: espresso/ivory/gold) ---
  const groups = [];
  { let cur = null; for (const p of posts) { if (p.date !== cur?.date) { cur = { date: p.date, items: [] }; groups.push(cur); } cur.items.push(p); } }

  function postCard(p) {
    const img = p.image && copied.has(p.image) ? `<img class="thumb" src="./${escapeHtml(p.image)}" alt="">` : '';
    const src = articleBySlug.get(p.article);
    return `<div class="card">
      <div class="channel">${escapeHtml(p.channel)}${src ? ` <span class="based-on">based on "${escapeHtml(src.title)}"</span>` : ''}</div>
      ${img}
      <div class="text">${escapeHtml(p.text).replace(/\n/g, '<br>')}</div>
    </div>`;
  }

  function articleCard(a) {
    const img = a.heroImage && copied.has(a.heroImage) ? `<img class="hero" src="./${escapeHtml(a.heroImage)}" alt="">` : '';
    const supp = a.supportingImages.filter((n) => copied.has(n)).map((n) => `<img class="supporting" src="./${escapeHtml(n)}" alt="">`).join('');
    return `<div class="article">
      <div class="article-slug">${escapeHtml(a.slug)}</div>
      <h3 class="article-title">${escapeHtml(a.title)}</h3>
      ${img}
      ${supp ? `<div class="supporting-row">${supp}</div>` : ''}
      <div class="article-body"><p>${mdToHtml(a.body)}</p></div>
    </div>`;
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Monomind Growth — Content Calendar</title>
<style>
:root {
  --ivory:#FAF7F0; --ivory-warm:#F5F0E6; --ivory-deep:#EDE8DC;
  --espresso:#2A2318; --espresso-deep:#1a1208; --espresso-mid:#3D3228; --espresso-light:#5C4F3D;
  --gold:#C8A97E; --gold-warm:#D4A84A;
  color-scheme: light dark;
  --bg: var(--espresso-deep); --surface: var(--espresso); --card: var(--espresso-mid);
  --border: var(--espresso-light); --text: var(--ivory); --muted: rgba(250,247,240,0.55); --accent: var(--gold);
}
@media (prefers-color-scheme: light) {
  :root { --bg: var(--ivory); --surface: var(--ivory-warm); --card: #ffffff; --border: var(--ivory-deep); --text: var(--espresso); --muted: #6b5f4d; --accent: #8B6914; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
header { padding:2.5rem 1.5rem 1rem; max-width:860px; margin:0 auto; }
h1 { margin:0 0 .3rem; font-size:1.7rem; font-weight:300; letter-spacing:.01em; }
.sub { color:var(--muted); font-size:.85rem; }
main { max-width:860px; margin:0 auto; padding:0 1.5rem 4rem; }
.section-heading { font-size:1.1rem; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid var(--border); padding:2rem 0 .6rem; margin-bottom:1.2rem; }
.date-heading { font-size:1.0rem; font-weight:700; color:var(--accent); padding:1.4rem 0 .5rem; }
.article { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:1.5rem 1.7rem; margin-bottom:1.5rem; }
.article-slug { font:11px ui-monospace,monospace; color:var(--accent); text-transform:uppercase; letter-spacing:.08em; margin-bottom:.3rem; }
.article-title { margin:0 0 1rem; font-size:1.3rem; font-weight:400; }
.article .hero { width:100%; border-radius:10px; margin-bottom:1rem; display:block; }
.supporting-row { display:flex; gap:.6rem; margin-bottom:1rem; }
.supporting-row img { width:100%; border-radius:8px; }
.article-body { font-size:.92rem; color:var(--text); }
.article-body p { white-space:pre-wrap; }
.card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:1.1rem 1.3rem; margin-bottom:1rem; }
.channel { font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); margin-bottom:.6rem; }
.based-on { font-weight:400; text-transform:none; letter-spacing:0; color:var(--muted); font-style:italic; }
.thumb { max-width:100%; border-radius:8px; margin-bottom:.7rem; display:block; }
.text { font-size:.92rem; white-space:normal; }
.empty { color:var(--muted); padding:2rem 0; }
</style></head>
<body>
<header>
  <h1>Monomind Growth — Content Calendar</h1>
  <div class="sub">Auto-generated from workspace/articles.md (pillar articles) + workspace/posts.md (channel posts derived from them). Newest publish date first.</div>
</header>
<main>
${articles.length ? `<div class="section-heading">Pillar Articles (${articles.length}/6)</div>${articles.map(articleCard).join('\n')}` : ''}
${groups.length ? `<div class="section-heading">Channel Calendar</div>${groups.map((g) => `<div class="date-heading">${g.date}</div>${g.items.map(postCard).join('\n')}`).join('\n')}` : ''}
${!articles.length && !posts.length ? '<div class="empty">Nothing finalized yet — articles.md and posts.md are empty for both orgs.</div>' : ''}
</main>
</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, 'content-calendar.html'), html);

  console.log(`Wrote ${articles.length} article(s), ${posts.length} post(s), ${copied.size} image(s) -> ${path.relative(ROOT, OUT_DIR)}`);
}

render();

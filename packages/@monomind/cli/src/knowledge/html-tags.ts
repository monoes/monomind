/**
 * Tag and entity tables for the HTML extractor (RCL-01).
 *
 * Split out of `html-extract.ts` purely for size: these are data, the file
 * next door is the algorithm.
 *
 * @module v1/cli/knowledge/html-tags
 */

export const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements whose content is never prose. Dropped regardless of options. */
export const NON_TEXT_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'math',
  'template',
  'canvas',
  'iframe',
  'object',
  'applet',
  'audio',
  'video',
]);

/** Structural chrome. Dropped only when `stripBoilerplate` is on. */
export const CHROME_TAGS = new Set([
  'nav',
  'header',
  'footer',
  'aside',
  'menu',
  'dialog',
  'button',
  'select',
  'textarea',
]);

/** ARIA landmark roles that mark chrome rather than content. */
export const CHROME_ROLES = new Set([
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'search',
  'menubar',
  'menu',
  'toolbar',
  'dialog',
  'alertdialog',
]);

/**
 * Class/id word list. Matched against `-`/`_`/space/camelCase-split tokens, so
 * `site-header`, `cookieBanner` and `ad_slot` all hit and `content-wrapper`
 * does not.
 */
export const CHROME_WORDS = new Set([
  'cookie',
  'cookies',
  'consent',
  'gdpr',
  'ccpa',
  'cmp',
  'banner',
  'promo',
  'promotion',
  'ad',
  'ads',
  'advert',
  'advertisement',
  'adsbygoogle',
  'sponsored',
  'newsletter',
  'subscribe',
  'signup',
  'paywall',
  'popup',
  'modal',
  'overlay',
  'lightbox',
  'nav',
  'navbar',
  'navigation',
  'menu',
  'breadcrumb',
  'breadcrumbs',
  'masthead',
  'topbar',
  'toolbar',
  'sidebar',
  'skiplink',
  'pagination',
  'paginate',
  'pager',
  'share',
  'sharing',
  'social',
  'socials',
  'footer',
  'header',
  'copyright',
  'related',
  'recommended',
  'recirc',
  'trending',
  'comments',
  'disqus',
]);

/** Elements that start a new output block. */
export const BLOCK_TAGS = new Set([
  'address',
  'article',
  'blockquote',
  'br',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
  'ul',
]);

/** Table cells are joined into their row with ` | ` rather than broken out
 *  into blocks of their own, so a row survives as one readable line. */
export const CELL_TAGS = new Set(['td', 'th']);

/** Elements whose content is raw text — `<` inside them is not markup. */
export const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

// ── Entities ───────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  dagger: '†',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  prime: '′',
  larr: '←',
  rarr: '→',
  harr: '↔',
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const hit = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

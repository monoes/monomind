import { extractMiddlewareChain } from '../../../src/pipeline/phases/middleware-extractor.js';

describe('extractMiddlewareChain', () => {
  // ── Pattern: none ─────────────────────────────────────────────────────────

  it('returns empty array and pattern none for a plain handler with no wrapping', () => {
    const source = `
      export default function handler(req, res) {
        res.send('ok');
      }
    `;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual([]);
    expect(result.wrapperPattern).toBe('none');
  });

  // ── Pattern: nested ───────────────────────────────────────────────────────

  it('detects single wrapper: withAuth(handler)', () => {
    const source = `export default withAuth(handler);`;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual(['withAuth']);
    expect(result.wrapperPattern).toBe('nested');
  });

  it('detects nested wrappers outermost-first: withAuth(withRateLimit(handler))', () => {
    const source = `export default withAuth(withRateLimit(handler));`;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual(['withAuth', 'withRateLimit']);
    expect(result.wrapperPattern).toBe('nested');
  });

  it('handles three-level nesting: withA(withB(withC(handler)))', () => {
    const source = `module.exports = withA(withB(withC(handler)));`;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual(['withA', 'withB', 'withC']);
    expect(result.wrapperPattern).toBe('nested');
  });

  // ── Pattern: compose ──────────────────────────────────────────────────────

  it('detects compose pattern: compose(withAuth, rateLimit)(handler)', () => {
    const source = `export default compose(withAuth, rateLimit)(handler);`;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual(['withAuth', 'rateLimit']);
    expect(result.wrapperPattern).toBe('compose');
  });

  it('detects pipe pattern: pipe(authMiddleware, rateLimitMiddleware)(handler)', () => {
    const source = `const routeHandler = pipe(authMiddleware, rateLimitMiddleware)(handler);`;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual(['authMiddleware', 'rateLimitMiddleware']);
    expect(result.wrapperPattern).toBe('compose');
  });

  it('compose with three middlewares', () => {
    const source = `export default compose(withAuth, withLogging, withRateLimit)(handler);`;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual(['withAuth', 'withLogging', 'withRateLimit']);
    expect(result.wrapperPattern).toBe('compose');
  });

  // ── Pattern: array (Express-style positional args) ────────────────────────

  it('detects Express positional middleware before handler', () => {
    const source = `
      app.get('/users', authMiddleware, handler);
    `;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual(['authMiddleware']);
    expect(result.wrapperPattern).toBe('array');
  });

  it('detects multiple Express positional middlewares', () => {
    const source = `
      router.post('/login', rateLimiter, validateBody, handler);
    `;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual(['rateLimiter', 'validateBody']);
    expect(result.wrapperPattern).toBe('array');
  });

  // ── Pattern: Next.js middleware.ts ────────────────────────────────────────

  it('detects Next.js middleware file with matcher config', () => {
    const source = `
      import { NextResponse } from 'next/server';

      export function middleware(req) {
        return NextResponse.next();
      }

      export const config = {
        matcher: ['/api/:path*'],
      };
    `;
    // handlerName doesn't matter for this detection
    const result = extractMiddlewareChain(source, 'middleware');
    expect(result.middlewareNames).toEqual(['middleware.ts']);
    expect(result.wrapperPattern).toBe('none');
  });

  it('Next.js middleware with default export and matcher', () => {
    const source = `
      export default async function middleware(request) {
        return null;
      }
      export const config = { matcher: '/admin' };
    `;
    const result = extractMiddlewareChain(source, 'someHandler');
    expect(result.middlewareNames).toEqual(['middleware.ts']);
    expect(result.wrapperPattern).toBe('none');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('returns empty when handler name does not appear in source', () => {
    const source = `app.get('/foo', someOtherHandler);`;
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual([]);
    expect(result.wrapperPattern).toBe('none');
  });

  it('only scans first 3000 characters', () => {
    const padding = 'x'.repeat(2990);
    const source = `${padding}\nexport default withAuth(handler);`;
    // handlerName appears past the 3000-char limit — should not be found
    const result = extractMiddlewareChain(source, 'handler');
    expect(result.middlewareNames).toEqual([]);
  });
});

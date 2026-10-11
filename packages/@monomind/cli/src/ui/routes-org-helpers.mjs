import path from 'node:path';
import * as hil from './org-hil.mjs';

// Shared helpers for the org dashboard routes (routes-org*.mjs).

/** listApprovals for read-only views, where an unreadable file shows as none. */
export function approvalsOrEmpty(orgsDir, orgName) {
  try {
    return hil.listApprovals(path.dirname(path.dirname(orgsDir)), orgName);
  } catch (_) {
    return [];
  }
}

export const validOrgName = (n) => typeof n === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(n);

/** Project root for a HIL route: ?dir= or the server's project. */
export function hilRoot(req, ctx) {
  const dir = new URL(req.url, 'http://localhost').searchParams.get('dir');
  return path.resolve(dir || ctx.projectDir || process.cwd());
}

const HIL_BODY_MAX = 65536;

/** Request body as a string, at most `max` bytes. An oversized body throws 413
 *  and an aborted upload 400 (status on the error), instead of an unhandled
 *  rejection that would take the dashboard process down. Past the cap it keeps
 *  draining (without keeping) so the 413 still reaches the client — leaving
 *  the iterator early destroys the socket. Bytes are decoded once at the end,
 *  so a character split across chunks survives. */
export async function readRawBody(req, max = HIL_BODY_MAX) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= max) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch (err) {
    throw Object.assign(new Error(`request body not received: ${err.message}`), { status: 400 });
  }
  if (size > max)
    throw Object.assign(new Error(`request body is over ${Math.round(max / 1024)}KB`), {
      status: 413,
    });
  return Buffer.concat(chunks).toString('utf8');
}

/** readRawBody for routes that answer on their own: the body, or null after
 *  replying 400/413 (the caller just returns). */
export async function readBodyOrReply(req, res, max, corsOrigin) {
  try {
    return await readRawBody(req, max);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(err.status || 400, {
        'Content-Type': 'application/json',
        ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      });
    }
    res.end(JSON.stringify({ ok: false, error: err.message }));
    return null;
  }
}

/** JSON body (≤64KB); null when malformed. Call inside hilRespond: an
 *  oversized body throws 413 and an aborted upload 400, instead of an
 *  unhandled rejection that would take the dashboard process down. */
export async function readHilBody(req) {
  const text = await readRawBody(req, HIL_BODY_MAX);
  try {
    return JSON.parse(text || '{}');
  } catch (_) {
    return null;
  }
}

/** decodeURIComponent for a path segment; a malformed escape is a 400. */
export function decodeHilSegment(seg) {
  try {
    return decodeURIComponent(seg);
  } catch (_) {
    throw Object.assign(new Error(`malformed path segment: ${seg}`), { status: 400 });
  }
}

/** Run `fn` and answer with its JSON result, or the HIL error's status. */
export async function hilRespond(res, corsOrigin, fn) {
  const cors = corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {};
  try {
    const data = await fn();
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify(data));
  } catch (err) {
    const { status, error } = err.status
      ? { status: err.status, error: err.message }
      : hil.hilErrorStatus(err);
    res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: false, error }));
  }
  return true;
}

/** Record a human decision in the dashboard's event log and push it to live views. */
export function hilEvent(ctx, root, ev) {
  const event = { ...ev, resolvedBy: hil.DASHBOARD_RESOLVER, ts: Date.now() };
  ctx
    .appendToFile(path.join(root, 'data', 'mastermind-events.jsonl'), `${JSON.stringify(event)}\n`)
    .catch(() => {});
  ctx.broadcastMm(event);
}

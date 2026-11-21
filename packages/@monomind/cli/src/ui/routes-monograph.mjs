import { handleMonographBuildRoutes } from './routes-monograph-build.mjs';
import { handleMonographHtmlRoutes } from './routes-monograph-html.mjs';
import { handleMonographQueryRoutes } from './routes-monograph-query.mjs';
import { handleMonographWatchRoutes } from './routes-monograph-watch.mjs';

export async function handleMonographRoutes(req, res, url, corsOrigin, ctx) {
  if (await handleMonographHtmlRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleMonographBuildRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleMonographQueryRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleMonographWatchRoutes(req, res, url, corsOrigin, ctx)) return true;
  return false;
}

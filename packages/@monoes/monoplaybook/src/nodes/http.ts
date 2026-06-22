// HTTP request node handler — ported from internal/nodes/http/request.go
// Type: "http.request"
// Supports: GET/POST/etc., auth (none/bearer/basic/api_key), body (json/form/text),
//           pagination (offset), response format (json/text/binary)
import type { NodeHandler, Item } from '../engine/index.js';

interface RequestConfig {
  method: string;
  url: string;
  timeoutSeconds: number;
  followRedirects: boolean;
  responseFormat: string;
  bodyType: string;
  authType: string;
  paginationType: string;
  pageSize: number;
  pageField: string;
  queryParams: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  authToken: string;
  authUsername: string;
  authPassword: string;
  authApiKeyIn: string;
  authApiKeyName: string;
  authApiKeyValue: string;
}

function parseConfig(config: Record<string, unknown>): RequestConfig {
  return {
    method: String(config['method'] ?? 'GET').toUpperCase(),
    url: String(config['url'] ?? ''),
    timeoutSeconds: Number(config['timeout_seconds'] ?? 30),
    followRedirects: config['follow_redirects'] !== false,
    responseFormat: String(config['response_format'] ?? 'json'),
    bodyType: String(config['body_type'] ?? 'none'),
    authType: String(config['auth_type'] ?? 'none'),
    paginationType: String(config['pagination_type'] ?? 'none'),
    pageSize: Number(config['page_size'] ?? 100),
    pageField: String(config['page_field'] ?? 'page'),
    queryParams: (config['query_params'] as Record<string, string>) ?? {},
    headers: (config['headers'] as Record<string, string>) ?? {},
    body: config['body'],
    authToken: String(config['auth_token'] ?? ''),
    authUsername: String(config['auth_username'] ?? ''),
    authPassword: String(config['auth_password'] ?? ''),
    authApiKeyIn: String(config['auth_api_key_in'] ?? 'header'),
    authApiKeyName: String(config['auth_api_key_name'] ?? ''),
    authApiKeyValue: String(config['auth_api_key_value'] ?? ''),
  };
}

function buildUrl(rawUrl: string, cfg: RequestConfig, page: number): string {
  const u = new URL(rawUrl);
  for (const [k, v] of Object.entries(cfg.queryParams)) u.searchParams.set(k, String(v));
  if (cfg.authType === 'api_key' && cfg.authApiKeyIn === 'query' && cfg.authApiKeyName) {
    u.searchParams.set(cfg.authApiKeyName, cfg.authApiKeyValue);
  }
  if (page >= 0) {
    u.searchParams.set(cfg.pageField, String(page));
    u.searchParams.set('per_page', String(cfg.pageSize));
  }
  return u.toString();
}

function buildBody(cfg: RequestConfig): { body: string | undefined; contentType: string } {
  if (cfg.bodyType === 'none' || cfg.body === undefined || cfg.body === null) {
    return { body: undefined, contentType: '' };
  }
  if (cfg.bodyType === 'json') {
    const str = typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body);
    return { body: str, contentType: 'application/json' };
  }
  if (cfg.bodyType === 'form') {
    if (typeof cfg.body === 'object' && cfg.body !== null) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(cfg.body as Record<string, unknown>)) {
        params.set(k, String(v));
      }
      return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' };
    }
    return { body: String(cfg.body), contentType: 'application/x-www-form-urlencoded' };
  }
  if (cfg.bodyType === 'text') {
    return { body: typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body), contentType: 'text/plain' };
  }
  return { body: undefined, contentType: '' };
}

function buildHeaders(cfg: RequestConfig, contentType: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  Object.assign(headers, cfg.headers);
  if (cfg.authType === 'bearer' && cfg.authToken) {
    headers['Authorization'] = `Bearer ${cfg.authToken}`;
  } else if (cfg.authType === 'basic') {
    const cred = Buffer.from(`${cfg.authUsername}:${cfg.authPassword}`).toString('base64');
    headers['Authorization'] = `Basic ${cred}`;
  } else if (cfg.authType === 'api_key' && cfg.authApiKeyIn === 'header' && cfg.authApiKeyName) {
    headers[cfg.authApiKeyName] = cfg.authApiKeyValue;
  }
  return headers;
}

async function executeRequest(
  cfg: RequestConfig,
  page: number,
): Promise<{ item?: Item; error?: Item }> {
  const url = buildUrl(cfg.url, cfg, page);
  const { body, contentType } = buildBody(cfg);
  const headers = buildHeaders(cfg, contentType);

  let res: Response;
  try {
    res = await fetch(url, {
      method: cfg.method,
      headers,
      body: ['GET', 'HEAD'].includes(cfg.method) ? undefined : body,
      redirect: cfg.followRedirects ? 'follow' : 'manual',
      signal: AbortSignal.timeout(cfg.timeoutSeconds * 1000),
    });
  } catch (err) {
    return { error: { data: { error: String(err), url } } };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);

  const respHeaders: Record<string, unknown> = {};
  res.headers.forEach((val, key) => { respHeaders[key] = val; });

  let parsedBody: unknown;
  if (cfg.responseFormat === 'json') {
    try { parsedBody = JSON.parse(text); } catch { parsedBody = text; }
  } else if (cfg.responseFormat === 'binary') {
    parsedBody = Buffer.from(bytes).toString('base64');
  } else {
    parsedBody = text;
  }

  const resultItem: Item = { data: { status: res.status, headers: respHeaders, body: parsedBody } };
  if (!res.ok) return { error: resultItem };
  return { item: resultItem };
}

async function executePaginated(cfg: RequestConfig): Promise<{ main: Item[]; errors: Item[] }> {
  const main: Item[] = [];
  const errors: Item[] = [];
  for (let page = 0; ; page++) {
    const { item, error } = await executeRequest(cfg, page);
    if (error) { errors.push(error); break; }
    if (!item) break;
    const bodyVal = item.data['body'];
    if (Array.isArray(bodyVal)) {
      if (!bodyVal.length) break;
      for (const elem of bodyVal) {
        const m = (elem !== null && typeof elem === 'object') ? elem as Record<string, unknown> : { value: elem };
        main.push({ data: m });
      }
      if (bodyVal.length < cfg.pageSize) break;
    } else {
      main.push(item);
      break;
    }
  }
  return { main, errors };
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const cfg = parseConfig(config);
  if (!cfg.url) throw new Error('http.request: url is required');

  const inputItems = items.length ? items : [{ data: {} }];
  const mainItems: Item[] = [];
  const errorItems: Item[] = [];

  for (const _inputItem of inputItems) {
    if (cfg.paginationType === 'offset') {
      const { main, errors } = await executePaginated(cfg);
      mainItems.push(...main);
      errorItems.push(...errors);
    } else {
      const { item, error } = await executeRequest(cfg, -1);
      if (error) errorItems.push(error);
      else if (item) mainItems.push(item);
    }
  }

  // Combine main items; errors are included at end with __error marker
  return [
    ...mainItems,
    ...errorItems.map(e => ({ ...e, data: { ...e.data, __error: true } })),
  ];
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('http.request', handler);
}

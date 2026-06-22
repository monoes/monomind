// Notion node handler — ported from internal/nodes/service/notion.go
// Operations: get_page, create_page, update_page, query_database, get_database, create_database, append_blocks
import type { NodeHandler, Item } from '../engine/index.js';

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

async function notionRequest(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    Accept: 'application/json',
  };
  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body: bodyStr });
  const text = await res.text();
  if (!res.ok) throw new Error(`notion HTTP ${res.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function resultsToItems(list: unknown[]): Item[] {
  return list.map(elem => {
    if (elem !== null && typeof elem === 'object') return { data: elem as Record<string, unknown> };
    return { data: { value: elem } };
  });
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const token = String(config['token'] ?? '');
  if (!token) throw new Error('service.notion: token is required');

  const operation = String(config['operation'] ?? 'query_database');

  switch (operation) {
    case 'get_page': {
      const pageId = String(config['page_id'] ?? '');
      if (!pageId) throw new Error('service.notion: page_id required for get_page');
      const data = await notionRequest('GET', `${NOTION_BASE}/pages/${pageId}`, token);
      return [{ data }];
    }

    case 'create_page': {
      const parentId = String(config['parent_id'] ?? config['database_id'] ?? '');
      if (!parentId) throw new Error('service.notion: parent_id required for create_page');
      const body: Record<string, unknown> = {
        parent: { database_id: parentId },
        properties: (config['properties'] as Record<string, unknown>) ?? {},
      };
      const children = config['children'];
      if (Array.isArray(children) && children.length) body['children'] = children;
      const data = await notionRequest('POST', `${NOTION_BASE}/pages`, token, body);
      return [{ data }];
    }

    case 'update_page': {
      const pageId = String(config['page_id'] ?? '');
      if (!pageId) throw new Error('service.notion: page_id required for update_page');
      const data = await notionRequest('PATCH', `${NOTION_BASE}/pages/${pageId}`, token, {
        properties: (config['properties'] as Record<string, unknown>) ?? {},
      });
      return [{ data }];
    }

    case 'query_database': {
      const dbId = String(config['database_id'] ?? '');
      if (!dbId) throw new Error('service.notion: database_id required for query_database');
      const body: Record<string, unknown> = {};
      if (config['filter']) body['filter'] = config['filter'];
      if (Array.isArray(config['sorts']) && (config['sorts'] as unknown[]).length) body['sorts'] = config['sorts'];
      const pageSize = Number(config['page_size'] ?? 0);
      if (pageSize > 0) body['page_size'] = pageSize;
      const data = await notionRequest('POST', `${NOTION_BASE}/databases/${dbId}/query`, token, body);
      const results = (data['results'] as unknown[]) ?? [];
      return resultsToItems(results);
    }

    case 'get_database': {
      const dbId = String(config['database_id'] ?? '');
      if (!dbId) throw new Error('service.notion: database_id required for get_database');
      const data = await notionRequest('GET', `${NOTION_BASE}/databases/${dbId}`, token);
      return [{ data }];
    }

    case 'create_database': {
      const parentId = String(config['parent_id'] ?? '');
      if (!parentId) throw new Error('service.notion: parent_id required for create_database');
      const data = await notionRequest('POST', `${NOTION_BASE}/databases`, token, {
        parent: { page_id: parentId },
        properties: (config['properties'] as Record<string, unknown>) ?? {},
      });
      return [{ data }];
    }

    case 'append_blocks': {
      const pageId = String(config['page_id'] ?? '');
      if (!pageId) throw new Error('service.notion: page_id required for append_blocks');
      const children = config['children'];
      if (!Array.isArray(children) || !children.length) throw new Error('service.notion: children required for append_blocks');
      const data = await notionRequest('PATCH', `${NOTION_BASE}/blocks/${pageId}/children`, token, { children });
      return [{ data }];
    }

    default:
      throw new Error(`service.notion: unknown operation "${operation}"`);
  }
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('service.notion', handler);
}

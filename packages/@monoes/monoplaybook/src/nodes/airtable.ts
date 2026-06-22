// Airtable node handler — ported from internal/nodes/service/airtable.go
// Operations: list_records, get_record, create_record, update_record, delete_record
import type { NodeHandler, Item } from '../engine/index.js';

const AIRTABLE_BASE = 'https://api.airtable.com/v0';

async function airtableRequest(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body: bodyStr });
  const text = await res.text();
  if (!res.ok) throw new Error(`airtable HTTP ${res.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function recordsToItems(records: unknown[]): Item[] {
  return records.map(r => {
    const rec = r as Record<string, unknown>;
    return { data: { id: rec['id'], ...(rec['fields'] as Record<string, unknown>) } };
  });
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const token = String(config['token'] ?? '');
  if (!token) throw new Error('service.airtable: token is required');
  const baseId = String(config['base_id'] ?? '');
  if (!baseId) throw new Error('service.airtable: base_id is required');
  const table = encodeURIComponent(String(config['table'] ?? ''));
  if (!table) throw new Error('service.airtable: table is required');

  const operation = String(config['operation'] ?? 'list_records');
  const baseUrl = `${AIRTABLE_BASE}/${baseId}/${table}`;

  switch (operation) {
    case 'list_records': {
      let url = baseUrl;
      const params: string[] = [];
      if (config['filter_formula']) params.push(`filterByFormula=${encodeURIComponent(String(config['filter_formula']))}`);
      if (config['max_records']) params.push(`maxRecords=${Number(config['max_records'])}`);
      if (config['view']) params.push(`view=${encodeURIComponent(String(config['view']))}`);
      if (params.length) url += '?' + params.join('&');
      const data = await airtableRequest('GET', url, token);
      return recordsToItems((data['records'] as unknown[]) ?? []);
    }

    case 'get_record': {
      const recordId = String(config['record_id'] ?? '');
      if (!recordId) throw new Error('service.airtable: record_id required for get_record');
      const data = await airtableRequest('GET', `${baseUrl}/${recordId}`, token);
      return recordsToItems([data]);
    }

    case 'create_record': {
      const fields = (config['fields'] as Record<string, unknown>) ?? {};
      const data = await airtableRequest('POST', baseUrl, token, { fields });
      return recordsToItems([data]);
    }

    case 'update_record': {
      const recordId = String(config['record_id'] ?? '');
      if (!recordId) throw new Error('service.airtable: record_id required for update_record');
      const fields = (config['fields'] as Record<string, unknown>) ?? {};
      const data = await airtableRequest('PATCH', `${baseUrl}/${recordId}`, token, { fields });
      return recordsToItems([data]);
    }

    case 'delete_record': {
      const recordId = String(config['record_id'] ?? '');
      if (!recordId) throw new Error('service.airtable: record_id required for delete_record');
      const data = await airtableRequest('DELETE', `${baseUrl}/${recordId}`, token);
      return [{ data }];
    }

    default:
      throw new Error(`service.airtable: unknown operation "${operation}"`);
  }
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('service.airtable', handler);
}

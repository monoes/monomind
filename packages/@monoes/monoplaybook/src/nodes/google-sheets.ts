// Google Sheets node handler — ported from internal/nodes/service/google_sheets.go
// Operations: read_rows, append_rows, update_rows, clear_range, create_spreadsheet
import type { NodeHandler, Item } from '@monoes/monobrowse';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function sheetsRequest(
  method: string,
  url: string,
  accessToken: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  let bodyStr: string | undefined;
  if (body !== undefined) {
    bodyStr = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body: bodyStr });
  const text = await res.text();
  if (!res.ok) throw new Error(`google_sheets HTTP ${res.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

async function createSpreadsheet(accessToken: string, title: string): Promise<Record<string, unknown>> {
  return sheetsRequest('POST', `${SHEETS_BASE}`, accessToken, { properties: { title } });
}

function encodeRange(r: string): string {
  return r.replace(/ /g, '%20');
}

function columnLetter(idx: number): string {
  let result = '';
  idx++;
  while (idx > 0) {
    idx--;
    result = String.fromCharCode(65 + (idx % 26)) + result;
    idx = Math.floor(idx / 26);
  }
  return result;
}

function valuesToItems(values: unknown[], useHeaderRow: boolean): Item[] {
  if (!values.length) return [];
  let headers: string[] = [];
  let startRow = 0;
  if (useHeaderRow) {
    const headerRow = values[0] as unknown[];
    if (Array.isArray(headerRow)) {
      headers = headerRow.map(h => String(h));
      startRow = 1;
    }
  }
  const result: Item[] = [];
  for (let i = startRow; i < values.length; i++) {
    const row = values[i] as unknown[];
    if (!Array.isArray(row)) continue;
    const data: Record<string, unknown> = {};
    for (let j = 0; j < row.length; j++) {
      const key = useHeaderRow && j < headers.length ? headers[j] : columnLetter(j);
      data[key] = row[j];
    }
    const rowNum = i + 1;
    data['_row_index'] = rowNum;
    data['_row_range'] = `A${rowNum}:${columnLetter(Math.max(row.length, 1) - 1)}${rowNum}`;
    result.push({ data });
  }
  return result;
}

function itemsToRows(items: Item[], withHeader: boolean): unknown[][] {
  if (!items.length) return [];
  const keySet = new Set<string>();
  for (const item of items) { for (const k of Object.keys(item.data)) keySet.add(k); }
  const keys = Array.from(keySet).sort();
  const rows: unknown[][] = [];
  if (withHeader) rows.push(keys);
  for (const item of items) {
    rows.push(keys.map(k => item.data[k] !== undefined ? String(item.data[k]) : ''));
  }
  return rows;
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const accessToken = String(config['access_token'] ?? '');
  if (!accessToken) throw new Error('google_sheets: access_token is required');

  const operation = String(config['operation'] ?? 'append_rows');

  if (operation === 'create_spreadsheet') {
    const title = String(config['title'] ?? 'Monoplaybook Export');
    const data = await createSpreadsheet(accessToken, title);
    return [{ data }];
  }

  // Resolve spreadsheet ID — create if "new" or empty
  let spreadsheetId = String(config['spreadsheet_id'] ?? '');
  if (!spreadsheetId || spreadsheetId === 'new') {
    const title = String(config['title'] ?? 'Monoplaybook Export');
    const meta = await createSpreadsheet(accessToken, title);
    spreadsheetId = String(meta['spreadsheetId'] ?? '');
    if (!spreadsheetId) throw new Error('google_sheets: could not determine spreadsheetId from create response');
  }

  const sheet = String(config['sheet_name'] ?? config['sheet'] ?? 'Sheet1');
  const rawRange = config['range'] ? `${sheet}!${String(config['range'])}` : sheet;
  const valueInputOption = String(config['value_input_option'] ?? 'RAW');
  const useHeaderRow = Boolean(config['use_header_row']);
  const baseURL = `${SHEETS_BASE}/${spreadsheetId}`;

  switch (operation) {
    case 'read_rows': {
      const data = await sheetsRequest('GET', `${baseURL}/values/${encodeRange(rawRange)}`, accessToken);
      const values = (data['values'] as unknown[]) ?? [];
      return valuesToItems(values, useHeaderRow);
    }

    case 'append_rows': {
      let values = (config['values'] as unknown[][] | undefined);
      if (!values && items.length) {
        values = itemsToRows(items, true);
      }
      values = values ?? [];
      const url = `${baseURL}/values/${encodeRange(rawRange)}:append?valueInputOption=${valueInputOption}`;
      const resp = await sheetsRequest('POST', url, accessToken, { values });
      return [{ data: { spreadsheet_id: spreadsheetId, rows_written: values.length, response: resp } }];
    }

    case 'update_rows': {
      if (rawRange.includes('<no value>')) {
        throw new Error(`google_sheets update_rows: range "${rawRange}" contains unresolved template variable`);
      }
      const values = (config['values'] as unknown[][] | undefined) ?? [];
      const url = `${baseURL}/values/${encodeRange(rawRange)}?valueInputOption=${valueInputOption}`;
      const resp = await sheetsRequest('PUT', url, accessToken, { range: rawRange, values });
      const merged: Record<string, unknown> = {};
      if (items.length) Object.assign(merged, items[0].data);
      Object.assign(merged, resp);
      return [{ data: merged }];
    }

    case 'clear_range': {
      const resp = await sheetsRequest('POST', `${baseURL}/values/${encodeRange(rawRange)}:clear`, accessToken, {});
      return [{ data: resp }];
    }

    default:
      throw new Error(`google_sheets: unknown operation "${operation}"`);
  }
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('service.google_sheets', handler);
}

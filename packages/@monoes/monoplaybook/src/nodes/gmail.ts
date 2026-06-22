// Gmail node handler — ported from internal/nodes/service/gmail.go
// Operations: list_messages, get_message, send_message, list_labels, trash_message
import type { NodeHandler, Item } from '@monoes/monobrowse';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailRequest(
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
  if (!res.ok) throw new Error(`gmail HTTP ${res.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

/** Build an RFC 2822 message and base64url-encode it for the Gmail API. */
function buildRFC2822(from: string, to: string, subject: string, body: string, bodyType: string): string {
  const contentType = bodyType === 'html' ? 'text/html' : 'text/plain';
  const parts: string[] = [];
  if (from) parts.push(`From: ${from}`);
  if (to) parts.push(`To: ${to}`);
  if (subject) parts.push(`Subject: ${subject}`);
  parts.push('MIME-Version: 1.0');
  parts.push(`Content-Type: ${contentType}; charset="UTF-8"`);
  parts.push('');
  parts.push(body);
  const raw = parts.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const accessToken = String(config['access_token'] ?? '');
  if (!accessToken) throw new Error('gmail: access_token is required');

  const operation = String(config['operation'] ?? 'list_messages');
  const maxResults = Number(config['max_results'] ?? 10);

  switch (operation) {
    case 'list_messages': {
      let url = `${GMAIL_BASE}/messages?maxResults=${maxResults}`;
      if (config['query']) url += `&q=${encodeURIComponent(String(config['query']))}`;
      const labelIds = config['label_ids'];
      if (Array.isArray(labelIds)) {
        for (const lid of labelIds) url += `&labelIds=${encodeURIComponent(String(lid))}`;
      }
      const data = await gmailRequest('GET', url, accessToken);
      const messages = (data['messages'] as unknown[]) ?? [];
      return messages.map(m => ({ data: m as Record<string, unknown> }));
    }

    case 'get_message': {
      const messageId = String(config['message_id'] ?? '');
      if (!messageId) throw new Error('gmail: message_id required for get_message');
      const data = await gmailRequest('GET', `${GMAIL_BASE}/messages/${messageId}`, accessToken);
      return [{ data }];
    }

    case 'send_message': {
      const from = String(config['from'] ?? '');
      const to = String(config['to'] ?? '');
      const subject = String(config['subject'] ?? '');
      const body = String(config['body'] ?? '');
      const bodyType = String(config['body_type'] ?? 'text');
      const raw = buildRFC2822(from, to, subject, body, bodyType);
      const resp = await gmailRequest('POST', `${GMAIL_BASE}/messages/send`, accessToken, { raw });
      return [{ data: resp }];
    }

    case 'list_labels': {
      const data = await gmailRequest('GET', `${GMAIL_BASE}/labels`, accessToken);
      const labels = (data['labels'] as unknown[]) ?? [];
      return labels.map(l => ({ data: l as Record<string, unknown> }));
    }

    case 'trash_message': {
      const messageId = String(config['message_id'] ?? '');
      if (!messageId) throw new Error('gmail: message_id required for trash_message');
      const data = await gmailRequest('POST', `${GMAIL_BASE}/messages/${messageId}/trash`, accessToken);
      return [{ data }];
    }

    default:
      throw new Error(`gmail: unknown operation "${operation}"`);
  }
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('service.gmail', handler);
}

// Comm node handlers — Slack, Discord, email (SMTP/SendGrid), Telegram, Twilio.
// No external npm dependencies — uses only Node.js built-ins and the global fetch API.
import type { NodeHandler, Item } from '../engine/index.js';
import * as net from 'node:net';

// ── helpers ───────────────────────────────────────────────────────────────────

function getStr(config: Record<string, unknown>, key: string, fallback = ''): string {
  return String(config[key] ?? fallback);
}

function errItem(msg: string, extra?: Record<string, unknown>): Item {
  return { data: { ok: false, error: msg, ...extra } };
}

// ── comm.slack ────────────────────────────────────────────────────────────────

const slackHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const token = getStr(config, 'token') || process.env['SLACK_TOKEN'] || '';
  if (!token) throw new Error('comm.slack: token is required (config.token or $SLACK_TOKEN)');

  const operation = getStr(config, 'operation', 'send_message');

  async function slackRequest(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const method = body ? 'POST' : 'GET';
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };
    const res = await fetch(`https://slack.com/api/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return JSON.parse(text) as Record<string, unknown>;
  }

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const item of inputItems) {
    try {
      if (operation === 'send_message') {
        const channelId = getStr(config, 'channel_id') || String(item.data['channel_id'] ?? '');
        const text = getStr(config, 'text') || String(item.data['text'] ?? '');
        const resp = await slackRequest('chat.postMessage', { channel: channelId, text });
        results.push({
          data: {
            ok: resp['ok'] === true,
            ts: resp['ts'],
            channel: resp['channel'],
            message: resp['message'],
            error: resp['error'],
          },
        });
      } else if (operation === 'list_channels') {
        const resp = await slackRequest('conversations.list');
        const channels = (resp['channels'] as unknown[]) ?? [];
        for (const ch of channels) {
          results.push({ data: ch as Record<string, unknown> });
        }
      } else if (operation === 'get_channel') {
        const channelId = getStr(config, 'channel_id') || String(item.data['channel_id'] ?? '');
        const resp = await slackRequest(`conversations.info?channel=${encodeURIComponent(channelId)}`);
        results.push({ data: { ok: resp['ok'], channel: resp['channel'] } });
      } else {
        results.push(errItem(`comm.slack: unknown operation "${operation}"`));
      }
    } catch (err) {
      results.push(errItem(String(err)));
    }
  }
  return results;
};

// ── comm.discord ──────────────────────────────────────────────────────────────

const discordHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const webhookUrl = getStr(config, 'webhook_url') || String(items[0]?.data['webhook_url'] ?? '');
  if (!webhookUrl) throw new Error('comm.discord: webhook_url is required');

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const item of inputItems) {
    const message = getStr(config, 'message') || String(item.data['message'] ?? '');
    const username = getStr(config, 'username') || String(item.data['username'] ?? '');

    const body: Record<string, string> = { content: message };
    if (username) body['username'] = username;

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Discord webhook returns 204 No Content on success
      results.push({ data: { ok: res.status === 204 || res.ok, status: res.status } });
    } catch (err) {
      results.push(errItem(String(err)));
    }
  }
  return results;
};

// ── comm.email_send (SMTP via node:net or SendGrid REST) ─────────────────────

function base64Encode(str: string): string {
  return Buffer.from(str).toString('base64');
}

async function sendViaSendGrid(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  html?: string,
): Promise<Item> {
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from },
    subject,
    content: [
      ...(html ? [{ type: 'text/html', value: html }] : []),
      { type: 'text/plain', value: body },
    ],
  };
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return { data: { ok: res.status === 202, status: res.status } };
}

function sendViaSMTP(
  host: string,
  port: number,
  username: string,
  password: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  html?: string,
): Promise<Item> {
  return new Promise((resolve) => {
    const sock = net.createConnection(port, host);
    const lines: string[] = [];
    let step = 0;

    const write = (line: string) => sock.write(line + '\r\n');

    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      html
        ? 'Content-Type: text/html; charset=UTF-8'
        : 'Content-Type: text/plain; charset=UTF-8',
      '',
      html || body,
      '.',
    ].join('\r\n');

    sock.setTimeout(10000);

    sock.on('timeout', () => {
      sock.destroy();
      resolve(errItem('comm.email_send: SMTP connection timed out'));
    });

    sock.on('error', (err) => {
      resolve(errItem(`comm.email_send: SMTP error: ${err.message}`));
    });

    sock.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      lines.push(text);
      const code = parseInt(text.slice(0, 3), 10);

      if (step === 0 && code === 220) {
        step = 1;
        write(`EHLO localhost`);
      } else if (step === 1 && (code === 250 || text.includes('250 '))) {
        if (!text.includes('\n') || text.endsWith('250 \r\n') || text.match(/^250 [A-Z]/m)) {
          step = 2;
          write('AUTH LOGIN');
        }
      } else if (step === 2 && code === 334) {
        step = 3;
        write(base64Encode(username));
      } else if (step === 3 && code === 334) {
        step = 4;
        write(base64Encode(password));
      } else if (step === 4 && code === 235) {
        step = 5;
        write(`MAIL FROM:<${from}>`);
      } else if (step === 5 && code === 250) {
        step = 6;
        write(`RCPT TO:<${to}>`);
      } else if (step === 6 && code === 250) {
        step = 7;
        write('DATA');
      } else if (step === 7 && code === 354) {
        step = 8;
        write(message);
      } else if (step === 8 && code === 250) {
        step = 9;
        write('QUIT');
        sock.end();
        resolve({ data: { ok: true } });
      } else if (code >= 400) {
        sock.destroy();
        resolve(errItem(`comm.email_send: SMTP ${code}: ${text.trim()}`));
      }
    });
  });
}

const emailHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const sendgridKey = getStr(config, 'sendgrid_api_key') || process.env['SENDGRID_API_KEY'] || '';
  const smtpHost = getStr(config, 'smtp_host') || process.env['SMTP_HOST'] || '';

  const from = getStr(config, 'from');
  const to = getStr(config, 'to');
  const subject = getStr(config, 'subject');
  const body = getStr(config, 'body');
  const html = getStr(config, 'html') || undefined;

  if (!from || !to) throw new Error('comm.email_send: from and to are required');

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const _item of inputItems) {
    try {
      if (sendgridKey) {
        results.push(await sendViaSendGrid(sendgridKey, from, to, subject, body, html));
      } else if (smtpHost) {
        const smtpPort = Number(config['smtp_port'] ?? process.env['SMTP_PORT'] ?? 587);
        const username = getStr(config, 'username') || process.env['SMTP_USERNAME'] || '';
        const password = getStr(config, 'password') || process.env['SMTP_PASSWORD'] || '';
        results.push(await sendViaSMTP(smtpHost, smtpPort, username, password, from, to, subject, body, html));
      } else {
        results.push(errItem(
          'comm.email_send: no mail provider configured. Set SENDGRID_API_KEY or SMTP_HOST environment variable.',
        ));
      }
    } catch (err) {
      results.push(errItem(String(err)));
    }
  }
  return results;
};

// ── comm.telegram ─────────────────────────────────────────────────────────────

const telegramHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const botToken = getStr(config, 'bot_token') || process.env['TELEGRAM_BOT_TOKEN'] || '';
  if (!botToken) throw new Error('comm.telegram: bot_token is required');

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const item of inputItems) {
    const chatId = getStr(config, 'chat_id') || String(item.data['chat_id'] ?? '');
    const text = getStr(config, 'text') || String(item.data['text'] ?? '');
    if (!chatId) { results.push(errItem('comm.telegram: chat_id is required')); continue; }

    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      const json = await res.json() as Record<string, unknown>;
      results.push({ data: { ok: json['ok'] === true, result: json['result'], error: json['description'] } });
    } catch (err) {
      results.push(errItem(String(err)));
    }
  }
  return results;
};

// ── comm.twilio ───────────────────────────────────────────────────────────────

const twilioHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const accountSid = getStr(config, 'account_sid') || process.env['TWILIO_ACCOUNT_SID'] || '';
  const authToken = getStr(config, 'auth_token') || process.env['TWILIO_AUTH_TOKEN'] || '';
  if (!accountSid || !authToken) throw new Error('comm.twilio: account_sid and auth_token are required');

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const item of inputItems) {
    const from = getStr(config, 'from') || String(item.data['from'] ?? '');
    const to = getStr(config, 'to') || String(item.data['to'] ?? '');
    const body = getStr(config, 'body') || String(item.data['body'] ?? '');
    if (!from || !to) { results.push(errItem('comm.twilio: from and to are required')); continue; }

    try {
      const params = new URLSearchParams({ From: from, To: to, Body: body });
      const credentials = base64Encode(`${accountSid}:${authToken}`);
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        },
      );
      const json = await res.json() as Record<string, unknown>;
      results.push({
        data: {
          ok: res.ok,
          sid: json['sid'],
          status: json['status'],
          error: json['message'],
        },
      });
    } catch (err) {
      results.push(errItem(String(err)));
    }
  }
  return results;
};

// ── register ──────────────────────────────────────────────────────────────────

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('comm.slack', slackHandler);
  handlers.set('comm.discord', discordHandler);
  handlers.set('comm.email_send', emailHandler);
  handlers.set('comm.telegram', telegramHandler);
  handlers.set('comm.twilio', twilioHandler);
}

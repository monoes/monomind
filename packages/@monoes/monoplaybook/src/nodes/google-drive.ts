// Google Drive node handler — ported from internal/nodes/service/google_drive.go
// Operations: list_files, get_file, upload_file, download_file, create_folder, delete_file, share_file
import type { NodeHandler, Item } from '../engine/index.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function driveRequest(
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
  if (!res.ok) throw new Error(`google_drive HTTP ${res.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

async function driveDownload(url: string, accessToken: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`google_drive download HTTP ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function driveUpload(
  accessToken: string,
  filePath: string,
  fileName: string,
  mimeType: string,
  parentFolderId?: string,
): Promise<Record<string, unknown>> {
  const fileContent = await readFile(filePath);
  const meta: Record<string, unknown> = { name: fileName };
  if (parentFolderId) meta['parents'] = [parentFolderId];

  const boundary = `drive_boundary_${Date.now()}`;
  const metaPart = JSON.stringify(meta);
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metaPart,
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join('\r\n');

  // Use multipart upload
  const formData = new FormData();
  formData.append('metadata', new Blob([metaPart], { type: 'application/json' }));
  formData.append('file', new Blob([fileContent], { type: mimeType }), fileName);

  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`google_drive upload HTTP ${res.status}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

const handler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const accessToken = String(config['access_token'] ?? '');
  if (!accessToken) throw new Error('google_drive: access_token is required');

  const operation = String(config['operation'] ?? 'list_files');
  const pageSize = Number(config['page_size'] ?? 10);

  switch (operation) {
    case 'list_files': {
      let url = `${DRIVE_BASE}/files?pageSize=${pageSize}&fields=files(id,name,mimeType,size,createdTime,modifiedTime,parents)`;
      const query = config['query'] ? encodeURIComponent(String(config['query'])) : '';
      if (query) url += `&q=${query}`;
      const data = await driveRequest('GET', url, accessToken);
      const files = (data['files'] as unknown[]) ?? [];
      return files.map(f => ({ data: f as Record<string, unknown> }));
    }

    case 'get_file': {
      const fileId = String(config['file_id'] ?? '');
      if (!fileId) throw new Error('google_drive: file_id required for get_file');
      const url = `${DRIVE_BASE}/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink`;
      const data = await driveRequest('GET', url, accessToken);
      return [{ data }];
    }

    case 'upload_file': {
      const filePath = String(config['file_path'] ?? '');
      if (!filePath) throw new Error('google_drive: file_path required for upload_file');
      const fileName = String(config['file_name'] ?? basename(filePath));
      const mimeType = String(config['mime_type'] ?? 'application/octet-stream');
      const parentFolderId = config['parent_folder_id'] ? String(config['parent_folder_id']) : undefined;
      const data = await driveUpload(accessToken, filePath, fileName, mimeType, parentFolderId);
      return items.map(item => ({ ...item, data: { ...item.data, ...data } }));
    }

    case 'download_file': {
      const fileId = String(config['file_id'] ?? '');
      if (!fileId) throw new Error('google_drive: file_id required for download_file');
      const url = `${DRIVE_BASE}/files/${fileId}?alt=media`;
      const bytes = await driveDownload(url, accessToken);
      const b64 = Buffer.from(bytes).toString('base64');
      return [{ data: { file_id: fileId }, binaryBase64: b64 }];
    }

    case 'create_folder': {
      const folderName = String(config['file_name'] ?? '');
      if (!folderName) throw new Error('google_drive: file_name required for create_folder');
      const meta: Record<string, unknown> = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
      if (config['parent_folder_id']) meta['parents'] = [String(config['parent_folder_id'])];
      const data = await driveRequest('POST', `${DRIVE_BASE}/files`, accessToken, meta);
      return [{ data }];
    }

    case 'delete_file': {
      const fileId = String(config['file_id'] ?? '');
      if (!fileId) throw new Error('google_drive: file_id required for delete_file');
      await driveRequest('DELETE', `${DRIVE_BASE}/files/${fileId}`, accessToken);
      return [{ data: { file_id: fileId, deleted: true } }];
    }

    case 'share_file': {
      const fileId = String(config['file_id'] ?? '');
      if (!fileId) throw new Error('google_drive: file_id required for share_file');
      const permission = { role: 'reader', type: 'anyone' };
      const data = await driveRequest('POST', `${DRIVE_BASE}/files/${fileId}/permissions`, accessToken, permission);
      return [{ data }];
    }

    default:
      throw new Error(`google_drive: unknown operation "${operation}"`);
  }
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('service.google_drive', handler);
}

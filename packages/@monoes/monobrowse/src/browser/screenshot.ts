import type { CdpClient } from './cdp.js';
import type { ElementRef } from './types.js';
import { getObjectIdForRef } from './snapshot.js';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

export interface ScreenshotOptions {
  path?: string;
  fullPage?: boolean;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
  annotate?: boolean;
  refs?: Map<string, ElementRef>;
}

async function getViewportTopLeft(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef
): Promise<{ x: number; y: number } | null> {
  const objectId = await getObjectIdForRef(client, sessionId, ref).catch(() => null);
  if (!objectId) return null;
  try {
    const r = await client.send<{ result: { value?: string } }>('Runtime.callFunctionOn', {
      functionDeclaration: 'function() { var r=this.getBoundingClientRect(); if(r.width===0&&r.height===0)return null; return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top)}); }',
      objectId,
      returnByValue: true,
    }, sessionId);
    if (!r.result?.value) return null;
    return JSON.parse(r.result.value) as { x: number; y: number };
  } catch {
    return null;
  }
}

async function injectAnnotationOverlay(
  client: CdpClient,
  sessionId: string,
  refs: Map<string, ElementRef>
): Promise<void> {
  const badges: Array<{ num: number; x: number; y: number }> = [];
  for (const [key, ref] of refs) {
    const m = key.match(/^e(\d+)$/);
    if (!m) continue;
    const pos = await getViewportTopLeft(client, sessionId, ref);
    if (pos) badges.push({ num: parseInt(m[1], 10), x: pos.x, y: pos.y });
  }
  if (badges.length === 0) return;

  const badgesJson = JSON.stringify(badges);
  await client.send('Runtime.evaluate', {
    expression: `(function(){
      var p=document.getElementById('__mm_ann__');if(p)p.remove();
      var c=document.createElement('div');
      c.id='__mm_ann__';
      c.style.cssText='position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
      var bs=${badgesJson};
      bs.forEach(function(b){
        var d=document.createElement('div');
        d.style.cssText='position:fixed;left:'+b.x+'px;top:'+b.y+'px;background:#e74c3c;color:#fff;border-radius:3px;padding:0 4px;font-size:11px;font-family:monospace;font-weight:bold;line-height:18px;box-shadow:0 1px 3px rgba(0,0,0,.5);';
        d.textContent=b.num;
        c.appendChild(d);
      });
      document.body.appendChild(c);
    })()`,
    returnByValue: false,
  }, sessionId).catch(() => {});
}

async function removeAnnotationOverlay(client: CdpClient, sessionId: string): Promise<void> {
  await client.send('Runtime.evaluate', {
    expression: `(function(){var e=document.getElementById('__mm_ann__');if(e)e.remove();})()`,
    returnByValue: false,
  }, sessionId).catch(() => {});
}

export async function captureScreenshot(
  client: CdpClient,
  sessionId: string,
  options: ScreenshotOptions = {}
): Promise<{ path: string; dataUrl: string }> {
  const format = options.format ?? 'png';
  const params: Record<string, unknown> = { format };

  if (format === 'jpeg' || format === 'webp') {
    params.quality = options.quality ?? 80;
  }

  if (options.fullPage) {
    const dims = await client.send<{ result: { value: string } }>('Runtime.evaluate', {
      expression: 'JSON.stringify({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})',
      returnByValue: true,
    }, sessionId);
    const { w, h } = JSON.parse(dims.result?.value ?? '{"w":1280,"h":720}');
    params.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
    params.captureBeyondViewport = true;
  }

  if (options.annotate && options.refs) {
    await injectAnnotationOverlay(client, sessionId, options.refs);
  }

  let data: string;
  try {
    const result = await client.send<{ data: string }>('Page.captureScreenshot', params, sessionId);
    data = result.data;
  } finally {
    if (options.annotate) {
      await removeAnnotationOverlay(client, sessionId);
    }
  }

  const dataUrl = `data:image/${format};base64,${data}`;
  const outputPath = options.path ?? join(tmpdir(), `monomind-screenshot-${Date.now()}.${format}`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(data, 'base64'));

  return { path: outputPath, dataUrl };
}

export async function setViewport(
  client: CdpClient,
  sessionId: string,
  width: number,
  height: number
): Promise<void> {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
}

export async function setUserAgent(
  client: CdpClient,
  sessionId: string,
  userAgent: string
): Promise<void> {
  await client.send('Emulation.setUserAgentOverride', { userAgent }, sessionId);
}

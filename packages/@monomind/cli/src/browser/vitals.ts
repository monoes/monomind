import type { CdpClient } from './cdp.js';
import { evaluateJs } from './actions.js';

export interface WebVitals {
  lcp?: number;
  fcp?: number;
  cls?: number;
  ttfb?: number;
  inp?: number;
  domInteractive?: number;
  domContentLoaded?: number;
  loadTime?: number;
  resources?: number;
}

export async function collectVitals(
  client: CdpClient,
  sessionId: string,
  waitMs = 2000
): Promise<WebVitals> {
  // Inject PerformanceObserver collectors and wait for data
  const script = `
    new Promise((resolve) => {
      const vitals = {};

      // Navigation timing
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        vitals.ttfb = nav.responseStart - nav.requestStart;
        vitals.domInteractive = nav.domInteractive;
        vitals.domContentLoaded = nav.domContentLoadedEventEnd;
        vitals.loadTime = nav.loadEventEnd;
        vitals.resources = performance.getEntriesByType('resource').length;
      }

      // FCP via paint entries
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
      if (fcp) vitals.fcp = fcp.startTime;

      // LCP
      let lcpValue = 0;
      let lcpObs;
      try {
        lcpObs = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            lcpValue = entries[entries.length - 1].startTime;
            vitals.lcp = lcpValue;
          }
        });
        lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch(e) {}

      // CLS
      let clsValue = 0;
      let clsObs;
      try {
        clsObs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
          vitals.cls = clsValue;
        });
        clsObs.observe({ type: 'layout-shift', buffered: true });
      } catch(e) {}

      // INP
      let inpValue = 0;
      let inpObs;
      try {
        inpObs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > inpValue) {
              inpValue = entry.duration;
              vitals.inp = inpValue;
            }
          }
        });
        inpObs.observe({ type: 'event', buffered: true, durationThreshold: 40 });
      } catch(e) {}

      setTimeout(() => {
        try { lcpObs?.disconnect(); } catch(e) {}
        try { clsObs?.disconnect(); } catch(e) {}
        try { inpObs?.disconnect(); } catch(e) {}
        resolve(vitals);
      }, ${waitMs});
    })
  `;

  const result = await evaluateJs(client, sessionId, script);
  return (result ?? {}) as WebVitals;
}

export function formatVitals(vitals: WebVitals): string {
  const lines: string[] = [];
  const ms = (v?: number) => v !== undefined ? `${Math.round(v)}ms` : 'n/a';
  const score = (metric: string, v?: number): string => {
    if (v === undefined) return '';
    if (metric === 'lcp') return v < 2500 ? ' ✓ good' : v < 4000 ? ' ~ needs improvement' : ' ✗ poor';
    if (metric === 'fcp') return v < 1800 ? ' ✓ good' : v < 3000 ? ' ~ needs improvement' : ' ✗ poor';
    if (metric === 'cls') return v < 0.1 ? ' ✓ good' : v < 0.25 ? ' ~ needs improvement' : ' ✗ poor';
    if (metric === 'inp') return v < 200 ? ' ✓ good' : v < 500 ? ' ~ needs improvement' : ' ✗ poor';
    if (metric === 'ttfb') return v < 800 ? ' ✓ good' : v < 1800 ? ' ~ needs improvement' : ' ✗ poor';
    return '';
  };

  if (vitals.lcp !== undefined) lines.push(`  LCP  (Largest Contentful Paint):  ${ms(vitals.lcp)}${score('lcp', vitals.lcp)}`);
  if (vitals.fcp !== undefined) lines.push(`  FCP  (First Contentful Paint):     ${ms(vitals.fcp)}${score('fcp', vitals.fcp)}`);
  if (vitals.cls !== undefined) lines.push(`  CLS  (Cumulative Layout Shift):    ${vitals.cls?.toFixed(4)}${score('cls', vitals.cls)}`);
  if (vitals.inp !== undefined) lines.push(`  INP  (Interaction to Next Paint):  ${ms(vitals.inp)}${score('inp', vitals.inp)}`);
  if (vitals.ttfb !== undefined) lines.push(`  TTFB (Time to First Byte):         ${ms(vitals.ttfb)}${score('ttfb', vitals.ttfb)}`);
  if (vitals.domInteractive !== undefined) lines.push(`  DOM Interactive:                   ${ms(vitals.domInteractive)}`);
  if (vitals.domContentLoaded !== undefined) lines.push(`  DOMContentLoaded:                  ${ms(vitals.domContentLoaded)}`);
  if (vitals.loadTime !== undefined) lines.push(`  Load:                              ${ms(vitals.loadTime)}`);
  if (vitals.resources !== undefined) lines.push(`  Resources loaded:                  ${vitals.resources}`);

  return lines.join('\n');
}

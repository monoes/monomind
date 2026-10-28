import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMonographBrief } from '../../mcp-tools/brief.js';
import { buildAsync } from '../../pipeline/orchestrator.js';

describe('getMonographBrief', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'brief-'));
    mkdirSync(join(tmpDir, 'src', '__tests__'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'src', 'billing.ts'),
      "/** Charge a customer's card for an invoice. */\nexport function chargeInvoice(id: string) { return audit(id); }\nfunction audit(id: string) { return id; }\n",
    );
    writeFileSync(
      join(tmpDir, 'src', 'checkout.ts'),
      "import { chargeInvoice } from './billing';\nexport function checkout() { return chargeInvoice('1'); }\n",
    );
    writeFileSync(
      join(tmpDir, 'src', '__tests__', 'billing.test.ts'),
      "import { chargeInvoice } from '../billing';\nexport function testCharge() { return chargeInvoice('2'); }\n",
    );
    writeFileSync(
      join(tmpDir, 'billing.md'),
      '# Billing\n\n## Charging invoices\n\nHow a customer card is charged.\n',
    );
    await buildAsync(tmpDir);
    db = new Database(join(tmpDir, '.monomind', 'monograph.db'), { readonly: true });
  }, 60_000);

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('turns a plain-words task into entry points, docs and blast radius', async () => {
    const brief = await getMonographBrief(db, 'charge a customer card for an invoice');
    const top = brief.entryPoints[0];
    expect(top?.node.name).toBe('chargeInvoice');
    expect(top?.callers.map((c) => c.name)).toContain('checkout');
    expect(top?.callees.map((c) => c.name)).toContain('audit');
    expect(top?.tests).toContain('src/__tests__/billing.test.ts');
    expect(brief.docs.length).toBeGreaterThan(0);
    expect(brief.impact?.name).toBe('chargeInvoice');
    expect(brief.impact?.affectedTests).toContain('src/__tests__/billing.test.ts');
  });

  it('is empty, not an error, when nothing matches', async () => {
    const brief = await getMonographBrief(db, 'zzzzqqqq wwwwxxxx');
    expect(brief.entryPoints).toEqual([]);
    expect(brief.impact).toBeNull();
  });

  it('says nothing is relevant for a concept the code does not have', async () => {
    const brief = await getMonographBrief(db, 'customer loyalty points scheduler');
    expect(brief.relevant).toBe(false);
    expect(brief.entryPoints).toEqual([]);
    expect(brief.docs).toEqual([]);
    expect(brief.impact).toBeNull();
  });

  it('marks a matching task relevant', async () => {
    const brief = await getMonographBrief(db, 'charge a customer card for an invoice');
    expect(brief.relevant).toBe(true);
  });
});

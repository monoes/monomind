/**
 * Security CVE command — NVD/OSV lookups and npm audit vulnerability listing
 */
import { output } from '../output.js';
import { statSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
// ─── CVE helpers ─────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function getCveCache(cveId, cacheDir) {
    const filePath = join(cacheDir, `${cveId.toUpperCase()}.json`);
    try {
        const stat = statSync(filePath);
        if (Date.now() - stat.mtimeMs > CACHE_TTL_MS)
            return null;
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
const CVE_ID_RE = /^CVE-\d{4}-\d{4,}$/i;
function saveCveCache(cveId, cacheDir, data) {
    if (!CVE_ID_RE.test(cveId))
        throw new Error('Invalid CVE ID');
    mkdirSync(cacheDir, { recursive: true });
    const dest = join(cacheDir, `${cveId.toUpperCase()}.json`);
    const tmp = dest + '.tmp';
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, dest);
}
function httpsGet(url, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'monomind-cli/1.0' }, timeout: timeoutMs }, (res) => {
            if (res.statusCode !== 200) {
                req.destroy();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        });
        req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
        req.on('error', reject);
    });
}
function severityColor(severity, score) {
    const s = (severity || '').toUpperCase();
    const label = s + (score !== undefined ? ` (${score})` : '');
    if (s === 'CRITICAL')
        return output.error(label);
    if (s === 'HIGH')
        return output.warning(label);
    if (s === 'MEDIUM')
        return output.info(label);
    return output.dim(label || 'UNKNOWN');
}
const execFileAsync = promisify(execFile);
// ─── cve subcommand ──────────────────────────────────────────────────────────
export const cveCommand = {
    name: 'cve',
    description: 'Check CVEs via NVD/OSV or list project vulnerabilities via npm audit',
    options: [
        { name: 'check', short: 'c', type: 'string', description: 'Check specific CVE ID (e.g. CVE-2024-1234)' },
        { name: 'list', short: 'l', type: 'boolean', description: 'List all vulnerabilities via npm audit' },
        { name: 'severity', short: 's', type: 'string', description: 'Filter by severity: critical, high, medium, low' },
        { name: 'json', type: 'boolean', description: 'Output as JSON' },
        { name: 'no-cache', type: 'boolean', description: 'Skip cache and fetch fresh data' },
    ],
    examples: [
        { command: 'monomind security cve --list', description: 'List vulnerabilities from npm audit' },
        { command: 'monomind security cve -c CVE-2024-1234', description: 'Check specific CVE via NVD/OSV' },
        { command: 'monomind security cve --list --severity high', description: 'Show only high-severity issues' },
    ],
    action: async (ctx) => {
        const checkCve = ctx.flags.check;
        const doList = ctx.flags.list;
        const severityFilter = ctx.flags.severity?.toLowerCase();
        const jsonOutput = ctx.flags.json;
        const noCache = ctx.flags['no-cache'];
        output.writeln();
        output.writeln(output.bold('CVE / Vulnerability Scanner'));
        output.writeln(output.dim('─'.repeat(50)));
        // ── --check CVE-XXXX-YYYY ──────────────────────────────────────────────
        if (checkCve) {
            const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
            if (!CVE_PATTERN.test(checkCve)) {
                output.writeln(output.error(`Invalid CVE ID format: "${checkCve}"`));
                output.writeln(output.dim('Expected format: CVE-YYYY-NNNN (e.g. CVE-2024-12345)'));
                return { success: false };
            }
            const cveId = checkCve.toUpperCase();
            const cacheDir = join(ctx.cwd, '.monomind', 'cache', 'cve');
            let cveData = noCache ? null : getCveCache(cveId, cacheDir);
            let source = 'cache';
            if (!cveData) {
                const spinner = output.createSpinner({ text: `Fetching ${cveId} from NVD...`, spinner: 'dots' });
                spinner.start();
                try {
                    const nvdUrl = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`;
                    const nvdRaw = await httpsGet(nvdUrl);
                    cveData = { _source: 'nvd', ...JSON.parse(nvdRaw) };
                    source = 'NVD';
                    spinner.succeed(`Fetched from NVD`);
                }
                catch {
                    spinner.setText(`NVD unavailable — trying OSV...`);
                    try {
                        const osvUrl = `https://api.osv.dev/v1/vulns/${cveId}`;
                        const osvRaw = await httpsGet(osvUrl);
                        cveData = { _source: 'osv', ...JSON.parse(osvRaw) };
                        source = 'OSV';
                        spinner.succeed(`Fetched from OSV`);
                    }
                    catch {
                        spinner.fail('Could not fetch CVE data');
                        output.writeln(output.error('Could not fetch CVE data — check your network connection'));
                        return { success: false };
                    }
                }
                const nvdVulns = cveData.vulnerabilities;
                if (!Array.isArray(nvdVulns) || nvdVulns.length > 0) {
                    saveCveCache(cveId, cacheDir, cveData);
                }
            }
            const raw = cveData;
            if (jsonOutput) {
                output.writeln(JSON.stringify(raw, null, 2));
                return { success: true };
            }
            if (raw._source === 'nvd') {
                const vulns = raw.vulnerabilities;
                if (!vulns || vulns.length === 0) {
                    output.writeln(output.warning(`No data found for ${cveId}`));
                    return { success: true };
                }
                const cve = vulns[0].cve;
                const published = (cve.published || '').split('T')[0];
                const lastMod = (cve.lastModified || '').split('T')[0];
                const descriptions = cve.descriptions;
                const desc = descriptions?.find(d => d.lang === 'en')?.value || 'No description available';
                const metrics = cve.metrics;
                const cvssV31 = metrics?.cvssMetricV31;
                const cvssData = cvssV31?.[0]?.cvssData;
                const score = cvssData?.baseScore;
                const severity = cvssData?.baseSeverity || 'N/A';
                const references = cve.references;
                output.writeln();
                output.printBox([
                    `CVE ID:        ${cveId}`,
                    `Source:        ${source}`,
                    `Published:     ${published}`,
                    `Last Modified: ${lastMod}`,
                    `Severity:      ${severityColor(severity, score)}`,
                    ``,
                    `Description:`,
                    `  ${desc}`,
                    ``,
                    `References:`,
                    ...(references || []).slice(0, 3).map(r => `  - ${r.url}`),
                ].join('\n'), 'CVE Details');
            }
            else {
                const osv = raw;
                const osvId = osv.id || cveId;
                const summary = osv.summary || osv.details || 'No description available';
                const affected = osv.affected;
                const references = osv.references;
                output.writeln();
                const affectedLines = [];
                if (affected && affected.length > 0) {
                    for (const a of affected.slice(0, 5)) {
                        const pkgName = a.package?.name || 'unknown';
                        const ecosystem = a.package?.ecosystem || '';
                        affectedLines.push(`  - ${pkgName}${ecosystem ? ` (${ecosystem})` : ''}`);
                    }
                }
                output.printBox([
                    `CVE ID:    ${osvId}`,
                    `Source:    OSV (CVSS score: N/A)`,
                    `Severity:  N/A`,
                    ``,
                    `Description:`,
                    `  ${summary}`,
                    ...(affectedLines.length > 0 ? ['', 'Affected packages:', ...affectedLines] : []),
                    ``,
                    `References:`,
                    ...(references || []).slice(0, 3).map(r => `  - ${r.url}`),
                ].join('\n'), 'CVE Details');
            }
            return { success: true };
        }
        // ── --list ─────────────────────────────────────────────────────────────
        if (doList) {
            const spinner = output.createSpinner({ text: 'Running npm audit...', spinner: 'dots' });
            spinner.start();
            let auditOutput = '';
            try {
                const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
                    cwd: ctx.cwd,
                    timeout: 30000,
                });
                auditOutput = stdout;
            }
            catch (err) {
                const execErr = err;
                auditOutput = execErr.stdout || '';
                if (!auditOutput) {
                    spinner.fail('npm audit failed');
                    output.writeln(output.warning('npm audit failed: ' + (execErr.message || 'unknown error')));
                    output.writeln(output.dim('Make sure package-lock.json exists (run `npm install` first).'));
                    return { success: false };
                }
            }
            spinner.succeed('npm audit complete');
            let auditJson;
            try {
                auditJson = JSON.parse(auditOutput);
            }
            catch {
                output.writeln(output.error('Could not parse npm audit output'));
                return { success: false };
            }
            if (jsonOutput) {
                output.writeln(JSON.stringify(auditJson, null, 2));
                return { success: true };
            }
            const vulnerabilities = auditJson.vulnerabilities;
            const metadata = auditJson.metadata;
            const counts = metadata?.vulnerabilities || {};
            const rows = [];
            if (vulnerabilities) {
                for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
                    const sev = vuln.severity || 'unknown';
                    if (severityFilter) {
                        const normalizedSev = sev === 'moderate' ? 'medium' : sev;
                        if (normalizedSev !== severityFilter && sev !== severityFilter)
                            continue;
                    }
                    const viaObj = vuln.via.find(v => typeof v === 'object');
                    let advisoryId = '—';
                    if (viaObj?.url) {
                        const cveMatch = viaObj.url.match(/CVE-\d{4}-\d+/i);
                        const ghsaMatch = viaObj.url.match(/GHSA-[a-z0-9-]+/i);
                        if (cveMatch)
                            advisoryId = cveMatch[0].toUpperCase();
                        else if (ghsaMatch)
                            advisoryId = ghsaMatch[0].toUpperCase();
                        else
                            advisoryId = viaObj.url.split('/').pop() || advisoryId;
                    }
                    const sevColored = sev === 'critical' ? output.error('CRITICAL') :
                        sev === 'high' ? output.warning('HIGH') :
                            sev === 'moderate' || sev === 'medium' ? output.info('MEDIUM') :
                                output.dim(sev.toUpperCase());
                    const fixAvail = vuln.fixAvailable === true ? output.success('Yes') :
                        vuln.fixAvailable && typeof vuln.fixAvailable === 'object' ?
                            output.success(`${vuln.fixAvailable.version}`) :
                            output.dim('No');
                    rows.push({ id: advisoryId, severity: sevColored, package: pkgName, range: vuln.range || '—', fix: fixAvail });
                }
            }
            output.writeln();
            if (rows.length === 0) {
                output.writeln(output.success('No vulnerabilities found' + (severityFilter ? ` matching severity: ${severityFilter}` : '') + '.'));
            }
            else {
                output.printTable({
                    columns: [
                        { key: 'id', header: 'CVE / Advisory', width: 22 },
                        { key: 'severity', header: 'Severity', width: 12 },
                        { key: 'package', header: 'Package', width: 22 },
                        { key: 'range', header: 'Affected Range', width: 20 },
                        { key: 'fix', header: 'Fix Available', width: 16 },
                    ],
                    data: rows,
                });
            }
            const critical = counts['critical'] || 0;
            const high = counts['high'] || 0;
            const moderate = counts['moderate'] || 0;
            const low = counts['low'] || 0;
            output.writeln();
            output.writeln(output.bold('Summary: ') +
                output.error(`${critical} critical`) + '  ' +
                output.warning(`${high} high`) + '  ' +
                output.info(`${moderate} medium`) + '  ' +
                output.dim(`${low} low`));
            return { success: critical === 0 && high === 0 };
        }
        // No subcommand — show usage
        output.writeln('Usage:');
        output.printList([
            '--check CVE-XXXX-YYYY    Look up a specific CVE via NVD/OSV',
            '--list                   List project vulnerabilities (npm audit)',
            '--severity <level>       Filter --list by: critical, high, medium, low',
            '--json                   Output raw JSON',
            '--no-cache               Skip local cache (forces fresh fetch)',
        ]);
        output.writeln();
        output.writeln(output.dim('Examples:'));
        output.writeln(output.dim('  monomind security cve --check CVE-2021-44228'));
        output.writeln(output.dim('  monomind security cve --list --severity critical'));
        return { success: true };
    },
};
//# sourceMappingURL=security-cve.js.map
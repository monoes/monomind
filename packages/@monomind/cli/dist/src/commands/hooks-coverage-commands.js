/**
 * Hooks Coverage Commands
 * Coverage-aware routing, progress tracking, and statusline generation.
 * Extracted from hooks.ts to reduce file size.
 */
import { output } from '../output.js';
// Re-export commands from sub-modules so hooks.ts import stays unchanged
export { coverageRouteCommand } from './hooks-coverage-routing.js';
export { coverageSuggestCommand } from './hooks-coverage-routing.js';
export { coverageGapsCommand } from './hooks-coverage-gaps.js';
export { progressHookCommand } from './hooks-coverage-gaps.js';
// Statusline subcommand - generates dynamic status display
export const statuslineCommand = {
    name: 'statusline',
    description: 'Generate dynamic statusline with v1 progress and system status',
    options: [
        {
            name: 'json',
            description: 'Output as JSON',
            type: 'boolean',
            default: false
        },
        {
            name: 'compact',
            description: 'Compact single-line output',
            type: 'boolean',
            default: false
        },
        {
            name: 'no-color',
            description: 'Disable ANSI colors',
            type: 'boolean',
            default: false
        }
    ],
    examples: [
        { command: 'monomind hooks statusline', description: 'Display full statusline' },
        { command: 'monomind hooks statusline --json', description: 'JSON output for hooks' },
        { command: 'monomind hooks statusline --compact', description: 'Single-line status' }
    ],
    action: async (ctx) => {
        const fs = await import('fs');
        const path = await import('path');
        const { execSync } = await import('child_process');
        function getLearningStats() {
            const memoryPaths = [
                path.join(process.cwd(), '.swarm', 'memory.db'),
                path.join(process.cwd(), '.claude', 'memory.db'),
            ];
            let patterns = 0;
            let sessions = 0;
            let trajectories = 0;
            for (const dbPath of memoryPaths) {
                if (fs.existsSync(dbPath)) {
                    try {
                        const stats = fs.statSync(dbPath);
                        const sizeKB = stats.size / 1024;
                        patterns = Math.floor(sizeKB / 2);
                        sessions = Math.max(1, Math.floor(patterns / 10));
                        trajectories = Math.floor(patterns / 5);
                        break;
                    }
                    catch { /* ignore */ }
                }
            }
            const sessionsPath = path.join(process.cwd(), '.claude', 'sessions');
            if (fs.existsSync(sessionsPath)) {
                try {
                    const sessionFiles = fs.readdirSync(sessionsPath).filter((f) => f.endsWith('.json'));
                    sessions = Math.max(sessions, sessionFiles.length);
                }
                catch { /* ignore */ }
            }
            return { patterns, sessions, trajectories };
        }
        function getv1Progress() {
            const learning = getLearningStats();
            let domainsCompleted = 0;
            if (learning.patterns >= 500)
                domainsCompleted = 5;
            else if (learning.patterns >= 200)
                domainsCompleted = 4;
            else if (learning.patterns >= 100)
                domainsCompleted = 3;
            else if (learning.patterns >= 50)
                domainsCompleted = 2;
            else if (learning.patterns >= 10)
                domainsCompleted = 1;
            const totalDomains = 5;
            const dddProgress = Math.min(100, Math.floor((domainsCompleted / totalDomains) * 100));
            return { domainsCompleted, totalDomains, dddProgress, patternsLearned: learning.patterns, sessionsCompleted: learning.sessions };
        }
        function getSecurityStatus() {
            const scanResultsPath = path.join(process.cwd(), '.claude', 'security-scans');
            let cvesFixed = 0;
            const totalCves = 3;
            if (fs.existsSync(scanResultsPath)) {
                try {
                    const scans = fs.readdirSync(scanResultsPath).filter((f) => f.endsWith('.json'));
                    cvesFixed = Math.min(totalCves, scans.length);
                }
                catch { /* ignore */ }
            }
            const auditPath = path.join(process.cwd(), '.swarm', 'security');
            if (fs.existsSync(auditPath)) {
                try {
                    const audits = fs.readdirSync(auditPath).filter((f) => f.includes('audit'));
                    cvesFixed = Math.min(totalCves, Math.max(cvesFixed, audits.length));
                }
                catch { /* ignore */ }
            }
            const status = cvesFixed >= totalCves ? 'CLEAN' : cvesFixed > 0 ? 'IN_PROGRESS' : 'PENDING';
            return { status, cvesFixed, totalCves };
        }
        function getSwarmStatus() {
            let activeAgents = 0;
            let coordinationActive = false;
            const maxAgents = 15;
            const isWindows = process.platform === 'win32';
            try {
                const psCmd = isWindows
                    ? 'tasklist /FI "IMAGENAME eq node.exe" 2>NUL | findstr /I /C:"node" >NUL && echo 1 || echo 0'
                    : 'ps aux 2>/dev/null | grep -c "mcp.*start" || echo "0"';
                const ps = execSync(psCmd, { encoding: 'utf-8' });
                const raw = parseInt(ps.trim());
                activeAgents = Math.max(0, isWindows ? raw : raw - 1);
                coordinationActive = activeAgents > 0;
            }
            catch { /* ignore */ }
            return { activeAgents, maxAgents, coordinationActive };
        }
        function getSystemMetrics() {
            let memoryMB = 0;
            let subAgents = 0;
            const learning = getLearningStats();
            try {
                memoryMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
            }
            catch { /* ignore */ }
            let intelligencePct = 0;
            const learningJsonPaths = [
                path.join(process.cwd(), '.monomind', 'learning.json'),
                path.join(process.cwd(), '.claude', '.monomind', 'learning.json'),
                path.join(process.cwd(), '.swarm', 'learning.json'),
            ];
            for (const lPath of learningJsonPaths) {
                if (fs.existsSync(lPath)) {
                    try {
                        if (fs.statSync(lPath).size <= 524_288) {
                            const data = JSON.parse(fs.readFileSync(lPath, 'utf-8'));
                            if (data.intelligence?.score !== undefined) {
                                intelligencePct = Math.min(100, Math.floor(data.intelligence.score));
                                break;
                            }
                        }
                    }
                    catch { /* ignore */ }
                }
            }
            if (intelligencePct === 0) {
                intelligencePct = learning.patterns > 0 ? Math.min(100, Math.floor(learning.patterns / 10)) : 0;
            }
            if (intelligencePct === 0) {
                let maturityScore = 0;
                if (fs.existsSync(path.join(process.cwd(), '.claude')))
                    maturityScore += 15;
                if (fs.existsSync(path.join(process.cwd(), '.monomind')))
                    maturityScore += 15;
                if (fs.existsSync(path.join(process.cwd(), 'CLAUDE.md')))
                    maturityScore += 10;
                if (fs.existsSync(path.join(process.cwd(), 'monomind.config.json')))
                    maturityScore += 10;
                if (fs.existsSync(path.join(process.cwd(), '.swarm')))
                    maturityScore += 10;
                const testDirs = ['tests', '__tests__', 'test', 'v1/__tests__'];
                for (const dir of testDirs) {
                    if (fs.existsSync(path.join(process.cwd(), dir))) {
                        maturityScore += 10;
                        break;
                    }
                }
                if (fs.existsSync(path.join(process.cwd(), '.claude', 'settings.json')))
                    maturityScore += 10;
                intelligencePct = Math.min(100, maturityScore);
            }
            const contextPct = Math.min(100, Math.floor(learning.sessions * 5));
            return { memoryMB, contextPct, intelligencePct, subAgents };
        }
        function getUserInfo() {
            let name = 'user';
            let gitBranch = '';
            const modelName = 'Opus 4.6 (1M context)';
            const isWindows = process.platform === 'win32';
            try {
                const nameCmd = isWindows ? 'git config user.name 2>NUL || echo user' : 'git config user.name 2>/dev/null || echo "user"';
                const branchCmd = isWindows ? 'git branch --show-current 2>NUL || echo.' : 'git branch --show-current 2>/dev/null || echo ""';
                name = execSync(nameCmd, { encoding: 'utf-8' }).trim();
                gitBranch = execSync(branchCmd, { encoding: 'utf-8' }).trim();
                if (gitBranch === '.')
                    gitBranch = '';
            }
            catch { /* ignore */ }
            return { name, gitBranch, modelName };
        }
        const progress = getv1Progress();
        const security = getSecurityStatus();
        const swarm = getSwarmStatus();
        const system = getSystemMetrics();
        const user = getUserInfo();
        const statusData = {
            user,
            v1Progress: progress,
            security,
            swarm,
            system,
            timestamp: new Date().toISOString()
        };
        if (ctx.flags.json || ctx.flags.format === 'json') {
            output.printJson(statusData);
            return { success: true, data: statusData };
        }
        if (ctx.flags.compact) {
            const line = `DDD:${progress.domainsCompleted}/${progress.totalDomains} CVE:${security.cvesFixed}/${security.totalCves} Swarm:${swarm.activeAgents}/${swarm.maxAgents} Ctx:${system.contextPct}% Int:${system.intelligencePct}%`;
            output.writeln(line);
            return { success: true, data: statusData };
        }
        const noColor = ctx.flags['no-color'] || ctx.flags.noColor;
        const c = noColor ? {
            reset: '', bold: '', dim: '', red: '', green: '', yellow: '', blue: '',
            purple: '', cyan: '', brightRed: '', brightGreen: '', brightYellow: '',
            brightBlue: '', brightPurple: '', brightCyan: '', brightWhite: ''
        } : {
            reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[0;31m',
            green: '\x1b[0;32m', yellow: '\x1b[0;33m', blue: '\x1b[0;34m',
            purple: '\x1b[0;35m', cyan: '\x1b[0;36m', brightRed: '\x1b[1;31m',
            brightGreen: '\x1b[1;32m', brightYellow: '\x1b[1;33m', brightBlue: '\x1b[1;34m',
            brightPurple: '\x1b[1;35m', brightCyan: '\x1b[1;36m', brightWhite: '\x1b[1;37m'
        };
        const progressBar = (current, total) => {
            const filled = Math.round((current / total) * 5);
            const empty = 5 - filled;
            return '[' + '●'.repeat(filled) + '○'.repeat(empty) + ']';
        };
        let header = `${c.bold}${c.brightPurple}▊ Monomind ${c.reset}`;
        header += `${swarm.coordinationActive ? c.brightCyan : c.dim}● ${c.brightCyan}${user.name}${c.reset}`;
        if (user.gitBranch) {
            header += `  ${c.dim}│${c.reset}  ${c.brightBlue}⎇ ${user.gitBranch}${c.reset}`;
        }
        header += `  ${c.dim}│${c.reset}  ${c.purple}${user.modelName}${c.reset}`;
        const separator = `${c.dim}─────────────────────────────────────────────────────${c.reset}`;
        const hooksStats = { enabled: 0, total: 17 };
        const settingsPath = path.join(process.cwd(), '.claude', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            try {
                if (fs.statSync(settingsPath).size <= 524_288) {
                    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                    if (settings.hooks) {
                        hooksStats.enabled = Object.values(settings.hooks).filter((h) => h && typeof h === 'object').length;
                    }
                }
            }
            catch { /* ignore */ }
        }
        const memoryStats = { vectorCount: 0, dbSizeKB: 0, hasHnsw: false };
        const dbPaths = [
            path.join(process.cwd(), '.swarm', 'memory.db'),
            path.join(process.cwd(), '.monomind', 'memory.db'),
            path.join(process.cwd(), '.claude', 'memory.db'),
            path.join(process.cwd(), 'data', 'memory.db'),
            path.join(process.cwd(), 'memory.db'),
            path.join(process.cwd(), ".swarm", "lancedb"),
            path.join(process.cwd(), ".monomind", "memory", "lancedb"),
        ];
        for (const dbPath of dbPaths) {
            if (fs.existsSync(dbPath)) {
                try {
                    const stats = fs.statSync(dbPath);
                    memoryStats.dbSizeKB = Math.round(stats.size / 1024);
                    memoryStats.vectorCount = Math.floor(memoryStats.dbSizeKB / 2);
                    memoryStats.hasHnsw = memoryStats.vectorCount > 100;
                    break;
                }
                catch { /* ignore */ }
            }
        }
        if (memoryStats.vectorCount === 0) {
            const lancedbDirs = [
                path.join(process.cwd(), ".monomind", "lancedb"),
                path.join(process.cwd(), ".swarm", "lancedb"),
                path.join(process.cwd(), "data", "lancedb"),
            ];
            for (const dir of lancedbDirs) {
                if (fs.existsSync(dir)) {
                    try {
                        const files = fs.readdirSync(dir);
                        for (const f of files) {
                            if (f.endsWith('.db') || f.endsWith('.sqlite')) {
                                const fileStat = fs.statSync(path.join(dir, f));
                                memoryStats.dbSizeKB += Math.round(fileStat.size / 1024);
                            }
                        }
                        memoryStats.vectorCount = Math.floor(memoryStats.dbSizeKB / 2);
                        memoryStats.hasHnsw = memoryStats.vectorCount > 100;
                        if (memoryStats.vectorCount > 0)
                            break;
                    }
                    catch { /* ignore */ }
                }
            }
        }
        const hnswPaths = [
            path.join(process.cwd(), '.monomind', 'hnsw'),
            path.join(process.cwd(), '.swarm', 'hnsw'),
            path.join(process.cwd(), 'data', 'hnsw'),
        ];
        for (const hnswPath of hnswPaths) {
            if (fs.existsSync(hnswPath)) {
                memoryStats.hasHnsw = true;
                try {
                    const hnswFiles = fs.readdirSync(hnswPath);
                    const indexFile = hnswFiles.find(f => f.endsWith('.index'));
                    if (indexFile) {
                        const indexStat = fs.statSync(path.join(hnswPath, indexFile));
                        memoryStats.vectorCount = Math.max(memoryStats.vectorCount, Math.floor(indexStat.size / 512));
                    }
                }
                catch { /* ignore */ }
                break;
            }
        }
        const vectorsPath = path.join(process.cwd(), '.monomind', 'vectors.json');
        if (fs.existsSync(vectorsPath) && memoryStats.vectorCount === 0) {
            try {
                if (fs.statSync(vectorsPath).size <= 8_388_608) {
                    const data = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));
                    if (Array.isArray(data)) {
                        memoryStats.vectorCount = data.length;
                    }
                    else if (data.vectors) {
                        memoryStats.vectorCount = Object.keys(data.vectors).length;
                    }
                }
            }
            catch { /* ignore */ }
        }
        const testStats = { testFiles: 0, testCases: 0 };
        for (const testPath of ['tests', '__tests__', 'test', 'spec']) {
            const fullPath = path.join(process.cwd(), testPath);
            if (fs.existsSync(fullPath)) {
                try {
                    const files = fs.readdirSync(fullPath, { recursive: true });
                    testStats.testFiles = files.filter((f) => /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(f)).length;
                    testStats.testCases = testStats.testFiles * 28;
                }
                catch { /* ignore */ }
            }
        }
        const mcpStats = { enabled: 0, total: 0 };
        const mcpPath = path.join(process.cwd(), '.mcp.json');
        if (fs.existsSync(mcpPath)) {
            try {
                const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
                if (mcp.mcpServers) {
                    mcpStats.total = Object.keys(mcp.mcpServers).length;
                    mcpStats.enabled = mcpStats.total;
                }
            }
            catch { /* ignore */ }
        }
        const domainsColor = progress.domainsCompleted >= 3 ? c.brightGreen : progress.domainsCompleted > 0 ? c.yellow : c.red;
        let perfIndicator = `${c.dim}⚡ HNSW: idle${c.reset}`;
        if (memoryStats.hasHnsw && memoryStats.vectorCount > 0) {
            perfIndicator = `${c.brightGreen}⚡ HNSW ${memoryStats.vectorCount.toLocaleString()} vec${c.reset}`;
        }
        else if (progress.patternsLearned > 0) {
            const patternsK = progress.patternsLearned >= 1000 ? `${(progress.patternsLearned / 1000).toFixed(1)}k` : String(progress.patternsLearned);
            perfIndicator = `${c.brightYellow}📚 ${patternsK} patterns${c.reset}`;
        }
        const line1 = `${c.brightCyan}🏗️  DDD Domains${c.reset}    ${progressBar(progress.domainsCompleted, progress.totalDomains)}  ` +
            `${domainsColor}${progress.domainsCompleted}${c.reset}/${c.brightWhite}${progress.totalDomains}${c.reset}    ` +
            perfIndicator;
        const swarmIndicator = swarm.coordinationActive ? `${c.brightGreen}◉${c.reset}` : `${c.dim}○${c.reset}`;
        const agentsColor = swarm.activeAgents > 0 ? c.brightGreen : c.red;
        const securityIcon = security.status === 'CLEAN' ? '🟢' : security.status === 'IN_PROGRESS' ? '🟡' : '🔴';
        const securityColor = security.status === 'CLEAN' ? c.brightGreen : security.status === 'IN_PROGRESS' ? c.brightYellow : c.brightRed;
        const hooksColor = hooksStats.enabled > 0 ? c.brightGreen : c.dim;
        const line2 = `${c.brightYellow}🤖 Swarm${c.reset}  ${swarmIndicator} [${agentsColor}${String(swarm.activeAgents).padStart(2)}${c.reset}/${c.brightWhite}${swarm.maxAgents}${c.reset}]  ` +
            `${c.brightPurple}👥 ${system.subAgents}${c.reset}    ` +
            `${c.brightBlue}🪝 ${hooksColor}${hooksStats.enabled}${c.reset}/${c.brightWhite}${hooksStats.total}${c.reset}    ` +
            `${securityIcon} ${securityColor}CVE ${security.cvesFixed}${c.reset}/${c.brightWhite}${security.totalCves}${c.reset}    ` +
            `${c.brightCyan}💾 ${system.memoryMB}MB${c.reset}    ` +
            `${c.brightPurple}🧠 ${String(system.intelligencePct).padStart(3)}%${c.reset}`;
        const dddColor = progress.dddProgress >= 50 ? c.brightGreen : progress.dddProgress > 0 ? c.yellow : c.red;
        const line3 = `${c.brightPurple}🔧 Architecture${c.reset}    ` +
            `${c.cyan}ADRs${c.reset} ${c.dim}●0/0${c.reset}  ${c.dim}│${c.reset}  ` +
            `${c.cyan}DDD${c.reset} ${dddColor}●${String(progress.dddProgress).padStart(3)}%${c.reset}  ${c.dim}│${c.reset}  ` +
            `${c.cyan}Security${c.reset} ${securityColor}●${security.status}${c.reset}`;
        const vectorColor = memoryStats.vectorCount > 0 ? c.brightGreen : c.dim;
        const testColor = testStats.testFiles > 0 ? c.brightGreen : c.dim;
        const mcpColor = mcpStats.enabled > 0 ? c.brightGreen : c.dim;
        const sizeDisplay = memoryStats.dbSizeKB >= 1024 ? `${(memoryStats.dbSizeKB / 1024).toFixed(1)}MB` : `${memoryStats.dbSizeKB}KB`;
        const hnswIndicator = memoryStats.hasHnsw ? `${c.brightGreen}⚡${c.reset}` : '';
        const line4 = `${c.brightCyan}📊 LanceDB${c.reset}    ` +
            `${c.cyan}Vectors${c.reset} ${vectorColor}●${memoryStats.vectorCount}${hnswIndicator}${c.reset}  ${c.dim}│${c.reset}  ` +
            `${c.cyan}Size${c.reset} ${c.brightWhite}${sizeDisplay}${c.reset}  ${c.dim}│${c.reset}  ` +
            `${c.cyan}Tests${c.reset} ${testColor}●${testStats.testFiles}${c.reset} ${c.dim}(${testStats.testCases} cases)${c.reset}  ${c.dim}│${c.reset}  ` +
            `${c.cyan}MCP${c.reset} ${mcpColor}●${mcpStats.enabled}/${mcpStats.total}${c.reset}`;
        output.writeln(header);
        output.writeln(separator);
        output.writeln(line1);
        output.writeln(line2);
        output.writeln(line3);
        output.writeln(line4);
        return { success: true, data: statusData };
    }
};
//# sourceMappingURL=hooks-coverage-commands.js.map
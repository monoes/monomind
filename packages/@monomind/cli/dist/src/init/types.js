/**
 * V1 Init System Types
 * Configuration options for initializing Claude Code integration
 */
import os from 'os';
import path from 'path';
/**
 * Detect current platform
 */
export function detectPlatform() {
    const platform = os.platform();
    const arch = os.arch();
    const homeDir = os.homedir();
    let osType;
    let shell;
    let configDir;
    switch (platform) {
        case 'win32':
            osType = 'windows';
            shell = process.env.PSModulePath ? 'powershell' : 'cmd';
            configDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
            break;
        case 'darwin':
            osType = 'darwin';
            shell = process.env.SHELL?.includes('zsh') ? 'zsh' : 'bash';
            configDir = path.join(homeDir, 'Library', 'Application Support');
            break;
        default:
            osType = 'linux';
            shell = process.env.SHELL?.includes('zsh') ? 'zsh' : (process.env.SHELL?.includes('bash') ? 'bash' : 'sh');
            configDir = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
    }
    return {
        os: osType,
        arch: arch,
        nodeVersion: process.version,
        shell,
        homeDir,
        configDir,
    };
}
/**
 * Default init options - full V1 setup
 */
export const DEFAULT_INIT_OPTIONS = {
    targetDir: process.cwd(),
    force: false,
    interactive: true,
    components: {
        settings: true,
        skills: true,
        commands: true,
        agents: true,
        helpers: true,
        statusline: true,
        mcp: true,
        runtime: true,
        claudeMd: true,
        graphify: true,
    },
    hooks: {
        preToolUse: true,
        postToolUse: true,
        userPromptSubmit: true,
        sessionStart: true,
        stop: true,
        preCompact: true,
        notification: true,
        teammateIdle: true,
        taskCompleted: true,
        timeout: 5000,
        continueOnError: true,
    },
    skills: {
        core: true,
        agentdb: true,
        github: true,
        browser: true,
        v1: true,
        dualMode: false, // Optional: enable with --dual flag
        all: false,
    },
    commands: {
        core: true,
        analysis: true,
        automation: true,
        github: true,
        hooks: true,
        monitoring: true,
        optimization: true,
        sparc: true,
        all: false,
    },
    agents: {
        core: true,
        consensus: true,
        github: true,
        hiveMind: true,
        sparc: true,
        swarm: true,
        browser: true,
        v1: true,
        optimization: true,
        testing: true,
        dualMode: false, // Optional: enable with --dual flag
        all: true,
    },
    statusline: {
        enabled: true,
        showProgress: true,
        showSecurity: true,
        showSwarm: true,
        showHooks: true,
        showPerformance: true,
        refreshInterval: 5000,
    },
    mcp: {
        monobrain: true,
        ruvSwarm: false,
        graphify: false,
        autoStart: false,
        port: 3000,
    },
    runtime: {
        topology: 'hierarchical-mesh',
        maxAgents: 15,
        memoryBackend: 'hybrid',
        enableHNSW: true,
        enableNeural: true,
        enableLearningBridge: true,
        enableMemoryGraph: true,
        enableAgentScopes: true,
    },
    embeddings: {
        enabled: true,
        model: 'Xenova/all-MiniLM-L6-v2',
        hyperbolic: true,
        curvature: -1.0,
        predownload: false, // Don't auto-download to speed up init
        cacheSize: 256,
        neuralSubstrate: true,
    },
};
/**
 * Minimal init options
 */
export const MINIMAL_INIT_OPTIONS = {
    ...DEFAULT_INIT_OPTIONS,
    components: {
        settings: true,
        skills: true,
        commands: false,
        agents: false,
        helpers: false,
        statusline: false,
        mcp: true,
        runtime: true,
        claudeMd: true,
        graphify: false,
    },
    hooks: {
        ...DEFAULT_INIT_OPTIONS.hooks,
        userPromptSubmit: false,
        stop: false,
        notification: false,
        teammateIdle: false,
        taskCompleted: false,
    },
    skills: {
        core: true,
        agentdb: false,
        github: false,
        browser: false,
        v1: false,
        dualMode: false,
        all: false,
    },
    agents: {
        core: true,
        consensus: false,
        github: false,
        hiveMind: false,
        sparc: false,
        swarm: false,
        browser: false,
        v1: false,
        optimization: false,
        testing: false,
        dualMode: false,
        all: false,
    },
    runtime: {
        topology: 'mesh',
        maxAgents: 5,
        memoryBackend: 'memory',
        enableHNSW: false,
        enableNeural: false,
        enableLearningBridge: false,
        enableMemoryGraph: false,
        enableAgentScopes: false,
    },
    embeddings: {
        enabled: false,
        model: 'Xenova/all-MiniLM-L6-v2',
        hyperbolic: false,
        curvature: -1.0,
        predownload: false,
        cacheSize: 128,
        neuralSubstrate: false,
    },
};
/**
 * Full init options (everything enabled)
 */
export const FULL_INIT_OPTIONS = {
    ...DEFAULT_INIT_OPTIONS,
    components: {
        settings: true,
        skills: true,
        commands: true,
        agents: true,
        helpers: true,
        statusline: true,
        mcp: true,
        runtime: true,
        claudeMd: true,
        graphify: true,
    },
    skills: {
        core: true,
        agentdb: true,
        github: true,
        browser: true,
        v1: true,
        dualMode: true, // Include in full init
        all: true,
    },
    commands: {
        ...DEFAULT_INIT_OPTIONS.commands,
        all: true,
    },
    agents: {
        ...DEFAULT_INIT_OPTIONS.agents,
        all: true,
    },
    mcp: {
        monobrain: true,
        ruvSwarm: true,
        graphify: false,
        autoStart: false,
        port: 3000,
    },
    embeddings: {
        enabled: true,
        model: 'Xenova/all-MiniLM-L6-v2',
        hyperbolic: true,
        curvature: -1.0,
        predownload: true, // Pre-download for full init
        cacheSize: 256,
        neuralSubstrate: true,
    },
};
//# sourceMappingURL=types.js.map
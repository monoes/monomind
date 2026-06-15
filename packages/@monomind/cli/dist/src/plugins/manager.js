/**
 * Plugin Manager
 * Handles actual plugin installation, persistence, and lifecycle
 * Bridges discovery service with file system persistence
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
/**
 * Validate npm package name to prevent shell injection (S-3)
 */
const VALID_PACKAGE_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9._\-^~>=<]+)?$/;
function validatePackageName(spec) {
    if (!VALID_PACKAGE_RE.test(spec)) {
        throw new Error(`Invalid package name: ${spec}`);
    }
}
const VALID_VERSION_RE = /^[a-zA-Z0-9._\-^~>=<*]+$/;
function validateVersion(version) {
    if (!VALID_VERSION_RE.test(version) || version.length > 50) {
        throw new Error(`Invalid version specifier: ${version}`);
    }
}
/** Forbidden manifest keys (prototype pollution defense) */
const FORBIDDEN_PLUGIN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function isValidPluginKey(name) {
    return typeof name === 'string'
        && name.length > 0
        && name.length <= 214
        && !FORBIDDEN_PLUGIN_KEYS.has(name)
        && VALID_PACKAGE_RE.test(name);
}
// ============================================================================
// Plugin Manager
// ============================================================================
/**
 * Manages plugin installation, persistence, and lifecycle.
 *
 * Unlike the simulated version, this actually:
 * - Persists plugins to disk
 * - Downloads from npm
 * - Tracks enabled/disabled state
 * - Loads plugin modules
 */
export class PluginManager {
    config;
    manifest = null;
    constructor(baseDir = process.cwd()) {
        const pluginsDir = path.join(baseDir, '.monomind', 'plugins');
        this.config = {
            pluginsDir,
            manifestPath: path.join(pluginsDir, 'installed.json'),
        };
    }
    // =========================================================================
    // Initialization
    // =========================================================================
    /**
     * Initialize the plugin manager, creating directories and loading manifest
     */
    async initialize() {
        // Ensure plugins directory exists
        await this.ensureDirectory(this.config.pluginsDir);
        // Load or create manifest
        this.manifest = await this.loadManifest();
    }
    async ensureDirectory(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    async loadManifest() {
        try {
            const MAX_MANIFEST_BYTES = 10 * 1024 * 1024; // 10 MB
            if (fs.existsSync(this.config.manifestPath) && fs.statSync(this.config.manifestPath).size <= MAX_MANIFEST_BYTES) {
                const content = fs.readFileSync(this.config.manifestPath, 'utf-8');
                const parsed = JSON.parse(content);
                if (Object.prototype.hasOwnProperty.call(parsed, '__proto__') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'constructor') ||
                    Object.prototype.hasOwnProperty.call(parsed, 'prototype')) {
                    throw new Error('Manifest contains forbidden keys');
                }
                return parsed;
            }
        }
        catch (error) {
            console.warn('[PluginManager] Failed to load manifest, creating new one');
        }
        return {
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            plugins: {},
        };
    }
    async saveManifest() {
        if (!this.manifest)
            return;
        this.manifest.lastUpdated = new Date().toISOString();
        await this.ensureDirectory(path.dirname(this.config.manifestPath));
        // Atomic write to prevent corruption on crash
        const tmp = this.config.manifestPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.manifest, null, 2), 'utf-8');
        fs.renameSync(tmp, this.config.manifestPath);
    }
    // =========================================================================
    // Installation
    // =========================================================================
    /**
     * Install a plugin from npm
     */
    async installFromNpm(packageName, version) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName)) {
            return { success: false, error: `Invalid package name: ${packageName}` };
        }
        if (version) {
            try {
                validateVersion(version);
            }
            catch {
                return { success: false, error: `Invalid version specifier: ${version}` };
            }
        }
        const versionSpec = version ? `${packageName}@${version}` : packageName;
        try {
            // Check if already installed
            if (Object.hasOwn(this.manifest.plugins, packageName)) {
                return {
                    success: false,
                    error: `Plugin ${packageName} is already installed. Use upgrade to update.`,
                };
            }
            // Install to local plugins directory
            const installDir = path.join(this.config.pluginsDir, 'node_modules');
            await this.ensureDirectory(installDir);
            // Validate package name to prevent injection (S-3)
            validatePackageName(versionSpec);
            // Use npm to install. --ignore-scripts blocks pre/post-install lifecycle hooks
            // from the plugin package, which would otherwise execute arbitrary code at
            // install time (the canonical npm supply-chain attack vector).
            console.log(`[PluginManager] Installing ${versionSpec}...`);
            await execFileAsync('npm', ['install', '--ignore-scripts', '--prefix', this.config.pluginsDir, versionSpec], { timeout: 120000 });
            // Get installed version
            const packageJsonPath = path.join(installDir, packageName, 'package.json');
            let installedVersion = version || 'latest';
            let commands = [];
            let hooks = [];
            const MAX_PKG_JSON_BYTES = 1024 * 1024; // 1 MB
            if (fs.existsSync(packageJsonPath) && fs.statSync(packageJsonPath).size <= MAX_PKG_JSON_BYTES) {
                const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                installedVersion = pkg.version;
                // Check for monomind plugin metadata
                if (pkg['monomind']) {
                    commands = Array.isArray(pkg['monomind'].commands) ? pkg['monomind'].commands : [];
                    hooks = Array.isArray(pkg['monomind'].hooks) ? pkg['monomind'].hooks : [];
                }
            }
            // Create plugin entry
            const plugin = {
                name: packageName,
                version: installedVersion,
                installedAt: new Date().toISOString(),
                enabled: true,
                source: 'npm',
                path: path.join(installDir, packageName),
                commands,
                hooks,
            };
            // Save to manifest
            this.manifest.plugins[packageName] = plugin;
            await this.saveManifest();
            console.log(`[PluginManager] Installed ${packageName}@${installedVersion}`);
            return { success: true, plugin };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[PluginManager] Failed to install ${packageName}:`, errorMsg);
            return { success: false, error: errorMsg };
        }
    }
    /**
     * Install a plugin from a local path
     */
    async installFromLocal(sourcePath) {
        if (!this.manifest) {
            await this.initialize();
        }
        try {
            const absolutePath = path.resolve(sourcePath);
            // Restrict local installs to paths under cwd or $HOME to prevent path traversal
            const cwd = process.cwd();
            const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
            const underCwd = absolutePath.startsWith(cwd + path.sep) || absolutePath === cwd;
            const underHome = home && (absolutePath.startsWith(home + path.sep) || absolutePath === home);
            if (!underCwd && !underHome) {
                return { success: false, error: `Local path must be within the current directory or home: ${absolutePath}` };
            }
            if (!fs.existsSync(absolutePath)) {
                return { success: false, error: `Path does not exist: ${absolutePath}` };
            }
            // Read package.json
            const packageJsonPath = path.join(absolutePath, 'package.json');
            if (!fs.existsSync(packageJsonPath)) {
                return { success: false, error: 'No package.json found at path' };
            }
            if (fs.statSync(packageJsonPath).size > 1024 * 1024) {
                return { success: false, error: 'package.json exceeds size limit' };
            }
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            const packageName = pkg.name;
            if (!isValidPluginKey(packageName)) {
                return { success: false, error: `Invalid package.json: name is missing or invalid` };
            }
            // Check if already installed
            if (Object.hasOwn(this.manifest.plugins, packageName)) {
                return {
                    success: false,
                    error: `Plugin ${packageName} is already installed`,
                };
            }
            // Create plugin entry (link to local path, don't copy)
            const plugin = {
                name: packageName,
                version: pkg.version,
                installedAt: new Date().toISOString(),
                enabled: true,
                source: 'local',
                path: absolutePath,
                commands: pkg['monomind']?.commands || [],
                hooks: pkg['monomind']?.hooks || [],
            };
            // Save to manifest
            this.manifest.plugins[packageName] = plugin;
            await this.saveManifest();
            console.log(`[PluginManager] Installed local plugin ${packageName}@${pkg.version}`);
            return { success: true, plugin };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[PluginManager] Failed to install from local:`, errorMsg);
            return { success: false, error: errorMsg };
        }
    }
    // =========================================================================
    // Uninstallation
    // =========================================================================
    /**
     * Uninstall a plugin
     */
    async uninstall(packageName) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName)) {
            return { success: false, error: `Invalid package name` };
        }
        const plugin = Object.hasOwn(this.manifest.plugins, packageName)
            ? this.manifest.plugins[packageName]
            : undefined;
        if (!plugin) {
            return { success: false, error: `Plugin ${packageName} is not installed` };
        }
        try {
            // For npm-installed plugins, remove from node_modules
            if (plugin.source === 'npm') {
                validatePackageName(packageName);
                await execFileAsync('npm', ['uninstall', '--ignore-scripts', '--prefix', this.config.pluginsDir, packageName], { timeout: 60000 });
            }
            // Remove from manifest
            delete this.manifest.plugins[packageName];
            await this.saveManifest();
            console.log(`[PluginManager] Uninstalled ${packageName}`);
            return { success: true };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[PluginManager] Failed to uninstall ${packageName}:`, errorMsg);
            return { success: false, error: errorMsg };
        }
    }
    // =========================================================================
    // Enable/Disable
    // =========================================================================
    /**
     * Enable a plugin
     */
    async enable(packageName) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName)) {
            return { success: false, error: `Invalid package name` };
        }
        const plugin = Object.hasOwn(this.manifest.plugins, packageName)
            ? this.manifest.plugins[packageName]
            : undefined;
        if (!plugin) {
            return { success: false, error: `Plugin ${packageName} is not installed` };
        }
        plugin.enabled = true;
        await this.saveManifest();
        return { success: true };
    }
    /**
     * Disable a plugin
     */
    async disable(packageName) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName)) {
            return { success: false, error: `Invalid package name` };
        }
        const plugin = Object.hasOwn(this.manifest.plugins, packageName)
            ? this.manifest.plugins[packageName]
            : undefined;
        if (!plugin) {
            return { success: false, error: `Plugin ${packageName} is not installed` };
        }
        plugin.enabled = false;
        await this.saveManifest();
        return { success: true };
    }
    /**
     * Toggle a plugin's enabled state
     */
    async toggle(packageName) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName)) {
            return { success: false, error: `Invalid package name` };
        }
        const plugin = Object.hasOwn(this.manifest.plugins, packageName)
            ? this.manifest.plugins[packageName]
            : undefined;
        if (!plugin) {
            return { success: false, error: `Plugin ${packageName} is not installed` };
        }
        plugin.enabled = !plugin.enabled;
        await this.saveManifest();
        return { success: true, enabled: plugin.enabled };
    }
    // =========================================================================
    // Query
    // =========================================================================
    /**
     * Get all installed plugins
     */
    async getInstalled() {
        if (!this.manifest) {
            await this.initialize();
        }
        return Object.values(this.manifest.plugins);
    }
    /**
     * Get enabled plugins
     */
    async getEnabled() {
        const all = await this.getInstalled();
        return all.filter(p => p.enabled);
    }
    /**
     * Check if a plugin is installed
     */
    async isInstalled(packageName) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName))
            return false;
        return Object.hasOwn(this.manifest.plugins, packageName);
    }
    /**
     * Get a specific installed plugin
     */
    async getPlugin(packageName) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName))
            return undefined;
        return Object.hasOwn(this.manifest.plugins, packageName)
            ? this.manifest.plugins[packageName]
            : undefined;
    }
    // =========================================================================
    // Upgrade
    // =========================================================================
    /**
     * Upgrade a plugin to a new version
     */
    async upgrade(packageName, version) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName)) {
            return { success: false, error: `Invalid package name` };
        }
        if (version) {
            try {
                validateVersion(version);
            }
            catch {
                return { success: false, error: `Invalid version specifier: ${version}` };
            }
        }
        const existing = Object.hasOwn(this.manifest.plugins, packageName)
            ? this.manifest.plugins[packageName]
            : undefined;
        if (!existing) {
            return { success: false, error: `Plugin ${packageName} is not installed` };
        }
        if (existing.source !== 'npm') {
            return { success: false, error: 'Can only upgrade npm-installed plugins' };
        }
        try {
            const versionSpec = version ? `${packageName}@${version}` : `${packageName}@latest`;
            // Validate package name to prevent injection (S-3)
            validatePackageName(versionSpec);
            // Reinstall with new version. --ignore-scripts blocks pre/post-install
            // lifecycle hooks from the plugin package.
            await execFileAsync('npm', ['install', '--ignore-scripts', '--prefix', this.config.pluginsDir, versionSpec], { timeout: 120000 });
            // Update manifest
            const installDir = path.join(this.config.pluginsDir, 'node_modules');
            const packageJsonPath = path.join(installDir, packageName, 'package.json');
            if (fs.existsSync(packageJsonPath) && fs.statSync(packageJsonPath).size <= 1024 * 1024) {
                const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                existing.version = pkg.version;
                existing.commands = pkg['monomind']?.commands || existing.commands;
                existing.hooks = pkg['monomind']?.hooks || existing.hooks;
            }
            await this.saveManifest();
            console.log(`[PluginManager] Upgraded ${packageName} to ${existing.version}`);
            return { success: true, plugin: existing };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return { success: false, error: errorMsg };
        }
    }
    // =========================================================================
    // Config
    // =========================================================================
    /**
     * Update plugin config
     */
    async setConfig(packageName, config) {
        if (!this.manifest) {
            await this.initialize();
        }
        if (!isValidPluginKey(packageName)) {
            return { success: false, error: `Invalid package name` };
        }
        const plugin = Object.hasOwn(this.manifest.plugins, packageName)
            ? this.manifest.plugins[packageName]
            : undefined;
        if (!plugin) {
            return { success: false, error: `Plugin ${packageName} is not installed` };
        }
        plugin.config = { ...plugin.config, ...config };
        await this.saveManifest();
        return { success: true };
    }
    /**
     * Get plugins directory path
     */
    getPluginsDir() {
        return this.config.pluginsDir;
    }
    /**
     * Get manifest path
     */
    getManifestPath() {
        return this.config.manifestPath;
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let defaultManager = null;
export function getPluginManager(baseDir) {
    if (!defaultManager) {
        defaultManager = new PluginManager(baseDir);
    }
    else if (baseDir && defaultManager.getPluginsDir() !== path.join(baseDir, '.monomind', 'plugins')) {
        console.warn(`[PluginManager] Warning: getPluginManager called with different baseDir. Using existing instance. Call resetPluginManager() first to change.`);
    }
    return defaultManager;
}
export function resetPluginManager() {
    defaultManager = null;
}
//# sourceMappingURL=manager.js.map
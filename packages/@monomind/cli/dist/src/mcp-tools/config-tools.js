/**
 * Config MCP Tools for CLI
 *
 * Tool definitions for configuration management with file persistence.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from './types.js';
// Storage paths
const STORAGE_DIR = '.monomind';
const CONFIG_FILE = 'config.json';
const DEFAULT_CONFIG = {
    'swarm.topology': 'mesh',
    'swarm.maxAgents': 10,
    'swarm.autoScale': true,
    'memory.persistInterval': 60000,
    'memory.maxEntries': 10000,
    'session.autoSave': true,
    'session.saveInterval': 300000,
    'logging.level': 'info',
    'logging.format': 'json',
    'security.sandboxEnabled': true,
    'security.pathValidation': true,
};
function getConfigDir() {
    return join(getProjectCwd(), STORAGE_DIR);
}
function getConfigPath() {
    return join(getConfigDir(), CONFIG_FILE);
}
function ensureConfigDir() {
    const dir = getConfigDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
}
const MAX_CONFIG_STORE_BYTES = 5 * 1024 * 1024; // 5 MB
function loadConfigStore() {
    try {
        const path = getConfigPath();
        if (existsSync(path)) {
            if (statSync(path).size > MAX_CONFIG_STORE_BYTES) {
                return { values: { ...DEFAULT_CONFIG }, scopes: {}, version: '3.0.0', updatedAt: new Date().toISOString() };
            }
            const data = readFileSync(path, 'utf-8');
            const parsed = JSON.parse(data);
            return {
                values: filterDangerousKeys(parsed.values ?? {}),
                scopes: filterDangerousKeys(parsed.scopes ?? {}),
                version: typeof parsed.version === 'string' ? parsed.version : '3.0.0',
                updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
            };
        }
    }
    catch {
        // Return default store on error
    }
    return {
        values: { ...DEFAULT_CONFIG },
        scopes: {},
        version: '3.0.0',
        updatedAt: new Date().toISOString(),
    };
}
function saveConfigStore(store) {
    ensureConfigDir();
    store.updatedAt = new Date().toISOString();
    const dest = getConfigPath();
    const tmpPath = `${dest}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmpPath, dest);
}
function getNestedValue(obj, key) {
    const parts = key.split('.');
    let current = obj;
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        }
        else {
            return undefined;
        }
    }
    return current;
}
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function filterDangerousKeys(obj, depth = 0) {
    const filtered = {};
    if (depth > 20)
        return filtered;
    for (const [key, value] of Object.entries(obj)) {
        if (!DANGEROUS_KEYS.has(key)) {
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                filtered[key] = filterDangerousKeys(value, depth + 1);
            }
            else {
                filtered[key] = value;
            }
        }
    }
    return filtered;
}
function setNestedValue(obj, key, value) {
    const MAX_NESTING_DEPTH = 10;
    const parts = key.split('.');
    if (parts.length > MAX_NESTING_DEPTH) {
        throw new Error(`Key exceeds maximum nesting depth of ${MAX_NESTING_DEPTH}`);
    }
    for (const part of parts) {
        if (DANGEROUS_KEYS.has(part)) {
            throw new Error(`Dangerous key segment rejected: ${part}`);
        }
    }
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}
export const configTools = [
    {
        name: 'config_get',
        description: 'Get configuration value',
        category: 'config',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Configuration key (dot notation supported)' },
                scope: { type: 'string', description: 'Configuration scope (project, user, system)' },
            },
            required: ['key'],
        },
        handler: async (input) => {
            const store = loadConfigStore();
            const key = input.key;
            const scope = input.scope || 'default';
            let value;
            // Check scope first, then default values
            if (scope !== 'default' && store.scopes[scope]) {
                value = store.scopes[scope][key];
            }
            if (value === undefined) {
                value = store.values[key];
            }
            if (value === undefined) {
                value = DEFAULT_CONFIG[key];
            }
            return {
                key,
                value,
                scope,
                exists: value !== undefined,
                source: value !== undefined ? (store.values[key] !== undefined ? 'stored' : 'default') : 'none',
            };
        },
    },
    {
        name: 'config_set',
        description: 'Set configuration value',
        category: 'config',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Configuration key (dot notation supported)' },
                value: { description: 'Configuration value' },
                scope: { type: 'string', description: 'Configuration scope (project, user, system)' },
            },
            required: ['key', 'value'],
        },
        handler: async (input) => {
            const store = loadConfigStore();
            const key = input.key;
            const value = input.value;
            const scope = input.scope || 'default';
            for (const seg of key.split('.')) {
                if (DANGEROUS_KEYS.has(seg)) {
                    return { success: false, error: `Forbidden key segment: "${seg}"` };
                }
            }
            if (DANGEROUS_KEYS.has(scope)) {
                return { success: false, error: `Forbidden scope: "${scope}"` };
            }
            const previousValue = store.values[key];
            if (scope === 'default') {
                store.values[key] = value;
            }
            else {
                if (!store.scopes[scope]) {
                    store.scopes[scope] = {};
                }
                store.scopes[scope][key] = value;
            }
            saveConfigStore(store);
            return {
                success: true,
                key,
                value,
                previousValue,
                scope,
                path: getConfigPath(),
            };
        },
    },
    {
        name: 'config_list',
        description: 'List configuration values',
        category: 'config',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'string', description: 'Configuration scope' },
                prefix: { type: 'string', description: 'Key prefix filter' },
                includeDefaults: { type: 'boolean', description: 'Include default values' },
            },
        },
        handler: async (input) => {
            const store = loadConfigStore();
            const scope = input.scope || 'default';
            const prefix = input.prefix;
            const includeDefaults = input.includeDefaults !== false;
            // Merge stored values with defaults
            let configs = {};
            if (includeDefaults) {
                configs = { ...DEFAULT_CONFIG };
            }
            // Add stored values
            Object.assign(configs, store.values);
            // Add scope-specific values
            if (scope !== 'default' && store.scopes[scope]) {
                Object.assign(configs, store.scopes[scope]);
            }
            // Filter by prefix
            let entries = Object.entries(configs);
            if (prefix) {
                entries = entries.filter(([key]) => key.startsWith(prefix));
            }
            // Sort by key
            entries.sort(([a], [b]) => a.localeCompare(b));
            return {
                configs: entries.map(([key, value]) => ({
                    key,
                    value,
                    source: store.values[key] !== undefined ? 'stored' : 'default',
                })),
                total: entries.length,
                scope,
                updatedAt: store.updatedAt,
            };
        },
    },
    {
        name: 'config_reset',
        description: 'Reset configuration to defaults',
        category: 'config',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'string', description: 'Configuration scope' },
                key: { type: 'string', description: 'Specific key to reset (omit to reset all)' },
            },
        },
        handler: async (input) => {
            const store = loadConfigStore();
            const scope = input.scope || 'default';
            const key = input.key;
            let resetKeys = [];
            if (key) {
                // Reset specific key
                if (scope === 'default') {
                    if (key in store.values) {
                        delete store.values[key];
                        resetKeys.push(key);
                    }
                }
                else if (store.scopes[scope] && key in store.scopes[scope]) {
                    delete store.scopes[scope][key];
                    resetKeys.push(key);
                }
            }
            else {
                // Reset all keys in scope
                if (scope === 'default') {
                    resetKeys = Object.keys(store.values);
                    store.values = { ...DEFAULT_CONFIG };
                }
                else if (store.scopes[scope]) {
                    resetKeys = Object.keys(store.scopes[scope]);
                    delete store.scopes[scope];
                }
            }
            saveConfigStore(store);
            return {
                success: true,
                scope,
                reset: key || 'all',
                resetKeys,
                count: resetKeys.length,
            };
        },
    },
    {
        name: 'config_export',
        description: 'Export configuration to JSON',
        category: 'config',
        inputSchema: {
            type: 'object',
            properties: {
                scope: { type: 'string', description: 'Configuration scope' },
                includeDefaults: { type: 'boolean', description: 'Include default values' },
            },
        },
        handler: async (input) => {
            const store = loadConfigStore();
            const scope = input.scope || 'default';
            const includeDefaults = input.includeDefaults !== false;
            let exportData = {};
            if (includeDefaults) {
                exportData = { ...DEFAULT_CONFIG };
            }
            Object.assign(exportData, store.values);
            if (scope !== 'default' && store.scopes[scope]) {
                Object.assign(exportData, store.scopes[scope]);
            }
            return {
                config: exportData,
                scope,
                version: store.version,
                exportedAt: new Date().toISOString(),
                count: Object.keys(exportData).length,
            };
        },
    },
    {
        name: 'config_import',
        description: 'Import configuration from JSON',
        category: 'config',
        inputSchema: {
            type: 'object',
            properties: {
                config: { type: 'object', description: 'Configuration object to import' },
                scope: { type: 'string', description: 'Configuration scope' },
                merge: { type: 'boolean', description: 'Merge with existing (true) or replace (false)' },
            },
            required: ['config'],
        },
        handler: async (input) => {
            const store = loadConfigStore();
            const config = filterDangerousKeys(input.config);
            const scope = input.scope || 'default';
            const merge = input.merge !== false;
            const importedKeys = Object.keys(config);
            if (scope === 'default') {
                if (merge) {
                    Object.assign(store.values, config);
                }
                else {
                    store.values = { ...DEFAULT_CONFIG, ...config };
                }
            }
            else {
                if (!store.scopes[scope] || !merge) {
                    store.scopes[scope] = {};
                }
                Object.assign(store.scopes[scope], config);
            }
            saveConfigStore(store);
            return {
                success: true,
                scope,
                imported: importedKeys.length,
                keys: importedKeys,
                merge,
            };
        },
    },
];
//# sourceMappingURL=config-tools.js.map
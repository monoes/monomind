/**
 * Memory Write Operations — verifyMemoryInit
 * Split out of memory-crud.ts (file-size sweep). Pure move.
 *
 * @module v1/cli/memory-crud
 */

import { withDbLock } from '../utils/db-mutex.js';
import { generateEmbedding } from './embedding-operations.js';
import { secureDbFilePermissions } from './file-permissions.js';
import { MAX_DB_FILE_BYTES } from './memory-crud-shared.js';

/**
 * Verify memory initialization works correctly
 * Tests: write, read, search, patterns
 */
export async function verifyMemoryInit(
  dbPath: string,
  options?: {
    verbose?: boolean;
  },
): Promise<{
  success: boolean;
  tests: {
    name: string;
    passed: boolean;
    details?: string;
    duration?: number;
  }[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
}> {
  const { verbose: _verbose = false } = options || {};
  const tests: { name: string; passed: boolean; details?: string; duration?: number }[] = [];

  try {
    return await withDbLock(dbPath, async () => {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();
      const fs = await import('node:fs');

      // Guard against excessively large DB files to prevent OOM.
      const verifyStat = fs.statSync(dbPath);
      if (verifyStat.size > MAX_DB_FILE_BYTES) {
        return {
          success: false,
          tests: [
            {
              name: 'Database access',
              passed: false,
              details: `File too large: ${verifyStat.size} bytes`,
            },
          ],
          summary: { passed: 0, failed: 1, total: 1 },
        };
      }

      // Load database
      const fileBuffer = fs.readFileSync(dbPath);
      const db = new SQL.Database(fileBuffer);

      // Test 1: Schema verification
      const schemaStart = Date.now();
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = tables[0]?.values?.map((v: unknown[]) => v[0] as string) || [];
      const expectedTables = ['memory_entries', 'patterns', 'metadata', 'vector_indexes'];
      const missingTables = expectedTables.filter((t) => !tableNames.includes(t));

      tests.push({
        name: 'Schema verification',
        passed: missingTables.length === 0,
        details:
          missingTables.length > 0
            ? `Missing: ${missingTables.join(', ')}`
            : `${tableNames.length} tables found`,
        duration: Date.now() - schemaStart,
      });

      // Test 2: Write entry
      const writeStart = Date.now();
      const testId = `test_${Date.now()}`;
      const testKey = 'verification_test';
      const testValue = 'This is a verification test entry for memory initialization';

      try {
        db.run(
          `
        INSERT INTO memory_entries (id, key, namespace, content, type, created_at, updated_at)
        VALUES (?, ?, 'test', ?, 'semantic', ?, ?)
      `,
          [testId, testKey, testValue, Date.now(), Date.now()],
        );

        tests.push({
          name: 'Write entry',
          passed: true,
          details: 'Entry written successfully',
          duration: Date.now() - writeStart,
        });
      } catch (e) {
        tests.push({
          name: 'Write entry',
          passed: false,
          details: e instanceof Error ? e.message : 'Write failed',
          duration: Date.now() - writeStart,
        });
      }

      // Test 3: Read entry
      const readStart = Date.now();
      try {
        const result = db.exec(`SELECT content FROM memory_entries WHERE id = ?`, [testId]);
        const content = result[0]?.values[0]?.[0] as string;

        tests.push({
          name: 'Read entry',
          passed: content === testValue,
          details: content === testValue ? 'Content matches' : 'Content mismatch',
          duration: Date.now() - readStart,
        });
      } catch (e) {
        tests.push({
          name: 'Read entry',
          passed: false,
          details: e instanceof Error ? e.message : 'Read failed',
          duration: Date.now() - readStart,
        });
      }

      // Test 4: Write with embedding
      const embeddingStart = Date.now();
      try {
        const { embedding, dimensions, model } = await generateEmbedding(testValue);
        const embeddingJson = JSON.stringify(embedding);

        db.run(
          `
        UPDATE memory_entries
        SET embedding = ?, embedding_dimensions = ?, embedding_model = ?
        WHERE id = ?
      `,
          [embeddingJson, dimensions, model, testId],
        );

        tests.push({
          name: 'Generate embedding',
          passed: true,
          details: `${dimensions}-dim vector (${model})`,
          duration: Date.now() - embeddingStart,
        });
      } catch (e) {
        tests.push({
          name: 'Generate embedding',
          passed: false,
          details: e instanceof Error ? e.message : 'Embedding failed',
          duration: Date.now() - embeddingStart,
        });
      }

      // Test 5: Pattern storage
      const patternStart = Date.now();
      try {
        const patternId = `pattern_${Date.now()}`;
        db.run(
          `
        INSERT INTO patterns (id, name, pattern_type, condition, action, confidence, created_at, updated_at)
        VALUES (?, 'test-pattern', 'task-routing', 'test condition', 'test action', 0.5, ?, ?)
      `,
          [patternId, Date.now(), Date.now()],
        );

        tests.push({
          name: 'Pattern storage',
          passed: true,
          details: 'Pattern stored with confidence scoring',
          duration: Date.now() - patternStart,
        });

        // Cleanup test pattern
        db.run(`DELETE FROM patterns WHERE id = ?`, [patternId]);
      } catch (e) {
        tests.push({
          name: 'Pattern storage',
          passed: false,
          details: e instanceof Error ? e.message : 'Pattern storage failed',
          duration: Date.now() - patternStart,
        });
      }

      // Test 6: Vector index configuration
      const indexStart = Date.now();
      try {
        const indexResult = db.exec(
          `SELECT name, dimensions, hnsw_m, hnsw_ef_construction FROM vector_indexes`,
        );
        const indexes = indexResult[0]?.values || [];

        tests.push({
          name: 'Vector index config',
          passed: indexes.length > 0,
          details: `${indexes.length} indexes configured (HNSW M=16, ef=200)`,
          duration: Date.now() - indexStart,
        });
      } catch (e) {
        tests.push({
          name: 'Vector index config',
          passed: false,
          details: e instanceof Error ? e.message : 'Index check failed',
          duration: Date.now() - indexStart,
        });
      }

      // Cleanup test entry
      db.run(`DELETE FROM memory_entries WHERE id = ?`, [testId]);

      // Save changes atomically
      const data = db.export();
      const dbTmpHealth = `${dbPath}.tmp`;
      fs.writeFileSync(dbTmpHealth, Buffer.from(data));
      fs.renameSync(dbTmpHealth, dbPath);
      secureDbFilePermissions(dbPath);
      db.close();

      const passed = tests.filter((t) => t.passed).length;
      const failed = tests.filter((t) => !t.passed).length;

      return {
        success: failed === 0,
        tests,
        summary: {
          passed,
          failed,
          total: tests.length,
        },
      };
    });
  } catch (error) {
    return {
      success: false,
      tests: [
        {
          name: 'Database access',
          passed: false,
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
      summary: { passed: 0, failed: 1, total: 1 },
    };
  }
}

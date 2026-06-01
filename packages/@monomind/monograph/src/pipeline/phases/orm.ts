import { readFileSync, statSync } from 'fs';
import { extname, basename } from 'path';
import type { PipelinePhase } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { makeId, toNormLabel } from '../../types.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { StructureOutput } from './structure.js';

// ── Output types ──────────────────────────────────────────────────────────────

export interface FieldDef {
  name: string;
  type: string;
  fieldNodeId: string;
}

export interface EntityDef {
  name: string;
  filePath: string;
  fields: FieldDef[];
  entityNodeId: string;
}

export interface OrmOutput {
  entities: EntityDef[];
}

// ── Supported code extensions ─────────────────────────────────────────────────

const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// ── Regex patterns ────────────────────────────────────────────────────────────

/** TypeORM: @Entity() decorator before a class */
const TYPEORM_ENTITY_RE = /@Entity\s*\([^)]*\)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;

/** TypeORM/MikroORM column decorator (matches the decorator line only) */
const TYPEORM_COLUMN_DECORATOR_RE = /@(?:Primary(?:Generated)?Column|Column|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|Property|PrimaryKey|ManyToOne|OneToMany|ManyToMany|OneToOne)\s*\([^)]*\)/g;

/** Property declaration after a TypeORM column decorator */
const TYPEORM_PROP_RE = /(\w+)\s*[!?]?\s*:\s*(\w+)/;

/** Prisma model block: model Name { ... } */
const PRISMA_MODEL_RE = /^model\s+(\w+)\s*\{([^}]+)\}/gm;

/** Prisma field line inside a model block */
const PRISMA_FIELD_RE = /^\s+(\w+)\s+(\w+)/gm;

/** Mongoose: const XxxSchema = new Schema({ */
const MONGOOSE_SCHEMA_RE = /(?:const|let|var)\s+(\w*[Ss]chema)\s*=\s*new\s+(?:\w+\.)?Schema\s*\(\s*\{/g;

/** Mongoose field inside a Schema object: fieldName: { type: SomeType } or fieldName: SomeType */
const MONGOOSE_FIELD_RE = /(\w+)\s*:\s*(?:\{[^}]*type\s*:\s*(\w+)|(\w+))/g;

/** Sequelize: class Foo extends Model (or extends Model.Model) */
const SEQUELIZE_CLASS_RE = /class\s+(\w+)\s+extends\s+(?:\w+\.)?Model\b/g;

/** Sequelize Model.init({ field: ... }, { sequelize }) — capture the first arg block */
const SEQUELIZE_INIT_RE = /(\w+)\.init\s*\(\s*\{/g;

/** Sequelize sequelize.define('ModelName', { ... }) */
const SEQUELIZE_DEFINE_RE = /\.define\s*\(\s*['"](\w+)['"]\s*,\s*\{/g;

/** Sequelize field inside init/define block: fieldName: DataTypes.X or fieldName: { type: DataTypes.X } */
const SEQUELIZE_FIELD_RE = /(\w+)\s*:\s*(?:\{[^}]*type\s*:\s*(?:DataTypes\.)?(\w+)|(?:DataTypes\.)?(\w+))/g;

/** SQLAlchemy: class Foo(Base) or class Foo(db.Model) etc. */
const SQLALCHEMY_CLASS_RE = /class\s+(\w+)\s*\([^)]*Base[^)]*\)/g;

/** SQLAlchemy column: fieldName = Column( */
const SQLALCHEMY_COLUMN_RE = /(\w+)\s*(?::\s*[\w\[\]]+)?\s*=\s*Column\s*\(/g;

// ── Phase ─────────────────────────────────────────────────────────────────────

export const ormPhase: PipelinePhase<OrmOutput> = {
  name: 'orm',
  deps: ['parse', 'structure'],
  async execute(ctx, deps) {
    const { fileNodes } = deps.get('structure') as StructureOutput;
    const entities: EntityDef[] = [];
    const entityNodes: MonographNode[] = [];
    const fieldNodes: MonographNode[] = [];
    const hasFieldEdges: MonographEdge[] = [];

    for (const fileNode of fileNodes) {
      const relPath = fileNode.filePath ?? '';
      const ext = extname(relPath).toLowerCase();
      const fileName = basename(relPath);

      const isPrisma = fileName.endsWith('.prisma');
      const isPython = ext === '.py';
      const isTsJs = TS_JS_EXTENSIONS.has(ext);

      if (!isPrisma && !isPython && !isTsJs) continue;

      const source = safeReadSource(`${ctx.repoPath}/${relPath}`, ctx.options.maxFileSizeBytes);
      if (!source) continue;

      const language = isPrisma ? 'prisma' : isPython ? 'python' : langFromExt(ext);

      if (isPrisma) {
        detectPrismaEntities(source, relPath, language, entities, entityNodes, fieldNodes, hasFieldEdges);
      } else if (isPython) {
        detectSQLAlchemyEntities(source, relPath, language, entities, entityNodes, fieldNodes, hasFieldEdges);
      } else {
        // TypeORM/MikroORM and Mongoose and Sequelize for TS/JS files
        detectTypeOrmEntities(source, relPath, language, entities, entityNodes, fieldNodes, hasFieldEdges);
        detectMongooseEntities(source, relPath, language, entities, entityNodes, fieldNodes, hasFieldEdges);
        detectSequelizeEntities(source, relPath, language, entities, entityNodes, fieldNodes, hasFieldEdges);
      }
    }

    if (ctx.db) {
      insertNodes(ctx.db, entityNodes);
      insertNodes(ctx.db, fieldNodes);
      insertEdges(ctx.db, hasFieldEdges);
    }

    return { entities };
  },
};

// ── Detectors ─────────────────────────────────────────────────────────────────

function detectTypeOrmEntities(
  source: string,
  filePath: string,
  language: string,
  entities: EntityDef[],
  entityNodes: MonographNode[],
  fieldNodes: MonographNode[],
  edges: MonographEdge[],
): void {
  const entityRe = new RegExp(TYPEORM_ENTITY_RE.source, 'g');
  let m: RegExpExecArray | null;

  while ((m = entityRe.exec(source)) !== null) {
    const entityName = m[1];
    const entityNodeId = makeId('entity', entityName + filePath);

    const entityNode: MonographNode = {
      id: entityNodeId,
      label: 'Entity',
      name: entityName,
      normLabel: toNormLabel(entityName),
      filePath,
      startLine: 0,
      endLine: 0,
      isExported: true,
      language,
    };
    entityNodes.push(entityNode);

    const fields: FieldDef[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (TYPEORM_COLUMN_DECORATOR_RE.test(line)) {
        TYPEORM_COLUMN_DECORATOR_RE.lastIndex = 0; // reset after test
        // Look at the next non-empty line for the property declaration
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const propLine = lines[j].trim();
          if (!propLine || propLine.startsWith('@') || propLine.startsWith('//')) continue;
          const pm = TYPEORM_PROP_RE.exec(propLine);
          if (pm) {
            addField(entityName, pm[1], pm[2], filePath, language, entityNodeId, fields, fieldNodes, edges);
          }
          break;
        }
      }
      TYPEORM_COLUMN_DECORATOR_RE.lastIndex = 0; // always reset
    }

    entities.push({ name: entityName, filePath, fields, entityNodeId });
  }
}

function detectPrismaEntities(
  source: string,
  filePath: string,
  language: string,
  entities: EntityDef[],
  entityNodes: MonographNode[],
  fieldNodes: MonographNode[],
  edges: MonographEdge[],
): void {
  const modelRe = new RegExp(PRISMA_MODEL_RE.source, 'gm');
  let m: RegExpExecArray | null;

  while ((m = modelRe.exec(source)) !== null) {
    const entityName = m[1];
    const body = m[2];
    const entityNodeId = makeId('entity', entityName + filePath);

    const entityNode: MonographNode = {
      id: entityNodeId,
      label: 'Entity',
      name: entityName,
      normLabel: toNormLabel(entityName),
      filePath,
      startLine: 0,
      endLine: 0,
      isExported: true,
      language,
    };
    entityNodes.push(entityNode);

    const fields: FieldDef[] = [];
    const fieldRe = new RegExp(PRISMA_FIELD_RE.source, 'gm');
    let fm: RegExpExecArray | null;

    while ((fm = fieldRe.exec(body)) !== null) {
      const fieldName = fm[1];
      const fieldType = fm[2];
      // Skip Prisma keywords
      if (['model', 'enum', 'type', 'datasource', 'generator'].includes(fieldName)) continue;
      addField(entityName, fieldName, fieldType, filePath, language, entityNodeId, fields, fieldNodes, edges);
    }

    entities.push({ name: entityName, filePath, fields, entityNodeId });
  }
}

function detectMongooseEntities(
  source: string,
  filePath: string,
  language: string,
  entities: EntityDef[],
  entityNodes: MonographNode[],
  fieldNodes: MonographNode[],
  edges: MonographEdge[],
): void {
  const schemaRe = new RegExp(MONGOOSE_SCHEMA_RE.source, 'g');
  let m: RegExpExecArray | null;

  while ((m = schemaRe.exec(source)) !== null) {
    const schemaVarName = m[1];
    // Remove 'Schema' suffix to get entity name
    const entityName = schemaVarName.replace(/[Ss]chema$/, '') || schemaVarName;
    const entityNodeId = makeId('entity', entityName + filePath);

    const entityNode: MonographNode = {
      id: entityNodeId,
      label: 'Entity',
      name: entityName,
      normLabel: toNormLabel(entityName),
      filePath,
      startLine: 0,
      endLine: 0,
      isExported: true,
      language,
    };
    entityNodes.push(entityNode);

    // Extract a block after the Schema({ starting point
    const blockStart = m.index + m[0].length;
    const block = extractBraceBlock(source, blockStart - 1, 4000);

    const fields: FieldDef[] = [];
    if (block) {
      const fieldRe = new RegExp(MONGOOSE_FIELD_RE.source, 'g');
      let fm: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((fm = fieldRe.exec(block)) !== null) {
        const fieldName = fm[1];
        const fieldType = fm[2] ?? fm[3] ?? 'Mixed';
        if (seen.has(fieldName)) continue;
        // Skip obvious non-field keys
        if (['type', 'required', 'default', 'ref', 'index', 'unique', 'enum'].includes(fieldName)) continue;
        seen.add(fieldName);
        addField(entityName, fieldName, fieldType, filePath, language, entityNodeId, fields, fieldNodes, edges);
      }
    }

    entities.push({ name: entityName, filePath, fields, entityNodeId });
  }
}

function detectSequelizeEntities(
  source: string,
  filePath: string,
  language: string,
  entities: EntityDef[],
  entityNodes: MonographNode[],
  fieldNodes: MonographNode[],
  edges: MonographEdge[],
): void {
  // Track entity names we've already registered to avoid duplicates.
  const registeredNames = new Set<string>();

  function registerEntity(entityName: string): string {
    const entityNodeId = makeId('entity', entityName + filePath);
    if (registeredNames.has(entityName)) return entityNodeId;
    registeredNames.add(entityName);

    const entityNode: MonographNode = {
      id: entityNodeId,
      label: 'Entity',
      name: entityName,
      normLabel: toNormLabel(entityName),
      filePath,
      startLine: 0,
      endLine: 0,
      isExported: true,
      language,
    };
    entityNodes.push(entityNode);
    return entityNodeId;
  }

  // Collect class names that extend Model so we can match them in .init() calls.
  const modelClasses = new Set<string>();
  const classRe = new RegExp(SEQUELIZE_CLASS_RE.source, 'g');
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(source)) !== null) {
    modelClasses.add(cm[1]);
  }

  // Handle: ClassName.init({ ... }, { sequelize })
  const initRe = new RegExp(SEQUELIZE_INIT_RE.source, 'g');
  let im: RegExpExecArray | null;
  while ((im = initRe.exec(source)) !== null) {
    const candidateName = im[1];
    // Only treat as Sequelize if it's a known Model subclass OR if DataTypes appears in the block.
    const blockStart = im.index + im[0].length - 1; // position of the opening '{'
    const block = extractBraceBlock(source, blockStart, 4000);
    if (!block) continue;
    if (!modelClasses.has(candidateName) && !block.includes('DataTypes')) continue;

    const entityNodeId = registerEntity(candidateName);
    const fields: FieldDef[] = [];
    const fieldRe = new RegExp(SEQUELIZE_FIELD_RE.source, 'g');
    let fm: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((fm = fieldRe.exec(block)) !== null) {
      const fieldName = fm[1];
      const fieldType = fm[2] ?? fm[3] ?? 'DataType';
      if (seen.has(fieldName)) continue;
      if (['type', 'allowNull', 'defaultValue', 'primaryKey', 'unique', 'references'].includes(fieldName)) continue;
      seen.add(fieldName);
      addField(candidateName, fieldName, fieldType, filePath, language, entityNodeId, fields, fieldNodes, edges);
    }
    entities.push({ name: candidateName, filePath, fields, entityNodeId });
  }

  // Handle: sequelize.define('ModelName', { ... })
  const defineRe = new RegExp(SEQUELIZE_DEFINE_RE.source, 'g');
  let dm: RegExpExecArray | null;
  while ((dm = defineRe.exec(source)) !== null) {
    const entityName = dm[1];
    const blockStart = dm.index + dm[0].length - 1;
    const block = extractBraceBlock(source, blockStart, 4000);

    const entityNodeId = registerEntity(entityName);
    const fields: FieldDef[] = [];
    if (block) {
      const fieldRe = new RegExp(SEQUELIZE_FIELD_RE.source, 'g');
      let fm: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((fm = fieldRe.exec(block)) !== null) {
        const fieldName = fm[1];
        const fieldType = fm[2] ?? fm[3] ?? 'DataType';
        if (seen.has(fieldName)) continue;
        if (['type', 'allowNull', 'defaultValue', 'primaryKey', 'unique', 'references'].includes(fieldName)) continue;
        seen.add(fieldName);
        addField(entityName, fieldName, fieldType, filePath, language, entityNodeId, fields, fieldNodes, edges);
      }
    }
    entities.push({ name: entityName, filePath, fields, entityNodeId });
  }
}

function detectSQLAlchemyEntities(
  source: string,
  filePath: string,
  language: string,
  entities: EntityDef[],
  entityNodes: MonographNode[],
  fieldNodes: MonographNode[],
  edges: MonographEdge[],
): void {
  const classRe = new RegExp(SQLALCHEMY_CLASS_RE.source, 'g');
  let m: RegExpExecArray | null;

  while ((m = classRe.exec(source)) !== null) {
    const entityName = m[1];
    const entityNodeId = makeId('entity', entityName + filePath);

    const entityNode: MonographNode = {
      id: entityNodeId,
      label: 'Entity',
      name: entityName,
      normLabel: toNormLabel(entityName),
      filePath,
      startLine: 0,
      endLine: 0,
      isExported: true,
      language,
    };
    entityNodes.push(entityNode);

    const fields: FieldDef[] = [];
    const columnRe = new RegExp(SQLALCHEMY_COLUMN_RE.source, 'g');
    let cm: RegExpExecArray | null;
    while ((cm = columnRe.exec(source)) !== null) {
      const fieldName = cm[1];
      addField(entityName, fieldName, 'Column', filePath, language, entityNodeId, fields, fieldNodes, edges);
    }

    entities.push({ name: entityName, filePath, fields, entityNodeId });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addField(
  entityName: string,
  fieldName: string,
  fieldType: string,
  filePath: string,
  language: string,
  entityNodeId: string,
  fields: FieldDef[],
  fieldNodes: MonographNode[],
  edges: MonographEdge[],
): void {
  const fieldNodeId = makeId('field', entityName + fieldName + filePath);

  const fieldNode: MonographNode = {
    id: fieldNodeId,
    label: 'Field',
    name: fieldName,
    normLabel: toNormLabel(fieldName),
    filePath,
    startLine: 0,
    endLine: 0,
    isExported: false,
    language,
    properties: { declaredType: fieldType },
  };
  fieldNodes.push(fieldNode);

  const edgeId = makeId(entityNodeId, fieldNodeId, 'has_field');
  edges.push({
    id: edgeId,
    sourceId: entityNodeId,
    targetId: fieldNodeId,
    relation: 'HAS_FIELD',
    confidence: 'EXTRACTED',
    confidenceScore: 0.9,
  });

  fields.push({ name: fieldName, type: fieldType, fieldNodeId });
}

/**
 * Extracts a balanced brace block from source starting at the position of the
 * opening `{`. Returns the content between the braces (not including the braces).
 */
function extractBraceBlock(source: string, openPos: number, maxLen: number): string | undefined {
  // Find the opening brace at or after openPos
  let start = source.indexOf('{', openPos);
  if (start === -1) return undefined;

  let depth = 0;
  let i = start;
  const end = Math.min(start + maxLen, source.length);

  for (; i < end; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  // Return partial block if not closed within maxLen
  return source.slice(start + 1, i);
}

function safeReadSource(absPath: string, maxBytes: number): string | undefined {
  try {
    const stat = statSync(absPath);
    if (stat.size > maxBytes) return undefined;
    return readFileSync(absPath, 'utf-8');
  } catch {
    return undefined;
  }
}

function langFromExt(ext: string): string {
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  return 'unknown';
}

import fs from 'fs';
const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.json', '.jsonl', '.sqlite', '.parquet', '.xlsx', '.xls']);
const MAX_INDEX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — skip oversized files
const indexedData = new Map();
// Splits a single CSV/TSV line on `delimiter`, respecting basic RFC 4180 quoting:
// fields starting with `"` are read until the matching closing `"` before the
// delimiter is honored again. Does not handle escaped ("") quotes within a field.
function splitCSVLine(line, delimiter) {
    const fields = [];
    let i = 0;
    while (i <= line.length) {
        if (line[i] === '"') {
            const end = line.indexOf('"', i + 1);
            const closeIdx = end === -1 ? line.length : end;
            fields.push(line.slice(i + 1, closeIdx));
            // advance past the closing quote and the following delimiter (if any)
            const next = line.indexOf(delimiter, closeIdx + 1);
            i = next === -1 ? line.length + 1 : next + 1;
        }
        else {
            const next = line.indexOf(delimiter, i);
            const closeIdx = next === -1 ? line.length : next;
            fields.push(line.slice(i, closeIdx));
            i = next === -1 ? line.length + 1 : next + 1;
        }
    }
    return fields;
}
function parseCSV(content, delimiter = ',') {
    const lines = content.trim().split('\n');
    if (lines.length === 0)
        return { columns: [], rows: [], totalRows: 0 };
    const columns = splitCSVLine(lines[0], delimiter).map((c) => c.trim());
    // Only parse first 3 data rows for samples — avoids wasting CPU on large files
    const sampleLines = lines.slice(1, 4);
    const rows = sampleLines.map((line) => splitCSVLine(line, delimiter).map((c) => c.trim()));
    return { columns, rows, totalRows: lines.length - 1 };
}
function parseJSON(content) {
    try {
        const parsed = JSON.parse(content);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        if (arr.length === 0)
            return { columns: [], rowCount: 0, sampleValues: Object.create(null) };
        const columns = Object.keys(arr[0]).filter(k => k !== '__proto__' && k !== 'constructor' && k !== 'prototype');
        const sampleValues = Object.create(null);
        for (const col of columns) {
            sampleValues[col] = arr.slice(0, 3).map((row) => String(row[col] ?? ''));
        }
        return { columns, rowCount: arr.length, sampleValues };
    }
    catch {
        return { columns: [], rowCount: 0, sampleValues: Object.create(null) };
    }
}
function parseJSONL(content) {
    const lines = content.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0)
        return { columns: [], rowCount: 0, sampleValues: Object.create(null) };
    const rows = [];
    for (const line of lines) {
        try {
            const obj = JSON.parse(line);
            if (obj && typeof obj === 'object' && !Array.isArray(obj))
                rows.push(obj);
        }
        catch {
            // skip malformed lines
        }
    }
    if (rows.length === 0)
        return { columns: [], rowCount: 0, sampleValues: Object.create(null) };
    const columns = Object.keys(rows[0]).filter(k => k !== '__proto__' && k !== 'constructor' && k !== 'prototype');
    const sampleValues = Object.create(null);
    for (const col of columns) {
        sampleValues[col] = rows.slice(0, 3).map(row => String(row[col] ?? ''));
    }
    return { columns, rowCount: rows.length, sampleValues };
}
export const dataCapability = {
    name: 'data',
    detect(scan) {
        return scan.capabilities.data.confidence;
    },
    async activate(_rootDir) {
        indexedData.clear();
    },
    async index(files) {
        let indexed = 0;
        let skipped = 0;
        const errors = [];
        for (const file of files) {
            if (!DATA_EXTENSIONS.has(file.extension)) {
                skipped++;
                continue;
            }
            if (file.size > MAX_INDEX_FILE_SIZE) {
                skipped++;
                continue;
            }
            try {
                let columns = [];
                let rowCount = 0;
                let sampleValues = {};
                if (file.extension === '.csv' || file.extension === '.tsv') {
                    const content = fs.readFileSync(file.absolutePath, 'utf-8');
                    const parsed = parseCSV(content, file.extension === '.tsv' ? '\t' : ',');
                    columns = parsed.columns;
                    rowCount = parsed.totalRows;
                    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
                        sampleValues[columns[colIdx]] = parsed.rows.map((row) => row[colIdx] ?? '');
                    }
                }
                else if (file.extension === '.jsonl') {
                    const content = fs.readFileSync(file.absolutePath, 'utf-8');
                    const parsed = parseJSONL(content);
                    columns = parsed.columns;
                    rowCount = parsed.rowCount;
                    sampleValues = parsed.sampleValues;
                }
                else if (file.extension === '.json') {
                    const content = fs.readFileSync(file.absolutePath, 'utf-8');
                    const parsed = parseJSON(content);
                    columns = parsed.columns;
                    rowCount = parsed.rowCount;
                    sampleValues = parsed.sampleValues;
                }
                else {
                    // .sqlite, .parquet, .xlsx — metadata only (no content extraction without heavy deps)
                    columns = [];
                    rowCount = 0;
                }
                const description = columns.length > 0
                    ? `${file.path}: ${rowCount} rows, columns: ${columns.join(', ')}`
                    : `${file.path}: structured data file`;
                indexedData.set(file.path, { path: file.path, columns, rowCount, sampleValues, description });
                indexed++;
            }
            catch (err) {
                errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return { indexed, skipped, errors };
    },
    async search(query, limit = 20) {
        const queryLower = query.toLowerCase();
        const results = [];
        for (const [dataPath, entry] of indexedData) {
            const descLower = entry.description.toLowerCase();
            const colMatch = entry.columns.some((c) => c.toLowerCase().includes(queryLower));
            const valMatch = Object.values(entry.sampleValues).flat().some((v) => v.toLowerCase().includes(queryLower));
            if (descLower.includes(queryLower) || colMatch || valMatch) {
                results.push({
                    path: dataPath,
                    score: colMatch ? 1.0 : valMatch ? 0.8 : 0.5,
                    snippet: entry.description,
                    type: 'data',
                    metadata: { columns: entry.columns, rowCount: entry.rowCount },
                });
            }
        }
        return results.sort((a, b) => b.score - a.score).slice(0, limit);
    },
};
//# sourceMappingURL=cap-data.js.map
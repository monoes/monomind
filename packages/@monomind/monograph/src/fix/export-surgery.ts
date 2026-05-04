export interface ExportSurgeryResult {
  modified: boolean;
  newContent: string;
  linesRemoved: number;
}

const EXPORT_LIST_RE = /^(\s*)(export\s+)(type\s+)?\{([^}]*)\}(.*)$/;

function findExportSpan(lines: string[], startIdx: number): { startIdx: number; endIdx: number; fullText: string } {
  let text = lines[startIdx];
  let endIdx = startIdx;

  if (!text.includes('{')) {
    return { startIdx, endIdx, fullText: text };
  }

  if (text.includes('}')) {
    return { startIdx, endIdx, fullText: text };
  }

  for (let i = startIdx + 1; i < lines.length; i++) {
    text += '\n' + lines[i];
    endIdx = i;
    if (lines[i].includes('}')) break;
  }

  return { startIdx, endIdx, fullText: text };
}

function removeSpecifierFromList(specifierList: string, exportName: string): string | null {
  const specifiers = specifierList.split(',').map(s => s.trim()).filter(Boolean);

  const filtered = specifiers.filter(spec => {
    const baseName = spec.split(/\s+as\s+/)[0].trim();
    return baseName !== exportName;
  });

  if (filtered.length === specifiers.length) return null;

  return filtered.join(', ');
}

function applySurgery(
  fileContent: string,
  exportName: string,
  line: number,
  expectType: boolean | null,
): ExportSurgeryResult {
  const lines = fileContent.split('\n');
  const idx = line - 1;

  if (idx < 0 || idx >= lines.length) {
    return { modified: false, newContent: fileContent, linesRemoved: 0 };
  }

  const { startIdx, endIdx, fullText } = findExportSpan(lines, idx);

  const singleLineMatch = fullText.replace(/\n/g, ' ').match(EXPORT_LIST_RE);
  if (!singleLineMatch) {
    return { modified: false, newContent: fileContent, linesRemoved: 0 };
  }

  const indent = singleLineMatch[1];
  const exportKw = singleLineMatch[2];
  const typeKw = singleLineMatch[3] ?? '';
  const specifierList = singleLineMatch[4];
  const tail = singleLineMatch[5];

  if (expectType === true && !typeKw) {
    return { modified: false, newContent: fileContent, linesRemoved: 0 };
  }
  if (expectType === false && typeKw) {
    return { modified: false, newContent: fileContent, linesRemoved: 0 };
  }

  const newList = removeSpecifierFromList(specifierList, exportName);

  if (newList === null) {
    return { modified: false, newContent: fileContent, linesRemoved: 0 };
  }

  const spanSize = endIdx - startIdx + 1;
  const newLines = [...lines];

  if (newList.trim() === '') {
    newLines.splice(startIdx, spanSize);
    return {
      modified: true,
      newContent: newLines.join('\n'),
      linesRemoved: spanSize,
    };
  }

  const replacement = `${indent}${exportKw}${typeKw}{ ${newList} }${tail}`;
  newLines.splice(startIdx, spanSize, replacement);
  return {
    modified: true,
    newContent: newLines.join('\n'),
    linesRemoved: spanSize - 1,
  };
}

export function removeNameFromExportList(
  fileContent: string,
  exportName: string,
  line: number,
): ExportSurgeryResult {
  return applySurgery(fileContent, exportName, line, false);
}

export function removeTypeFromExportList(
  fileContent: string,
  exportName: string,
  line: number,
): ExportSurgeryResult {
  return applySurgery(fileContent, exportName, line, true);
}

export function promoteToTypeExport(
  fileContent: string,
  exportName: string,
  line: number,
): ExportSurgeryResult {
  const lines = fileContent.split('\n');
  const idx = line - 1;

  if (idx < 0 || idx >= lines.length) {
    return { modified: false, newContent: fileContent, linesRemoved: 0 };
  }

  const { startIdx, endIdx, fullText } = findExportSpan(lines, idx);

  const normalised = fullText.replace(/\n/g, ' ');
  const match = normalised.match(EXPORT_LIST_RE);
  if (!match || match[3]) {
    return { modified: false, newContent: fileContent, linesRemoved: 0 };
  }

  const indent = match[1];
  const specifierList = match[4];
  const tail = match[5];

  const specifiers = specifierList.split(',').map(s => s.trim()).filter(Boolean);
  const target = specifiers.find(spec => spec.split(/\s+as\s+/)[0].trim() === exportName);
  if (!target) {
    return { modified: false, newContent: fileContent, linesRemoved: 0 };
  }

  const remaining = specifiers.filter(spec => spec.split(/\s+as\s+/)[0].trim() !== exportName);
  const spanSize = endIdx - startIdx + 1;
  const newLines = [...lines];

  const typeExportLine = `${indent}export type { ${target} }`;

  if (remaining.length === 0) {
    newLines.splice(startIdx, spanSize, typeExportLine);
  } else {
    const valueExportLine = `${indent}export { ${remaining.join(', ')} }${tail}`;
    newLines.splice(startIdx, spanSize, valueExportLine, typeExportLine);
  }

  return {
    modified: true,
    newContent: newLines.join('\n'),
    linesRemoved: spanSize - newLines.length + lines.length,
  };
}

export function applyExportSurgeries(
  fileContent: string,
  surgeries: Array<{ exportName: string; line: number; action: 'remove' | 'remove-type' | 'promote-type' }>,
): ExportSurgeryResult {
  const sorted = [...surgeries].sort((a, b) => b.line - a.line);

  let content = fileContent;
  let totalLinesRemoved = 0;
  let anyModified = false;

  for (const surgery of sorted) {
    let result: ExportSurgeryResult;
    if (surgery.action === 'remove') {
      result = removeNameFromExportList(content, surgery.exportName, surgery.line);
    } else if (surgery.action === 'remove-type') {
      result = removeTypeFromExportList(content, surgery.exportName, surgery.line);
    } else {
      result = promoteToTypeExport(content, surgery.exportName, surgery.line);
    }

    if (result.modified) {
      content = result.newContent;
      totalLinesRemoved += result.linesRemoved;
      anyModified = true;
    }
  }

  return { modified: anyModified, newContent: content, linesRemoved: totalLinesRemoved };
}

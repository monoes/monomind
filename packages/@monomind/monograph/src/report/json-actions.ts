export type ActionKind =
  | 'delete-file'
  | 'remove-export'
  | 'remove-export-type'
  | 'export-type'
  | 'remove-dependency'
  | 'remove-dev-dependency'
  | 'add-suppression'
  | 'remove-class-member'
  | 'remove-enum-member';

export interface JsonAction {
  kind: ActionKind;
  filePath: string;
  line?: number;
  col?: number;
  symbol?: string;
  packageName?: string;
  suppressionKind?: string;
}

export interface JsonIssueWithActions<T> {
  issue: T;
  actions: JsonAction[];
  docsUrl?: string;
}

export function makeDeleteFileAction(filePath: string): JsonAction {
  return { kind: 'delete-file', filePath };
}

export function makeRemoveExportAction(
  filePath: string,
  symbol: string,
  line: number,
  col: number,
): JsonAction {
  return { kind: 'remove-export', filePath, symbol, line, col };
}

export function makeExportTypeAction(
  filePath: string,
  symbol: string,
  line: number,
  col: number,
): JsonAction {
  return { kind: 'export-type', filePath, symbol, line, col };
}

export function makeRemoveDependencyAction(packageName: string, isDev: boolean): JsonAction {
  return {
    kind: isDev ? 'remove-dev-dependency' : 'remove-dependency',
    filePath: 'package.json',
    packageName,
  };
}

export function makeAddSuppressionAction(
  filePath: string,
  line: number,
  suppressionKind: string,
): JsonAction {
  return { kind: 'add-suppression', filePath, line, suppressionKind };
}

export function buildDocsUrl(issueKind: string): string {
  const slug = issueKind.toLowerCase().replace(/[_\s]+/g, '-');
  return `https://fallow.dev/docs/configuration#${slug}`;
}

export function buildActionsForUnusedFile(filePath: string): JsonAction[] {
  return [makeDeleteFileAction(filePath)];
}

export function buildActionsForUnusedExport(
  filePath: string,
  exportName: string,
  line: number,
  col: number,
  isTypeOnly: boolean,
): JsonAction[] {
  const removeAction = makeRemoveExportAction(filePath, exportName, line, col);
  if (isTypeOnly) {
    return [removeAction, makeExportTypeAction(filePath, exportName, line, col)];
  }
  return [removeAction];
}

export function buildActionsForUnusedDep(packageName: string, isDev: boolean): JsonAction[] {
  return [makeRemoveDependencyAction(packageName, isDev)];
}

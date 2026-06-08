export type AccessReason = 'read' | 'write';
export interface FieldAccess {
    varName: string;
    field: string;
    reason: AccessReason;
    line: number;
}
export declare function extractFieldAccesses(source: string, varName: string, filePath: string): FieldAccess[];
//# sourceMappingURL=field-access.d.ts.map
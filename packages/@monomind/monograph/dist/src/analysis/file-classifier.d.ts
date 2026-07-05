export type FileType = 'CODE' | 'DOCUMENT' | 'PAPER' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DATA' | 'UNKNOWN';
export declare function classifyFile(pathOrUrl: string): FileType;
export declare function classifyContent(text: string): FileType;
//# sourceMappingURL=file-classifier.d.ts.map
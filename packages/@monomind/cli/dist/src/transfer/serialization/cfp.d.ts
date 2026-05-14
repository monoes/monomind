/**
 * CFP Format Serializer
 * Monomind Pattern format serialization
 */
import type { CFPFormat, SerializationFormat, PatternCollection } from '../types.js';
/**
 * Create a new CFP document
 */
export declare function createCFP(options: {
    name: string;
    description: string;
    patterns: PatternCollection;
    author?: {
        id: string;
        displayName?: string;
    };
    license?: string;
    tags?: string[];
    language?: string;
    framework?: string;
}): CFPFormat;
/**
 * Serialize CFP to JSON string
 */
export declare function serializeToJson(cfp: CFPFormat): string;
/**
 * Serialize CFP to Buffer (for CBOR/binary formats)
 */
export declare function serializeToBuffer(cfp: CFPFormat, format: SerializationFormat): Buffer;
/**
 * Deserialize CFP from string/buffer
 */
export declare function deserializeCFP(data: string | Buffer): CFPFormat;
/**
 * Validate CFP document
 */
export declare function validateCFP(cfp: CFPFormat): {
    valid: boolean;
    errors: string[];
};
/**
 * Get file extension for format
 */
export declare function getFileExtension(format: SerializationFormat): string;
/**
 * Detect format from file path
 */
export declare function detectFormat(filePath: string): SerializationFormat;
//# sourceMappingURL=cfp.d.ts.map
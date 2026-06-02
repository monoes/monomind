declare module 'sql.js' {
  const initSqlJs: (...args: any[]) => Promise<any>;
  export = initSqlJs;
}

declare module '@xenova/transformers' {
  export const pipeline: (...args: any[]) => Promise<any>;
  export const env: any;
  export const AutoTokenizer: any;
  export const AutoModel: any;
  export const CLIPTextModelWithProjection: any;
  export const CLIPVisionModelWithProjection: any;
  export const FeatureExtractionPipeline: any;
}

declare module 'monovector' {
  export const MonoVector: any;
  export const createIndex: (...args: any[]) => any;
  export default any;
}

/**
 * Native @monoes/router bindings (napi).
 * Exports the VectorDb runtime class and DistanceMetric enum. The typed
 * surface is consumed via @monomind interfaces at call sites; this module is
 * a CJS native binding, so it is declared as a record of runtime exports.
 */
declare const router: {
  VectorDb: any;
  DistanceMetric: { Cosine: number; Euclidean: number; DotProduct: number; [k: string]: number };
  [key: string]: any;
};
export = router;

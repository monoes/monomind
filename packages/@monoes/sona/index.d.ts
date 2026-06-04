/**
 * Native @monoes/sona bindings (napi).
 * Exports the SonaEngine runtime class. The typed surface is consumed via
 * @monomind interfaces at call sites; this module is a CJS native binding,
 * so it is declared as a record of runtime exports.
 */
declare const sona: {
  SonaEngine: any;
  [key: string]: any;
};
export = sona;

/**
 * Native @monoes/attention bindings (napi).
 * Exports many runtime symbols (FlashAttention, MoEAttention,
 * DotProductAttention, MultiHeadAttention, HyperbolicAttention,
 * LinearAttention, and more). The typed surface is consumed via @monomind
 * interfaces at call sites; this module is a CJS native binding, so it is
 * declared as a record of runtime exports.
 */
declare const attention: Record<string, any>;
export = attention;

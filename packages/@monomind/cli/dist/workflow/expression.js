"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExpression = resolveExpression;
exports.resolveConfig = resolveConfig;
var TEMPLATE_PATTERN = '\\{\\{([^}]+)\\}\\}';
var cache = new Map();
function extractTemplates(template) {
    if (cache.has(template))
        return cache.get(template);
    // LRU eviction: drop the oldest entry rather than clearing all at once (thundering-herd).
    if (cache.size >= 500) {
        var oldest = cache.keys().next().value;
        if (oldest !== undefined)
            cache.delete(oldest);
    }
    var matches = __spreadArray([], template.matchAll(new RegExp(TEMPLATE_PATTERN, 'g')), true);
    cache.set(template, matches);
    return matches;
}
function resolveExpression(template, item, nodeOutputs, params) {
    var matches = extractTemplates(template);
    if (matches.length === 0)
        return template;
    var result = template;
    for (var _i = 0, matches_1 = matches; _i < matches_1.length; _i++) {
        var match = matches_1[_i];
        var expr = match[1].trim();
        var value = resolveToken(expr, item, nodeOutputs, params);
        result = result.split(match[0]).join(String(value));
    }
    return result;
}
function resolveToken(expr, item, nodeOutputs, params) {
    if (expr.startsWith('$json.')) {
        var key = expr.slice(6);
        if (!(key in item.data))
            throw new Error("Unresolved: $json.".concat(key, " not found in item data"));
        return item.data[key];
    }
    if (expr.startsWith('$env.')) {
        var key = expr.slice(5);
        var val = process.env[key];
        if (val === undefined)
            throw new Error("Unresolved: $env.".concat(key, " not set"));
        return val;
    }
    if (expr.startsWith('params.')) {
        var key = expr.slice(7);
        if (!(key in params))
            throw new Error("Unresolved: params.".concat(key, " not provided"));
        return params[key];
    }
    if (expr.startsWith('$node.') || expr.startsWith('$node["')) {
        var nodeId = void 0;
        var field = void 0;
        if (expr.startsWith('$node["')) {
            // $node["NodeId"].field
            var bracketEnd = expr.indexOf('"].');
            if (bracketEnd === -1)
                throw new Error("Unresolved: malformed $node bracket expression: ".concat(expr));
            nodeId = expr.slice(7, bracketEnd); // slice off '$node["'
            field = expr.slice(bracketEnd + 3); // slice off '"].'
        }
        else {
            // $node.NodeId.field
            var parts = expr.slice(6).split('.');
            nodeId = parts[0];
            field = parts.slice(1).join('.');
        }
        var items = nodeOutputs[nodeId];
        if (!items || items.length === 0)
            throw new Error("Unresolved: $node.".concat(nodeId, " has no output"));
        var val = items[0].data[field];
        if (val === undefined)
            throw new Error("Unresolved: $node.".concat(nodeId, ".").concat(field, " not found"));
        return val;
    }
    // Named ref (e.g. {{box}} from a find step) — action executor resolves these using its element handle map
    return "{{".concat(expr, "}}");
}
// Note: only resolves top-level string values. Nested objects/arrays are passed through unchanged.
function resolveConfig(config, item, nodeOutputs, params) {
    var result = {};
    for (var _i = 0, _a = Object.entries(config); _i < _a.length; _i++) {
        var _b = _a[_i], k = _b[0], v = _b[1];
        result[k] = typeof v === 'string' ? resolveExpression(v, item, nodeOutputs, params) : v;
    }
    return result;
}

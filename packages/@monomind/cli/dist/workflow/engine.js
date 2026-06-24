"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkflow = runWorkflow;
var node_crypto_1 = require("node:crypto");
var expression_js_1 = require("./expression.js");
var server_js_1 = require("../dashboard/server.js");
function runWorkflow(def_1) {
    return __awaiter(this, arguments, void 0, function (def, options) {
        var _a, handlers, _b, onEvent, signal, _c, params, runId, startedAt, controller, dashboard, stopPollTimer, emit, nodeMap, inDegree, outEdges, toEdges, _i, _d, conn, edges, toList, queue, sorted, _e, inDegree_1, _f, id, deg, id, _g, _h, edge, newDeg, nodeOutputs, itemsProcessed, runStatus, runError, _j, sorted_1, nodeId, node, nodeName, t0, inputItems, outputs, err_1, error, completedAt, record;
        var _k, _l, _m, _o, _p, _q, _r;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_s) {
            switch (_s.label) {
                case 0:
                    _a = options.handlers, handlers = _a === void 0 ? new Map() : _a, _b = options.onEvent, onEvent = _b === void 0 ? function () { } : _b, signal = options.signal, _c = options.params, params = _c === void 0 ? {} : _c;
                    runId = (0, node_crypto_1.randomUUID)();
                    startedAt = Date.now();
                    controller = new AbortController();
                    if (signal) {
                        if (signal.aborted) {
                            controller.abort();
                        }
                        else {
                            signal.addEventListener('abort', function () { return controller.abort(); }, { once: true });
                        }
                    }
                    dashboard = (0, server_js_1.getDashboard)();
                    if (dashboard) {
                        stopPollTimer = setInterval(function () {
                            if (dashboard.isStopRequested(runId))
                                controller.abort();
                        }, 500);
                        // Avoid keeping Node.js event loop alive if nothing else is running
                        (_k = stopPollTimer.unref) === null || _k === void 0 ? void 0 : _k.call(stopPollTimer);
                    }
                    emit = function (partial) {
                        return onEvent(__assign({ runId: runId, workflowId: def.id, workflowName: def.name, timestamp: Date.now() }, partial));
                    };
                    emit({ nodeId: '', nodeName: '', eventType: 'run_started' });
                    nodeMap = new Map(def.nodes.map(function (n) { return [n.id, n]; }));
                    inDegree = new Map(def.nodes.map(function (n) { return [n.id, 0]; }));
                    outEdges = new Map();
                    toEdges = new Map();
                    for (_i = 0, _d = def.connections; _i < _d.length; _i++) {
                        conn = _d[_i];
                        inDegree.set(conn.to, ((_l = inDegree.get(conn.to)) !== null && _l !== void 0 ? _l : 0) + 1);
                        edges = (_m = outEdges.get(conn.from)) !== null && _m !== void 0 ? _m : [];
                        edges.push({ to: conn.to, handle: conn.handle });
                        outEdges.set(conn.from, edges);
                        toList = (_o = toEdges.get(conn.to)) !== null && _o !== void 0 ? _o : [];
                        toList.push({ from: conn.from, handle: conn.handle });
                        toEdges.set(conn.to, toList);
                    }
                    queue = [];
                    sorted = [];
                    for (_e = 0, inDegree_1 = inDegree; _e < inDegree_1.length; _e++) {
                        _f = inDegree_1[_e], id = _f[0], deg = _f[1];
                        if (deg === 0)
                            queue.push(id);
                    }
                    while (queue.length > 0) {
                        id = queue.shift();
                        sorted.push(id);
                        for (_g = 0, _h = (_p = outEdges.get(id)) !== null && _p !== void 0 ? _p : []; _g < _h.length; _g++) {
                            edge = _h[_g];
                            newDeg = ((_q = inDegree.get(edge.to)) !== null && _q !== void 0 ? _q : 0) - 1;
                            inDegree.set(edge.to, newDeg);
                            if (newDeg === 0)
                                queue.push(edge.to);
                        }
                    }
                    if (sorted.length !== def.nodes.length) {
                        throw new Error('Workflow contains a cycle');
                    }
                    nodeOutputs = new Map();
                    itemsProcessed = 0;
                    runStatus = 'completed';
                    _s.label = 1;
                case 1:
                    _s.trys.push([1, , 8, 9]);
                    _j = 0, sorted_1 = sorted;
                    _s.label = 2;
                case 2:
                    if (!(_j < sorted_1.length)) return [3 /*break*/, 7];
                    nodeId = sorted_1[_j];
                    if (controller.signal.aborted) {
                        runStatus = 'stopped';
                        emit({ nodeId: nodeId, nodeName: nodeId, eventType: 'run_stopped' });
                        return [3 /*break*/, 7];
                    }
                    node = nodeMap.get(nodeId);
                    nodeName = (_r = node.name) !== null && _r !== void 0 ? _r : node.id;
                    t0 = Date.now();
                    inputItems = collectInputs(nodeId, nodeOutputs, toEdges);
                    emit({ nodeId: nodeId, nodeName: nodeName, eventType: 'step_started', itemTotal: inputItems.length });
                    _s.label = 3;
                case 3:
                    _s.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, executeNode(node, inputItems, handlers, nodeOutputs, params)];
                case 4:
                    outputs = _s.sent();
                    nodeOutputs.set(nodeId, outputs);
                    itemsProcessed += outputs.length;
                    emit({ nodeId: nodeId, nodeName: nodeName, eventType: 'step_completed', durationMs: Date.now() - t0, itemTotal: outputs.length });
                    return [3 /*break*/, 6];
                case 5:
                    err_1 = _s.sent();
                    error = err_1 instanceof Error ? err_1.message : String(err_1);
                    emit({ nodeId: nodeId, nodeName: nodeName, eventType: 'step_failed', error: error, durationMs: Date.now() - t0 });
                    if (node.onError === 'skip') {
                        nodeOutputs.set(nodeId, []);
                    }
                    else {
                        runStatus = 'failed';
                        runError = error;
                        return [3 /*break*/, 7];
                    }
                    return [3 /*break*/, 6];
                case 6:
                    _j++;
                    return [3 /*break*/, 2];
                case 7: return [3 /*break*/, 9];
                case 8:
                    if (stopPollTimer !== undefined)
                        clearInterval(stopPollTimer);
                    return [7 /*endfinally*/];
                case 9:
                    completedAt = Date.now();
                    record = {
                        id: runId,
                        workflowId: def.id,
                        workflowName: def.name,
                        status: runStatus,
                        startedAt: startedAt,
                        completedAt: completedAt,
                        itemsProcessed: itemsProcessed,
                        itemsTotal: itemsProcessed,
                        error: runError,
                    };
                    emit({ nodeId: '', nodeName: '', eventType: runStatus === 'completed' ? 'run_completed' : 'run_stopped', error: runError });
                    return [2 /*return*/, record];
            }
        });
    });
}
function collectInputs(nodeId, nodeOutputs, toEdges) {
    var _a;
    var predecessors = (_a = toEdges.get(nodeId)) !== null && _a !== void 0 ? _a : [];
    if (predecessors.length === 0)
        return [{ data: {} }];
    return predecessors.flatMap(function (_a) {
        var _b;
        var from = _a.from, handle = _a.handle;
        var items = (_b = nodeOutputs.get(from)) !== null && _b !== void 0 ? _b : [];
        if (handle === 'true')
            return items.filter(function (item) { return item.data['__ifResult'] === true; });
        if (handle === 'false')
            return items.filter(function (item) { return item.data['__ifResult'] === false; });
        return items;
    });
}
function executeNode(node, inputs, handlers, nodeOutputs, params) {
    return __awaiter(this, void 0, void 0, function () {
        var allOutputs, type, config, items, predicate_1, predicate_2, handler, resolvedConfig;
        var _a;
        return __generator(this, function (_b) {
            allOutputs = Object.fromEntries(nodeOutputs);
            type = node.type, config = node.config;
            if (type === 'trigger.manual') {
                items = config['items'];
                if (Array.isArray(items))
                    return [2 /*return*/, items];
                return [2 /*return*/, inputs];
            }
            if (type === 'core.set') {
                return [2 /*return*/, inputs.map(function (item) {
                        var resolved = (0, expression_js_1.resolveConfig)(config, item, allOutputs, params);
                        return __assign(__assign({}, item), { data: __assign(__assign({}, item.data), resolved) });
                    })];
            }
            if (type === 'core.filter') {
                predicate_1 = config['expression'];
                return [2 /*return*/, inputs.filter(function (item) {
                        try {
                            return Boolean((0, expression_js_1.resolveExpression)(predicate_1, item, allOutputs, params));
                        }
                        catch (_a) {
                            return false;
                        }
                    })];
            }
            if (type === 'core.if') {
                predicate_2 = config['expression'];
                return [2 /*return*/, inputs.map(function (item) {
                        var result = Boolean((0, expression_js_1.resolveExpression)(predicate_2, item, allOutputs, params));
                        return __assign(__assign({}, item), { data: __assign(__assign({}, item.data), { __ifResult: result }) });
                    })];
            }
            handler = handlers.get(type);
            if (!handler)
                throw new Error("No handler registered for node type: ".concat(type));
            resolvedConfig = (0, expression_js_1.resolveConfig)(config, (_a = inputs[0]) !== null && _a !== void 0 ? _a : { data: {} }, allOutputs, params);
            return [2 /*return*/, handler(inputs, resolvedConfig)];
        });
    });
}

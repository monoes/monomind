"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDashboard = startDashboard;
exports.getDashboard = getDashboard;
var node_http_1 = require("node:http");
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var node_url_1 = require("node:url");
var node_module_1 = require("node:module");
var _require = (0, node_module_1.createRequire)(import.meta.url);
var __dirname = (0, node_path_1.dirname)((0, node_url_1.fileURLToPath)(import.meta.url));
var DEFAULT_PORT = parseInt((_a = process.env['MONOBROWSE_DASHBOARD_PORT']) !== null && _a !== void 0 ? _a : '4242', 10);
var MAX_RUN_HISTORY = 50;
var instance = null;
function startDashboard(port) {
    var _a;
    if (port === void 0) { port = DEFAULT_PORT; }
    if (instance)
        return instance;
    var runHistory = [];
    var stopRequests = new Set();
    var clients = new Set(); // WebSocket or SSE response
    // Try to load ws, fall back to SSE
    var WebSocketServer = null;
    try {
        var wsModule = _require('ws');
        WebSocketServer = (_a = wsModule.WebSocketServer) !== null && _a !== void 0 ? _a : wsModule.Server;
    }
    catch (_b) {
        // ws not available — fall back to SSE
    }
    // ui.html must be copied to dist/ alongside server.js during build
    var uiHtml;
    try {
        uiHtml = (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, 'ui.html'), 'utf-8');
    }
    catch (_c) {
        uiHtml = "<!DOCTYPE html><html><head><title>monobrowse dashboard</title></head><body style=\"background:#0f0f1a;color:#ccc;font-family:system-ui;padding:20px\"><h1>monobrowse dashboard</h1><p>Dashboard UI not found. Run the build to include ui.html.</p><script>const es=new EventSource('/events');es.onmessage=e=>console.log(JSON.parse(e.data));</script></body></html>";
    }
    var server = (0, node_http_1.createServer)(function (req, res) {
        var _a;
        var url = (_a = req.url) !== null && _a !== void 0 ? _a : '/';
        if (url === '/' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(uiHtml);
            return;
        }
        if (url === '/runs' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(runHistory));
            return;
        }
        if (url.startsWith('/stop/') && req.method === 'POST') {
            var runId = url.slice(6);
            stopRequests.add(runId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, runId: runId }));
            return;
        }
        if (url === '/events' && (req.method === 'GET' || req.method === 'HEAD') && !WebSocketServer) {
            // SSE endpoint (fallback when ws not available).
            // No CORS header — the dashboard is served from 127.0.0.1:4242 and no cross-origin
            // access is needed. A wildcard ACAO would let any web page subscribe to workflow events.
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.write("data: ".concat(JSON.stringify({ type: 'connected' }), "\n\n"));
            clients.add(res);
            req.on('close', function () { return clients.delete(res); });
            return;
        }
        res.writeHead(404);
        res.end('Not found');
    });
    if (WebSocketServer) {
        var wss = new WebSocketServer({ server: server });
        wss.on('connection', function (ws) {
            clients.add(ws);
            ws.send(JSON.stringify({ type: 'history', runs: runHistory }));
            ws.on('close', function () { return clients.delete(ws); });
        });
    }
    server.on('error', function (err) {
        if (err.code === 'EADDRINUSE') {
            console.error("Dashboard port ".concat(port, " is already in use. Set MONOBROWSE_DASHBOARD_PORT to use a different port."));
        }
        else {
            console.error("Dashboard server error: ".concat(err.message));
        }
        instance = null;
        process.exit(1);
    });
    server.listen(port, '127.0.0.1');
    function broadcast(event) {
        var msg = JSON.stringify(event);
        for (var _i = 0, clients_1 = clients; _i < clients_1.length; _i++) {
            var client = clients_1[_i];
            try {
                if (typeof client.send === 'function') {
                    client.send(msg); // WebSocket
                }
                else {
                    client.write("data: ".concat(msg, "\n\n")); // SSE
                }
            }
            catch (_a) {
                clients.delete(client);
            }
        }
    }
    function addRunRecord(record) {
        var idx = runHistory.findIndex(function (r) { return r.id === record.id; });
        if (idx >= 0) {
            runHistory[idx] = record;
        }
        else {
            runHistory.unshift(record);
            if (runHistory.length > MAX_RUN_HISTORY)
                runHistory.pop();
        }
    }
    function isStopRequested(runId) {
        return stopRequests.has(runId);
    }
    function close() {
        server.close();
        instance = null;
    }
    instance = { broadcast: broadcast, addRunRecord: addRunRecord, isStopRequested: isStopRequested, close: close, port: port };
    return instance;
}
function getDashboard() {
    return instance;
}

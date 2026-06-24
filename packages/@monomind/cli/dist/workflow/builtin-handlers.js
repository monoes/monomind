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
exports.createBuiltinHandlers = createBuiltinHandlers;
// Built-in node handlers registered for every `browse workflow run` invocation.
//
// action.http         — fetch a URL (GET/POST/etc.) and put the response in item.data
// action.save_file    — write item data or binaryBase64 to a file on disk
// action.log          — console.log each item (useful for debugging workflows)
// action.gemini_image — generate image via Gemini web app (browser automation on port 9222)
//                       or Imagen REST API (GEMINI_API_KEY), or mock mode
var promises_1 = require("node:fs/promises");
var node_path_1 = require("node:path");
var node_child_process_1 = require("node:child_process");
// Call npx monomind browse <args> and return stdout. Never throws.
function browseCmd(args, timeoutMs) {
    if (timeoutMs === void 0) { timeoutMs = 30000; }
    try {
        return (0, node_child_process_1.execFileSync)('npx', __spreadArray(['monomind', 'browse'], args, true), {
            encoding: 'utf8',
            timeout: timeoutMs,
            env: __assign({}, process.env),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    }
    catch (_a) {
        return '';
    }
}
// Generate an image using the Gemini web app on the user's authenticated Chrome (CDP port 9222).
// Returns the saved file path on success, null if not available.
function generateViaGeminiBrowser(prompt, outputPath, cdpPort) {
    return __awaiter(this, void 0, void 0, function () {
        var connectOut, snap, waitOut, imgSrcRaw, resp, buf, _a, _b, _c, screenshotPath;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    connectOut = browseCmd(['connect', '--port', String(cdpPort)], 8000);
                    if (!connectOut.includes('[OK]'))
                        return [2 /*return*/, null];
                    // Navigate to Gemini image generation UI
                    browseCmd(['open', 'https://gemini.google.com/app'], 15000);
                    browseCmd(['wait', '--load', 'domcontentloaded', '--timeout', '10000'], 12000);
                    snap = browseCmd(['snapshot', '-i'], 10000);
                    if (snap.includes('Accept all')) {
                        browseCmd(['find', 'role', 'button', '--name', 'Accept all', 'click'], 5000);
                        browseCmd(['wait', '--ms', '1500'], 5000);
                    }
                    // Type the prompt into the Gemini rich-text editor (.ql-editor)
                    browseCmd(['find', 'selector', '.ql-editor', 'click'], 5000);
                    browseCmd(['press', 'Control+a'], 3000);
                    // fill args are passed directly (no shell escaping needed)
                    browseCmd(['find', 'selector', '.ql-editor', 'fill', prompt], 10000);
                    browseCmd(['wait', '--ms', '300'], 2000);
                    browseCmd(['press', 'Enter'], 3000);
                    console.log("[action.gemini_image] Submitted prompt to Gemini, waiting for image generation...");
                    waitOut = browseCmd(['wait', '--fn', "\n      (() => {\n        const imgs = Array.from(document.querySelectorAll('img'));\n        return imgs.some(img =>\n          img.complete && img.naturalWidth > 200 && img.naturalHeight > 200 &&\n          img.src && !img.src.includes('icon') && !img.src.includes('avatar') &&\n          !img.src.includes('logo') && !img.src.includes('profile')\n        );\n      })()\n    ", '--timeout', '90000'], 95000);
                    return [4 /*yield*/, (0, promises_1.mkdir)((0, node_path_1.dirname)(outputPath), { recursive: true })];
                case 1:
                    _d.sent();
                    imgSrcRaw = browseCmd(['eval', "\n    (() => {\n      const imgs = Array.from(document.querySelectorAll('img'));\n      const c = imgs.filter(img =>\n        img.complete && img.naturalWidth > 200 && img.naturalHeight > 200 &&\n        img.src && !img.src.includes('icon') && !img.src.includes('avatar') &&\n        !img.src.includes('logo') && !img.src.includes('profile')\n      );\n      return c.length ? c[c.length - 1].src : '';\n    })()\n  "], 10000).trim();
                    if (!(imgSrcRaw && (imgSrcRaw.startsWith('https://') || imgSrcRaw.startsWith('http://')))) return [3 /*break*/, 8];
                    _d.label = 2;
                case 2:
                    _d.trys.push([2, 7, , 8]);
                    return [4 /*yield*/, fetch(imgSrcRaw)];
                case 3:
                    resp = _d.sent();
                    if (!resp.ok) return [3 /*break*/, 6];
                    _b = (_a = Buffer).from;
                    return [4 /*yield*/, resp.arrayBuffer()];
                case 4:
                    buf = _b.apply(_a, [_d.sent()]);
                    return [4 /*yield*/, (0, promises_1.writeFile)(outputPath, buf)];
                case 5:
                    _d.sent();
                    console.log("[action.gemini_image] Image downloaded from Gemini \u2192 ".concat(outputPath));
                    return [2 /*return*/, outputPath];
                case 6: return [3 /*break*/, 8];
                case 7:
                    _c = _d.sent();
                    return [3 /*break*/, 8];
                case 8:
                    screenshotPath = outputPath.replace(/\.(png|jpe?g|webp)$/i, '') + '-screenshot.png';
                    browseCmd(['screenshot', '--full', screenshotPath], 10000);
                    if (waitOut.includes('[OK]') || imgSrcRaw) {
                        console.log("[action.gemini_image] Saved Gemini screenshot \u2192 ".concat(screenshotPath));
                        return [2 /*return*/, screenshotPath];
                    }
                    return [2 /*return*/, null];
            }
        });
    });
}
function createBuiltinHandlers() {
    var _this = this;
    var handlers = new Map();
    // action.http
    // config: { url, method?, headers?, body?, responseField? }
    // Puts { statusCode, body, json? } into item.data[responseField ?? 'response']
    handlers.set('action.http', function (items, config) { return __awaiter(_this, void 0, void 0, function () {
        var url, method, headers, body, responseField, res, text, json;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    url = String((_a = config['url']) !== null && _a !== void 0 ? _a : '');
                    method = String((_b = config['method']) !== null && _b !== void 0 ? _b : 'GET').toUpperCase();
                    headers = (_c = config['headers']) !== null && _c !== void 0 ? _c : {};
                    body = config['body'] !== undefined ? JSON.stringify(config['body']) : undefined;
                    responseField = String((_d = config['responseField']) !== null && _d !== void 0 ? _d : 'response');
                    return [4 /*yield*/, fetch(url, {
                            method: method,
                            headers: __assign({ 'Content-Type': 'application/json' }, headers),
                            body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
                        })];
                case 1:
                    res = _e.sent();
                    return [4 /*yield*/, res.text()];
                case 2:
                    text = _e.sent();
                    try {
                        json = JSON.parse(text);
                    }
                    catch ( /* not JSON */_f) { /* not JSON */ }
                    return [2 /*return*/, items.map(function (item) {
                            var _a;
                            return (__assign(__assign({}, item), { data: __assign(__assign({}, item.data), (_a = {}, _a[responseField] = { statusCode: res.status, body: text, json: json }, _a)) }));
                        })];
            }
        });
    }); });
    // action.save_file
    // config: { path, content?, field?, encoding? }
    // Writes item.data[field] (or binaryBase64 decoded) to disk
    handlers.set('action.save_file', function (items, config) { return __awaiter(_this, void 0, void 0, function () {
        var results, _i, items_1, item, outPath, field, encoding, content;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    results = [];
                    _i = 0, items_1 = items;
                    _e.label = 1;
                case 1:
                    if (!(_i < items_1.length)) return [3 /*break*/, 8];
                    item = items_1[_i];
                    outPath = String((_a = config['path']) !== null && _a !== void 0 ? _a : './output.txt');
                    field = config['field'];
                    encoding = String((_b = config['encoding']) !== null && _b !== void 0 ? _b : 'utf8');
                    return [4 /*yield*/, (0, promises_1.mkdir)((0, node_path_1.dirname)(outPath), { recursive: true })];
                case 2:
                    _e.sent();
                    if (!item.binaryBase64) return [3 /*break*/, 4];
                    return [4 /*yield*/, (0, promises_1.writeFile)(outPath, Buffer.from(item.binaryBase64, 'base64'))];
                case 3:
                    _e.sent();
                    return [3 /*break*/, 6];
                case 4:
                    content = field
                        ? JSON.stringify((_c = item.data[field]) !== null && _c !== void 0 ? _c : '', null, 2)
                        : ((_d = config['content']) !== null && _d !== void 0 ? _d : JSON.stringify(item.data, null, 2));
                    return [4 /*yield*/, (0, promises_1.writeFile)(outPath, content, encoding)];
                case 5:
                    _e.sent();
                    _e.label = 6;
                case 6:
                    results.push(__assign(__assign({}, item), { data: __assign(__assign({}, item.data), { savedPath: outPath }) }));
                    _e.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 1];
                case 8: return [2 /*return*/, results];
            }
        });
    }); });
    // action.log
    // config: { label? }
    handlers.set('action.log', function (items, config) { return __awaiter(_this, void 0, void 0, function () {
        var label, _i, items_2, item;
        var _a;
        return __generator(this, function (_b) {
            label = String((_a = config['label']) !== null && _a !== void 0 ? _a : 'action.log');
            for (_i = 0, items_2 = items; _i < items_2.length; _i++) {
                item = items_2[_i];
                console.log("[".concat(label, "]"), JSON.stringify(item.data, null, 2));
            }
            return [2 /*return*/, items];
        });
    }); });
    // action.gemini_image
    // config: { prompt, cdpPort?, outputPath?, apiKey?, model?, aspectRatio? }
    // Priority: (1) Gemini web browser via CDP port 9222, (2) Imagen REST API, (3) mock
    handlers.set('action.gemini_image', function (items, config) { return __awaiter(_this, void 0, void 0, function () {
        var cdpPort, apiKey, model, aspectRatio, outputPath, results, _i, items_3, item, prompt_1, filePath, browserPath, url, res, _a, _b, _c, data, prediction;
        var _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        return __generator(this, function (_q) {
            switch (_q.label) {
                case 0:
                    cdpPort = Number((_e = (_d = config['cdpPort']) !== null && _d !== void 0 ? _d : process.env['GEMINI_CDP_PORT']) !== null && _e !== void 0 ? _e : 9222);
                    apiKey = String((_h = (_g = (_f = config['apiKey']) !== null && _f !== void 0 ? _f : process.env['GEMINI_API_KEY']) !== null && _g !== void 0 ? _g : process.env['GOOGLE_API_KEY']) !== null && _h !== void 0 ? _h : '');
                    model = String((_j = config['model']) !== null && _j !== void 0 ? _j : 'imagen-3.0-generate-001');
                    aspectRatio = String((_k = config['aspectRatio']) !== null && _k !== void 0 ? _k : '1:1');
                    outputPath = config['outputPath'];
                    results = [];
                    _i = 0, items_3 = items;
                    _q.label = 1;
                case 1:
                    if (!(_i < items_3.length)) return [3 /*break*/, 11];
                    item = items_3[_i];
                    prompt_1 = String((_m = (_l = config['prompt']) !== null && _l !== void 0 ? _l : item.data['prompt']) !== null && _m !== void 0 ? _m : '');
                    filePath = outputPath !== null && outputPath !== void 0 ? outputPath : "./output/gemini-image-".concat(Date.now(), ".png");
                    return [4 /*yield*/, generateViaGeminiBrowser(prompt_1, filePath, cdpPort)];
                case 2:
                    browserPath = _q.sent();
                    if (browserPath) {
                        results.push(__assign(__assign({}, item), { data: __assign(__assign({}, item.data), { prompt: prompt_1, generatedImagePath: browserPath, source: 'gemini-browser' }) }));
                        return [3 /*break*/, 10];
                    }
                    if (!apiKey) return [3 /*break*/, 9];
                    console.log("[action.gemini_image] Browser unavailable \u2014 trying Imagen REST API");
                    url = "https://generativelanguage.googleapis.com/v1beta/models/".concat(model, ":predict?key=").concat(apiKey);
                    return [4 /*yield*/, fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                instances: [{ prompt: prompt_1 }],
                                parameters: { sampleCount: 1, aspectRatio: aspectRatio },
                            }),
                        })];
                case 3:
                    res = _q.sent();
                    if (!!res.ok) return [3 /*break*/, 5];
                    _a = Error.bind;
                    _c = (_b = "Gemini Imagen API error ".concat(res.status, ": ")).concat;
                    return [4 /*yield*/, res.text()];
                case 4: throw new (_a.apply(Error, [void 0, _c.apply(_b, [_q.sent()])]))();
                case 5: return [4 /*yield*/, res.json()];
                case 6:
                    data = _q.sent();
                    prediction = (_o = data.predictions) === null || _o === void 0 ? void 0 : _o[0];
                    if (!(prediction === null || prediction === void 0 ? void 0 : prediction.bytesBase64Encoded))
                        throw new Error('No image data in Gemini response');
                    return [4 /*yield*/, (0, promises_1.mkdir)((0, node_path_1.dirname)(filePath), { recursive: true })];
                case 7:
                    _q.sent();
                    return [4 /*yield*/, (0, promises_1.writeFile)(filePath, Buffer.from(prediction.bytesBase64Encoded, 'base64'))];
                case 8:
                    _q.sent();
                    results.push(__assign(__assign({}, item), { data: __assign(__assign({}, item.data), { prompt: prompt_1, generatedImagePath: filePath, mimeType: (_p = prediction.mimeType) !== null && _p !== void 0 ? _p : 'image/png', source: 'gemini-api' }), binaryBase64: prediction.bytesBase64Encoded }));
                    return [3 /*break*/, 10];
                case 9:
                    // Priority 3: Mock mode — no browser on port 9222 and no API key
                    console.log("[action.gemini_image] No browser on port ".concat(cdpPort, " and no API key \u2014 mock mode."));
                    console.log("  Prompt: \"".concat(prompt_1, "\""));
                    results.push(__assign(__assign({}, item), { data: __assign(__assign({}, item.data), { prompt: prompt_1, mockMode: true, note: "Set GEMINI_CDP_PORT env var (default: 9222) for browser mode, or GEMINI_API_KEY for REST API" }) }));
                    _q.label = 10;
                case 10:
                    _i++;
                    return [3 /*break*/, 1];
                case 11: return [2 /*return*/, results];
            }
        });
    }); });
    return handlers;
}

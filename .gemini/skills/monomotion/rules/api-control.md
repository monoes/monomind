# API-Driven Animation Control

## Pattern: Central Animation Registry

Expose timelines through a registry so any control surface can drive them.

```js
// animation-registry.js
const registry = new Map();

export function register(name, timeline) {
  registry.set(name, timeline);
}

export function control(name, action, value) {
  const tl = registry.get(name);
  if (!tl) return { error: `unknown timeline: ${name}` };

  switch (action) {
    case "play":     tl.play(); break;
    case "pause":    tl.pause(); break;
    case "reverse":  tl.reverse(); break;
    case "restart":  tl.restart(); break;
    case "seek":     tl.seek(Number(value)); break;
    case "progress": tl.progress(Number(value)); break;
    case "speed":    tl.timeScale(Number(value)); break;
    case "label":    tl.seek(value); break;
  }

  return { time: tl.time(), progress: tl.progress(), paused: tl.paused() };
}

export function state(name) {
  const tl = registry.get(name);
  if (!tl) return null;
  return { time: tl.time(), progress: tl.progress(), duration: tl.duration(), paused: tl.paused() };
}
```

## WebSocket Control Server (Node.js)

```js
// server.js
import { WebSocketServer } from "ws";
import { control, state } from "./animation-registry.js";

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    const { timeline, action, value } = JSON.parse(raw);
    const result = control(timeline, action, value);
    ws.send(JSON.stringify(result));
  });
});
```

```js
// browser — connect and drive animations
const ws = new WebSocket("ws://localhost:8080");

function send(timeline, action, value) {
  ws.send(JSON.stringify({ timeline, action, value }));
}

send("intro", "play");
send("intro", "seek", 1.5);
send("outro", "reverse");
```

## REST Control Endpoint (Express)

```js
import express from "express";
import { control, state } from "./animation-registry.js";

const app = express();
app.use(express.json());

// POST /animation/:name/:action
app.post("/animation/:name/:action", (req, res) => {
  const result = control(req.params.name, req.params.action, req.body.value);
  res.json(result);
});

// GET /animation/:name
app.get("/animation/:name", (req, res) => {
  res.json(state(req.params.name));
});

app.listen(3000);
```

```bash
# Drive from CLI
curl -X POST http://localhost:3000/animation/intro/play
curl -X POST http://localhost:3000/animation/intro/seek -d '{"value":1.5}' -H 'Content-Type: application/json'
curl http://localhost:3000/animation/intro
```

## SSE — Push State to Browser

```js
// server: broadcast state on every animation tick
app.get("/animation/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  const interval = setInterval(() => {
    const s = state("intro");
    res.write(`data: ${JSON.stringify(s)}\n\n`);
  }, 50); // 20fps state stream

  req.on("close", () => clearInterval(interval));
});
```

```js
// browser: receive state stream
const es = new EventSource("/animation/stream");
es.onmessage = ({ data }) => {
  const { progress } = JSON.parse(data);
  document.querySelector(".progress-bar").style.width = `${progress * 100}%`;
};
```

## Keyboard Control

```js
document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case " ":  tl.paused() ? tl.resume() : tl.pause(); break;
    case "ArrowRight": tl.seek(tl.time() + 0.5); break;
    case "ArrowLeft":  tl.seek(Math.max(0, tl.time() - 0.5)); break;
    case "r":  tl.restart(); break;
    case "0":  tl.seek(0); break;
  }
});
```

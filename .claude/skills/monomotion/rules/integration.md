# Integration Patterns

## Vanilla HTML Drop-In

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    .box { width: 80px; height: 80px; background: #6366f1; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="box"></div>
  <button id="play">Play</button>
  <button id="pause">Pause</button>

  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to(".box", { x: 300, rotation: 360, duration: 1, ease: "power2.inOut" })
      .to(".box", { x: 0, rotation: 0, duration: 1, ease: "power2.inOut" });

    document.getElementById("play").onclick  = () => tl.play();
    document.getElementById("pause").onclick = () => tl.pause();
  </script>
</body>
</html>
```

## Embedding in an iframe

The parent page controls the animation inside the iframe:

```js
// In the iframe page — expose controls on window
window.monomotion = {
  play:     (name) => registry.control(name, "play"),
  pause:    (name) => registry.control(name, "pause"),
  seek:     (name, t) => registry.control(name, "seek", t),
  progress: (name, p) => registry.control(name, "progress", p),
};
```

```js
// In the parent page
const iframe = document.querySelector("iframe");
iframe.contentWindow.monomotion.play("intro");
iframe.contentWindow.monomotion.seek("intro", 1.5);
```

## Web Component

```js
class MonoAnimation extends HTMLElement {
  connectedCallback() {
    const name = this.getAttribute("name");
    const src = this.getAttribute("src");

    this.innerHTML = `<div class="animation-host"></div>`;

    // Load animation definition dynamically
    import(src).then(({ build }) => {
      this._tl = build(this.querySelector(".animation-host"));
    });
  }

  play()    { this._tl?.play(); }
  pause()   { this._tl?.pause(); }
  seek(t)   { this._tl?.seek(t); }
}

customElements.define("mono-animation", MonoAnimation);
```

```html
<mono-animation name="hero" src="./animations/hero.js"></mono-animation>
<button onclick="document.querySelector('mono-animation').play()">Play</button>
```

## React Integration (if needed)

```jsx
import { useEffect, useRef } from "react";
import { gsap } from "gsap";

function AnimatedBox() {
  const boxRef = useRef(null);
  const tlRef  = useRef(null);

  useEffect(() => {
    tlRef.current = gsap.timeline({ paused: true });
    tlRef.current.to(boxRef.current, { x: 200, duration: 0.8, ease: "power2.out" });

    return () => tlRef.current.kill();
  }, []);

  return (
    <div>
      <div ref={boxRef} style={{ width: 80, height: 80, background: "#6366f1" }} />
      <button onClick={() => tlRef.current.play()}>Play</button>
    </div>
  );
}
```

## Dashboard Control Panel

```html
<div class="control-panel">
  <input type="range" id="scrubber" min="0" max="100" value="0" />
  <button id="btn-play">▶</button>
  <button id="btn-pause">⏸</button>
  <button id="btn-reverse">◀◀</button>
  <span id="time-display">0.00s</span>
</div>

<script>
  const scrubber = document.getElementById("scrubber");
  let isScrubbing = false;

  scrubber.addEventListener("input", () => {
    isScrubbing = true;
    tl.progress(scrubber.value / 100).pause();
  });
  scrubber.addEventListener("change", () => { isScrubbing = false; });

  // Sync scrubber with playback
  gsap.ticker.add(() => {
    if (!isScrubbing) {
      scrubber.value = tl.progress() * 100;
      document.getElementById("time-display").textContent = tl.time().toFixed(2) + "s";
    }
  });

  document.getElementById("btn-play").onclick    = () => tl.play();
  document.getElementById("btn-pause").onclick   = () => tl.pause();
  document.getElementById("btn-reverse").onclick = () => tl.reverse();
</script>
```

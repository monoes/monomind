# SVG Animations

## Path Drawing (Stroke Animation)

Use CSS `stroke-dasharray` / `stroke-dashoffset` — GSAP animates these natively.

```js
// Auto-measure and draw the path
function drawPath(pathEl, duration = 1.5) {
  const len = pathEl.getTotalLength();
  gsap.set(pathEl, { strokeDasharray: len, strokeDashoffset: len });
  return gsap.to(pathEl, { strokeDashoffset: 0, duration, ease: "power2.inOut" });
}

drawPath(document.querySelector("path.line"));
```

## Morphing (MorphSVG — GSAP Club)

```js
gsap.registerPlugin(MorphSVGPlugin);

gsap.to("#circle", { morphSVG: "#star", duration: 1, ease: "elastic.out(1, 0.5)" });
```

For free alternative, manually tween `d` attribute between matching-point paths:

```js
// Only works with same number of path points
gsap.to(pathEl, { attr: { d: targetPathD }, duration: 0.8 });
```

## Animate SVG Attributes

```js
// Move a circle
gsap.to("circle", { attr: { cx: 200, cy: 100, r: 40 }, duration: 0.8 });

// Color fill
gsap.to("rect", { fill: "#6366f1", duration: 0.5 });

// Stroke width pulse
gsap.to("path", { attr: { "stroke-width": 4 }, duration: 0.3, yoyo: true, repeat: 1 });
```

## SVG Transform (use GSAP, not CSS transform)

```js
// GSAP handles SVG transforms cross-browser
gsap.to(".icon", { rotation: 180, scale: 1.2, transformOrigin: "50% 50%", duration: 0.5 });
```

> Never use CSS `transform` on SVG elements — use GSAP's `rotation`, `x`, `y`, `scale` props.

## Animated Icon (Hamburger → X)

```js
const isOpen = { val: false };

function toggleMenu() {
  const tl = gsap.timeline();
  if (!isOpen.val) {
    tl.to(".bar-top",    { y: 6, rotation: 45, transformOrigin: "center", duration: 0.3 })
      .to(".bar-mid",    { autoAlpha: 0, duration: 0.2 }, "<")
      .to(".bar-bottom", { y: -6, rotation: -45, transformOrigin: "center", duration: 0.3 }, "<");
  } else {
    tl.to(".bar-top",    { y: 0, rotation: 0, duration: 0.3 })
      .to(".bar-mid",    { autoAlpha: 1, duration: 0.2 }, "<")
      .to(".bar-bottom", { y: 0, rotation: 0, duration: 0.3 }, "<");
  }
  isOpen.val = !isOpen.val;
  return tl;
}
```

## Particle System (SVG circles)

```js
function createParticles(container, count = 30) {
  const svgNS = "http://www.w3.org/2000/svg";
  const circles = Array.from({ length: count }, () => {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("r", Math.random() * 4 + 2);
    container.appendChild(c);
    return c;
  });

  circles.forEach((c) => {
    gsap.set(c, { x: Math.random() * 800, y: Math.random() * 600 });
    gsap.to(c, {
      x: `+=${(Math.random() - 0.5) * 200}`,
      y: `+=${(Math.random() - 0.5) * 200}`,
      autoAlpha: Math.random() * 0.5 + 0.2,
      duration: Math.random() * 3 + 2,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
  });
}
```

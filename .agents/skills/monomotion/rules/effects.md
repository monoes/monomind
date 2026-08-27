# Effects & Presets

## Fade

```js
// Fade in
gsap.from(el, { autoAlpha: 0, duration: 0.5 });

// Fade out
gsap.to(el, { autoAlpha: 0, duration: 0.5 });

// Cross-fade two elements
const tl = gsap.timeline();
tl.to(elA, { autoAlpha: 0, duration: 0.4 })
  .from(elB, { autoAlpha: 0, duration: 0.4 }, "<");
```

> Always use `autoAlpha` instead of `opacity` — it also handles `visibility: hidden` so elements don't intercept pointer events when invisible.

## Slide

```js
// Slide in from left
gsap.from(el, { x: -100, autoAlpha: 0, duration: 0.6, ease: "power2.out" });

// Slide up
gsap.from(el, { y: 40, autoAlpha: 0, duration: 0.5, ease: "power3.out" });

// Slide out to right
gsap.to(el, { x: 100, autoAlpha: 0, duration: 0.4, ease: "power2.in" });
```

## Scale

```js
// Pop in
gsap.from(el, { scale: 0.8, autoAlpha: 0, duration: 0.4, ease: "back.out(1.7)" });

// Expand from center
gsap.from(el, { scale: 0, transformOrigin: "center center", duration: 0.5, ease: "elastic.out(1, 0.5)" });
```

## Clip Reveal (wipe)

```js
// Wipe left to right
gsap.from(el, { clipPath: "inset(0 100% 0 0)", duration: 0.8, ease: "power2.inOut" });

// Wipe top to bottom
gsap.from(el, { clipPath: "inset(0 0 100% 0)", duration: 0.6, ease: "power2.out" });
```

## Highlight / Underline Draw

```js
// Draw an SVG underline
gsap.from("line.underline", { drawSVG: "0%", duration: 0.6, ease: "power2.out" });
// Requires DrawSVGPlugin (GSAP Club)
```

## Blur In

```js
gsap.from(el, {
  filter: "blur(12px)",
  autoAlpha: 0,
  duration: 0.7,
  ease: "power2.out",
  clearProps: "filter", // remove inline style after animation
});
```

## Shake

```js
gsap.to(el, {
  keyframes: [
    { x: -8 }, { x: 8 }, { x: -6 }, { x: 6 },
    { x: -3 }, { x: 3 }, { x: 0 },
  ],
  duration: 0.5,
  ease: "none",
});
```

## Pulse

```js
gsap.to(el, {
  scale: 1.05,
  duration: 0.3,
  yoyo: true,
  repeat: 1,
  ease: "power1.inOut",
});
```

## Ease Reference

| Ease | Character |
|------|-----------|
| `power1–4.out` | Smooth deceleration (UI standard) |
| `power1–4.in` | Accelerates out (exits) |
| `power2.inOut` | Smooth both ends |
| `back.out(1.7)` | Slight overshoot on arrival |
| `elastic.out(1, 0.3)` | Springy bounce |
| `bounce.out` | Ball bounce |
| `expo.out` | Fast start, long tail |
| `none` | Linear |

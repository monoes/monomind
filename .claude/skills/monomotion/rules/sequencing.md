# Sequencing & Staggering

## Stagger — Animate a List

```js
// Stagger children in sequence
gsap.from(".card", {
  y: 30,
  autoAlpha: 0,
  duration: 0.5,
  stagger: 0.1,        // 100ms between each element
  ease: "power2.out",
});

// Stagger from center outward
gsap.from(".dot", {
  scale: 0,
  stagger: { each: 0.05, from: "center" },
  ease: "back.out(2)",
});

// Stagger in a grid
gsap.from(".cell", {
  autoAlpha: 0,
  stagger: { amount: 1, grid: [4, 5], from: "start" },
});
```

## Timeline Sequences

```js
const tl = gsap.timeline({ defaults: { duration: 0.5, ease: "power2.out" } });

// Sequential — each starts after previous ends
tl.from(".header", { y: -40, autoAlpha: 0 })
  .from(".body",   { y: 20, autoAlpha: 0 })
  .from(".footer", { y: 20, autoAlpha: 0 });

// Overlap — start 0.2s before previous ends
tl.from(".a", { x: -100 })
  .from(".b", { x: -100 }, "-=0.2")
  .from(".c", { x: -100 }, "-=0.2");

// Parallel — all start at same time
tl.from(".icon",  { scale: 0 })
  .from(".label", { x: -20, autoAlpha: 0 }, "<");
```

## Nested Timelines

```js
function introScene() {
  const tl = gsap.timeline();
  tl.from(".logo", { scale: 0, duration: 0.6, ease: "back.out(2)" })
    .from(".tagline", { y: 20, autoAlpha: 0, duration: 0.4 });
  return tl;
}

function contentScene() {
  const tl = gsap.timeline();
  tl.from(".cards", { y: 40, autoAlpha: 0, stagger: 0.1 });
  return tl;
}

// Master timeline — compose scenes
const master = gsap.timeline();
master.add(introScene())
      .add(contentScene(), "+=0.3");  // 0.3s gap between scenes
```

## Callbacks

```js
const tl = gsap.timeline({
  onStart:    () => console.log("started"),
  onComplete: () => console.log("done"),
  onUpdate:   () => progressBar.style.width = `${tl.progress() * 100}%`,
});

// Per-tween callbacks
tl.to(".el", { x: 100, onComplete: () => el.classList.add("done") });
```

## Repeat & Yoyo

```js
// Loop forever
gsap.to(".spinner", { rotation: 360, duration: 1, repeat: -1, ease: "none" });

// Bounce back and forth 3 times
gsap.to(".ball", { y: 100, duration: 0.5, repeat: 3, yoyo: true, ease: "power1.inOut" });
```

## Delay & Queue

```js
// Simple delay
gsap.to(".el", { x: 100, delay: 0.5 });

// Queue independent sequences
gsap.timeline()
  .to(".a", { x: 100, duration: 0.5 })
  .to(".b", { x: 100, duration: 0.5 })
  .to(".c", { x: 100, duration: 0.5 });
```

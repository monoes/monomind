# Scroll-Driven Animations

## Setup

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js"></script>
```

```js
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger);
```

## Reveal on Enter

```js
gsap.from(".card", {
  y: 50,
  autoAlpha: 0,
  duration: 0.6,
  ease: "power2.out",
  scrollTrigger: {
    trigger: ".card",
    start: "top 85%",    // when top of element hits 85% of viewport
    toggleActions: "play none none reverse",
  },
});
```

**toggleActions:** `onEnter onLeave onEnterBack onLeaveBack`  
Options: `play pause resume reverse restart reset none`

## Scrub — Timeline Tied to Scroll

```js
const tl = gsap.timeline({
  scrollTrigger: {
    trigger: ".section",
    start: "top top",
    end: "bottom top",
    scrub: 1,          // 1 = 1s lag behind scroll (0 = instant)
    pin: true,         // pin the section while scrolling through it
  },
});

tl.from(".title", { x: -200, autoAlpha: 0 })
  .from(".image", { scale: 0.8, autoAlpha: 0 }, "<");
```

## Pin a Section

```js
ScrollTrigger.create({
  trigger: ".sticky-section",
  start: "top top",
  end: "+=600",        // pin for 600px of scroll distance
  pin: true,
  pinSpacing: true,
});
```

## Horizontal Scroll

```js
const sections = gsap.utils.toArray(".panel");

gsap.to(sections, {
  xPercent: -100 * (sections.length - 1),
  ease: "none",
  scrollTrigger: {
    trigger: ".horizontal-wrapper",
    pin: true,
    scrub: 1,
    end: () => `+=${document.querySelector(".horizontal-wrapper").offsetWidth}`,
  },
});
```

## Animate Each Element as it Enters

```js
gsap.utils.toArray(".reveal").forEach((el) => {
  gsap.from(el, {
    y: 40,
    autoAlpha: 0,
    duration: 0.7,
    ease: "power2.out",
    scrollTrigger: {
      trigger: el,
      start: "top 88%",
      toggleActions: "play none none none",  // play once, don't reverse
    },
  });
});
```

## Progress Bar

```js
gsap.to(".scroll-progress", {
  scaleX: 1,
  transformOrigin: "left center",
  ease: "none",
  scrollTrigger: {
    trigger: "body",
    start: "top top",
    end: "bottom bottom",
    scrub: 0,
  },
});
```

```css
.scroll-progress {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 3px;
  background: #6366f1;
  transform: scaleX(0);
  z-index: 9999;
}
```

## Refresh After Dynamic Content

```js
// Call after DOM changes that affect scroll heights
ScrollTrigger.refresh();
```

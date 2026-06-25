# Text Animations

## Word-by-Word Reveal

```js
// Split text into word spans, then animate
function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.innerHTML = words.map(w => `<span class="word">${w}</span>`).join(" ");
  return el.querySelectorAll(".word");
}

const words = splitWords(document.querySelector("h1"));
gsap.from(words, {
  y: 20,
  autoAlpha: 0,
  duration: 0.4,
  stagger: 0.08,
  ease: "power2.out",
});
```

## Character-by-Character

```js
function splitChars(el) {
  const chars = [...el.textContent].map(c =>
    c === " " ? `<span style="display:inline-block;width:0.3em"> </span>`
              : `<span class="char" style="display:inline-block">${c}</span>`
  );
  el.innerHTML = chars.join("");
  return el.querySelectorAll(".char");
}

const chars = splitChars(document.querySelector(".title"));
gsap.from(chars, {
  y: "100%",
  autoAlpha: 0,
  duration: 0.3,
  stagger: 0.03,
  ease: "power3.out",
});
```

## Typewriter

```js
function typewriter(el, text, { speed = 50 } = {}) {
  el.textContent = "";
  let i = 0;
  const tl = gsap.timeline();
  tl.to({}, {
    duration: text.length * (speed / 1000),
    onUpdate() {
      const chars = Math.floor(this.progress() * text.length);
      el.textContent = text.slice(0, chars);
    },
  });
  return tl;
}

typewriter(document.querySelector(".output"), "Hello, Monomotion!", { speed: 60 });
```

## Counter / Number Roll

```js
const counter = { val: 0 };
gsap.to(counter, {
  val: 1000,
  duration: 2,
  ease: "power1.out",
  onUpdate() {
    document.querySelector(".counter").textContent = Math.round(counter.val).toLocaleString();
  },
});
```

## Gradient Text Sweep

```js
// Animate a gradient across text using background-position
gsap.fromTo(".gradient-text",
  { backgroundPosition: "0% 50%" },
  { backgroundPosition: "100% 50%", duration: 2, repeat: -1, yoyo: true, ease: "none" }
);
```

```css
.gradient-text {
  background: linear-gradient(90deg, #6366f1, #ec4899, #f59e0b);
  background-size: 200%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

## Text Scramble

```js
function scramble(el, finalText, duration = 1.2) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const tl = gsap.timeline();
  tl.to({}, {
    duration,
    onUpdate() {
      const p = this.progress();
      el.textContent = finalText
        .split("")
        .map((c, i) => (i / finalText.length < p || c === " ")
          ? c
          : chars[Math.floor(Math.random() * chars.length)])
        .join("");
    },
    onComplete() { el.textContent = finalText; },
  });
  return tl;
}
```

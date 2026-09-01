# Mobile Developer — Best Practices

## Focus
Builds cross-platform mobile apps (primarily React Native) that feel native on both iOS and Android — balancing shared code with platform-specific polish.

## Best practices
- Use functional components with hooks; avoid legacy class-component patterns for new code.
- Implement navigation with a standard library (React Navigation) rather than hand-rolled routing.
- Handle platform differences explicitly (`Platform.select`, platform-specific files) instead of forcing one look everywhere — respect iOS Human Interface Guidelines and Android Material Design where they diverge.
- Use `FlatList`/virtualized lists for anything beyond a handful of items; never render large unbounded lists with `map` inside a `ScrollView`.
- Optimize images and assets per-platform (resolution buckets, compression) to control app size and memory.
- Test on real iOS and Android devices, not just simulators — timing, gestures, and performance differ meaningfully.
- Respect safe areas and platform navigation conventions (back button on Android, swipe-back on iOS).

## Common pitfalls
- Writing one UI and assuming it looks right on both platforms without platform-specific review.
- Rendering long lists without virtualization, causing jank and memory growth.
- Ignoring the Android hardware back button, breaking expected navigation.
- Skipping device testing and shipping simulator-only-verified behavior.

## Tools & techniques
- `Platform.OS` / `Platform.select` for targeted styling and behavior branches.
- FlatList tuning (`windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`) for list performance.
- React Query or similar for data fetching/caching with pagination support.
- Native module bridges only when a platform capability truly isn't available in JS — prefer well-maintained libraries over custom bridges.

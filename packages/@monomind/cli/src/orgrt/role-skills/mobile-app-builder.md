# Mobile App Builder — Best Practices

## Focus
Ships high-performance, platform-appropriate mobile apps across native (iOS/Android) and cross-platform (React Native/Flutter) stacks — choosing the right approach per project and executing it to platform-native quality.

## Best practices
- Choose native vs. cross-platform deliberately based on requirements (performance needs, platform-specific feature depth, team skillset, timeline) — don't default to one approach for every project.
- Follow each platform's design language faithfully: Human Interface Guidelines on iOS, Material Design on Android — don't force one visual language onto both.
- Build offline-first: assume network is unreliable, design local data storage and sync/conflict resolution up front rather than bolting it on later.
- Optimize for mobile constraints explicitly — cold start time, memory footprint, and battery drain are success metrics, not nice-to-haves.
- Integrate platform-native capabilities (biometrics, camera, push notifications, in-app purchase) through well-maintained platform APIs/libraries rather than fragile custom bridges.
- Test on real devices across OS versions, not just emulators/simulators — performance and gesture behavior diverge from simulated environments.
- Plan app store submission requirements (metadata, privacy manifests, review guidelines) early — they can block a release far later than expected.

## Common pitfalls
- Picking cross-platform for a project that actually needs deep native integration (or vice versa), causing costly rework mid-project.
- Copying UI patterns from one platform onto the other instead of respecting native conventions.
- Deferring offline/sync design until late, resulting in fragile, hard-to-retrofit data handling.
- Skipping real-device testing and discovering performance/battery issues only after release.

## Tools & techniques
- Platform profilers (Instruments for iOS, Android Studio Profiler) for startup time, memory, and battery analysis.
- FlatList/LazyColumn-equivalent virtualization on every platform for list-heavy screens.
- Crash reporting and real-user performance monitoring (Crashlytics, App Center, or equivalent) wired in from day one.
- Staged rollout mechanisms (phased release / percentage rollout) to catch regressions before full-audience exposure.

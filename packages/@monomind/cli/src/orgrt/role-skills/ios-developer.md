# iOS Developer — Best Practices

## Focus
Builds native iOS applications with Swift and SwiftUI — modern, safe, performant apps that follow Apple's current platform conventions and data-safety guarantees.

## Best practices
- Default to SwiftUI for new UI work; it now covers the vast majority of active devices (iOS 15+) and is no longer optional greenfield tech.
- Use `@Observable` (iOS 17+) for state management in new code — don't mix it with the legacy `ObservableObject`/`@Published` pattern in the same feature.
- Embrace Swift's strict concurrency model: use actors to guard mutable state and resolve data-race warnings rather than suppressing them.
- Use SwiftData for new local persistence needs unless there's a specific reason to stay with Core Data (e.g., deep existing investment).
- Follow MVVM (or a comparably clear separation) so views stay declarative and business logic stays testable outside the view layer.
- Apply Apple's secure coding and data-handling guidance for anything touching user data — keychain for secrets, no sensitive data in plain UserDefaults or logs.
- Build accessibility in from the start: Dynamic Type, VoiceOver labels, and sufficient color contrast, verified with the Accessibility Inspector.

## Common pitfalls
- Mixing old and new observation/state patterns within the same view hierarchy, causing confusing update behavior.
- Ignoring Swift 6 data-race warnings instead of fixing the underlying shared-state design.
- Storing sensitive data insecurely (plain UserDefaults, hardcoded secrets) instead of using Keychain.
- Treating accessibility as a final QA pass rather than validating it alongside each new screen.

## Tools & techniques
- Xcode's strict concurrency checking and Instruments (Time Profiler, Allocations) for correctness and performance validation.
- SwiftData/Core Data migrations tested against real data before shipping schema changes.
- Accessibility Inspector and VoiceOver walkthroughs for every new screen.
- TestFlight staged rollouts combined with crash reporting (e.g., Xcode Organizer / Crashlytics) to catch regressions before full release.

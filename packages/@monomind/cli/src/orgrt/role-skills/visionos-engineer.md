# visionOS Engineer — Best Practices

## Focus
Builds spatial computing experiences for Apple Vision Pro using SwiftUI, RealityKit, and ARKit — windows, volumes, and immersive spaces that respect the platform's unique input and interaction model.

## Best practices
- Start with window-based apps when possible — existing SwiftUI skills and iOS/iPadOS code transfer directly, minimizing platform-specific rework.
- Design hit targets generously (minimum ~60pt) to account for the imprecision of eye-tracking-based gaze selection before a pinch confirms.
- Choose the right scene type deliberately — windows for 2D content, volumes for bounded 3D content, full spaces for immersive experiences — don't default to full immersion when a window suffices.
- Specify preferred interface orientation explicitly (`UIPreferredDefaultInterfaceOrientation`) since visionOS has no screen rotation concept.
- Use Reality Composer Pro for 3D content authoring and iterate with Live Preview on-device rather than guessing at spatial layout from the simulator alone.
- Design for comfort: avoid forcing rapid head movement, sustained close-range focus, or motion that could induce discomfort during extended sessions.
- Layer spatial audio and depth cues to reinforce object placement rather than relying on visual cues alone.

## Common pitfalls
- Porting a flat iOS UI directly into a volume/space without rethinking depth and spatial hierarchy.
- Undersized or ambiguous hit targets that fail with gaze-based selection.
- Ignoring comfort guidelines, producing experiences that fatigue or disorient users on longer sessions.
- Treating the simulator as sufficient for spatial/interaction validation instead of testing on-device.

## Tools & techniques
- RealityKit for real-time 3D rendering and physics; ARKit for scene understanding and anchoring to the real environment.
- Reality Composer Pro for authoring, previewing, and iterating on 3D/spatial content with Live Preview.
- Xcode's visionOS simulator for early iteration, backed by on-device testing before shipping.
- Apple's Human Interface Guidelines for visionOS as the authoritative source for spatial interaction and comfort standards.

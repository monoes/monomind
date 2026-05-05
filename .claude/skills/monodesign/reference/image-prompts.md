# Image Prompts for Design

Generate visual assets — hero imagery, product shots, illustrations, textures — that match the design system and pass the AI slop test.

## Prompt Architecture

Every effective prompt has these layers (order matters):

```
[Subject] + [Action/pose] + [Environment] + [Lighting] + [Technical specs] + [Style/mood] + [Negative constraints]
```

Example:
```
A UX designer in her mid-30s reviewing wireframes on a large monitor in a modern studio — natural diffused window light — shot on Sony A7III, 85mm f/1.8, shallow depth of field — editorial, desaturated warm tones — NOT stock photo pose, NOT overhead, no fake smile, no extra fingers
```

## Hero Image Patterns

### Editorial/Product
```
[Subject doing real work] in [specific setting], photographed from [angle], 
[focal length] lens, [lighting condition], [color palette descriptor matching design system],
cinematic framing — NOT generic stock pose, NOT floating on white
```

### Abstract Texture/Background
```
[Material type] surface, [specific color in OKLCH descriptors], 
macro photography, [lighting angle], 4K detail — 
grain: subtle, no harsh shadows, no digital artifacts
```

### Data Visualization / Illustration
```
Clean vector-style illustration, [subject], [color palette: limited to 3 colors], 
flat design with subtle depth, white/cream background, 
professional technical style — NOT clipart, NOT gradients, NOT beveled edges
```

## Inclusive Representation

Default to diversity without tokenism. The goal is accuracy, not optics.

**Do:**
- Specify age ranges explicitly — "42-year-old" not "middle-aged"
- Anchor subjects in culturally accurate environments (correct architecture, clothing, props)
- Use natural lighting that accurately renders different skin tones — diffused or golden hour
- Include disability representation matter-of-factly: "software engineer using a motorized wheelchair at a standing desk"

**Don't:**
- Use vague descriptors ("diverse team") — they produce clone faces with name tags
- Use dramatic lighting that washes out melanin
- Default to stock-photo "multicultural handshake" compositions
- Let AI guess on cultural specifics — name them explicitly

**Anti-bias constraints (append to any people prompt):**
```
NOT stock photo composition, NOT identical faces, NOT exoticized lighting, 
realistic proportions, authentic environmental context, 
no performative diversity staging
```

## Photography Style by Design Register

### Brand register (landing pages, marketing)
```
[Subject], editorial photography style, [season/time], 
[specific film look: Kodak Portra 400 / CineStill 800T / Fuji Pro 400H],
natural grain, intentional composition — NOT overprocessed, NOT HDR
```

### Product register (dashboards, apps)
```
Person [performing actual task with product], documentary style,
environment lighting, candid posture, monitor showing [realistic UI content] —
NOT posed, NOT smiling at camera, NOT showing screen reflection
```

## Asset Types and When to Generate

| Asset type | When to generate | When to use CSS instead |
|---|---|---|
| Hero background | Abstract, textural, atmospheric | Geometric, color-block, gradient |
| Person photography | Real human context matters | Illustration suffices |
| Product screenshots | None — always use real screenshots | — |
| Icons | Never — use an icon library | Always |
| Decorative marks / badges | Brand/campaign specific | Logo SVG suffices |
| Pattern / texture | Surface richness needed | CSS noise/grain pattern |
| Scene illustration | Concept explanation, empty state | CSS + SVG shapes |

## Image Generation Workflow

1. Write the subject and context first, before any style descriptors
2. Add lighting explicitly — lighting determines if the image reads as editorial or stock
3. Add technical specs (lens, camera model) only for photography prompts
4. Append negative constraints last — they filter, not define
5. Generate 3 variations at minimum; choose by fit to design brief
6. Check: Does this pass the "could someone tell AI made this?" test?

## Prompt Anti-Patterns

| Don't write | Write instead |
|---|---|
| "A happy team collaborating" | "Three engineers reviewing a pull request diff on a shared monitor, focused expressions, late afternoon office light" |
| "Modern business professional" | "CPO at a Series B SaaS company, early 50s, during a strategy session, casual attire" |
| "Beautiful woman using laptop" | "UX researcher, late 20s, conducting a remote usability interview — double monitor setup, notes visible, concentration" |
| "Diverse people smiling" | "A four-person product team celebrating a launch, candid shot, conference room with big windows" |
| "Abstract technology" | "Blurred PCB macro, copper traces, shallow depth of field, cool-toned ambient light" |

## Checking Against the Design System

Before using a generated image:
1. Color temperature matches design system warm/cool bias
2. Composition leaves space for text overlay if needed (sky, wall, desk surface)
3. Image subject doesn't compete with the primary CTA
4. No logos, recognizable brands, or copyright-compromising content
5. Accessible alt text can describe this image in one sentence

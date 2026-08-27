---
name: monodoc
description: Full technical writing workbench — writes, reviews, fixes, scaffolds, and audits project docs per Google Developer Documentation Style Guide + industry best practices. Autodiscovers doc tasks. Enforces tone, formatting, accessibility, inclusive language, readability, terminology consistency, Diátaxis doc typing, and word-list compliance. Scaffolds 16 template types (README, ADR, RFC, runbook, migration, API ref, etc.). Measures doc coverage and maturity.
type: domain-skill
default_mode: confirm
autodiscover:
  file_patterns:
    - "README*"
    - "CHANGELOG*"
    - "CONTRIBUTING*"
    - "ARCHITECTURE*"
    - "SECURITY.md"
    - "CODE_OF_CONDUCT*"
    - "MIGRATION*"
    - "RUNBOOK*"
    - "docs/**"
    - "doc/**"
    - "ADR-*"
    - "RFC-*"
    - "*.api.md"
  prompt_keywords:
    - "document"
    - "write docs"
    - "write documentation"
    - "add documentation"
    - "README"
    - "API reference"
    - "explain how"
    - "write a guide"
    - "tutorial"
    - "runbook"
    - "ADR"
    - "RFC"
    - "changelog"
    - "release notes"
    - "migration guide"
    - "technical writing"
    - "onboarding doc"
    - "post-mortem"
    - "incident report"
    - "troubleshooting"
    - "glossary"
    - "FAQ"
  git_triggers:
    - "new exported functions/classes without doc comments"
    - "new directory lacking README.md"
    - "version bump with stale CHANGELOG"
    - "new CLI command without docs entry"
    - "new public API route without docs/api update"
  context_triggers:
    - "new package created"
    - "feature branch nearing merge"
    - "pre-release version bump"
    - "onboarding request"
---

# Monodoc — Technical Writing Workbench

Invoke via `/monodoc` or auto-routed from mastermind when the task is documentation.

---

## Style profiles

Monodoc ships a **Google** profile (default) and supports overrides from other guides. Set via `/monodoc --profile <name>` or per-project in `.monodoc.json`.

| Profile | Base | Key differences from Google |
|---|---|---|
| `google` (default) | Google DDSG | Serial comma always; sentence case headings; "see" for cross-refs |
| `microsoft` | Microsoft Writing Style Guide | Contractions encouraged; deeper bias-free chapter; global-ready sentence caps |
| `stripe` | Stripe-inspired API docs | Prose-left/code-right layout; inline first-use definitions; error docs must state what/why/fix |
| `digitalocean` | DigitalOcean tutorial format | Rigid "Step N — Doing X" gerund headings for tutorials; prerequisite blocks mandatory |
| `minimal` | Subset of Google | Only errors, no warnings — for legacy codebases being incrementally improved |

**Conflict resolution:** when profiles disagree (serial comma, heading case, contraction policy), the active profile wins. The `google` profile is the tiebreaker for any rule not explicitly overridden.

**Custom profile:** create `.monodoc.json` at the project root:
```json
{
  "profile": "google",
  "overrides": {
    "serial_comma": true,
    "heading_case": "sentence",
    "contractions": "allowed",
    "max_sentence_words": 26,
    "readability_target": "grade-10",
    "custom_word_list": {
      "dont_use": {"leverage": "use", "utilize": "use"},
      "preferred": {"repo": "repository"}
    }
  }
}
```

---

## Commands

### Core writing & review

| Command | Behavior |
|---|---|
| `/monodoc write <target>` | Write/rewrite a doc from scratch |
| `/monodoc review <file>` | Audit a doc against all rules; report violations with severity |
| `/monodoc fix <file>` | Review + auto-fix all violations in place |
| `/monodoc api <file>` | Generate/audit API reference comments (TSDoc/JSDoc) |
| `/monodoc readme` | Generate or rewrite the project README |
| `/monodoc guide <topic>` | Write a how-to guide for the given topic |
| `/monodoc tutorial <topic>` | Write a learning-oriented tutorial (distinct from how-to) |
| (no subcommand) | Infer mode from context — review if file exists, write if not |

### Scaffolding

| Command | Behavior |
|---|---|
| `/monodoc scaffold <type>` | Generate a doc from a template (see template catalog below) |
| `/monodoc adr <title>` | Scaffold an Architecture Decision Record (MADR v4 format) |
| `/monodoc rfc <title>` | Scaffold an RFC / design document |
| `/monodoc runbook <service>` | Scaffold an operational runbook |
| `/monodoc migration <from> <to>` | Scaffold a migration guide |
| `/monodoc changelog` | Generate/update CHANGELOG from conventional commits |
| `/monodoc postmortem` | Scaffold a blameless post-mortem / incident report |
| `/monodoc glossary` | Generate/update a project glossary from codebase terms |

### Analysis & audit

| Command | Behavior |
|---|---|
| `/monodoc coverage` | Measure doc coverage — % of public API with docs, missing READMEs, undocumented exports |
| `/monodoc maturity` | Score project against the doc maturity model (L1–L5) |
| `/monodoc readability <file>` | Compute Flesch-Kincaid, Gunning Fog, and grade-level scores |
| `/monodoc links <file>` | Validate internal/external links, find broken anchors |
| `/monodoc drift` | Detect docs referencing code that no longer exists |
| `/monodoc terms <file>` | Check terminology consistency — flag synonyms for the same concept |
| `/monodoc lint <file>` | Fast pass — regex/pattern checks only (no LLM judgment), Vale-style |

### Integration

| Command | Behavior |
|---|---|
| `/monodoc review-integration` | Run monodoc review as part of a mastermind:review pipeline |
| `/monodoc ci` | Output violations in machine-parseable format (JSON/SARIF) for CI pipelines |

---

## Autodiscovery

Monodoc activates automatically when it detects documentation work. Activation signals (combined, not any-one-alone):

**Strong signals (activate immediately):**
- User prompt contains doc-specific verbs: "document", "write docs", "write README", "add API reference", "create a guide", "write a tutorial", "changelog", "release notes", "migration guide"
- User is editing a file matching `README*`, `CHANGELOG*`, `CONTRIBUTING*`, `docs/**`, `ADR-*`, `RFC-*`

**Medium signals (suggest activation):**
- `git diff` shows new exported functions/classes without adjacent doc comments
- New directory created without a `README.md`
- `package.json` version bumped but `CHANGELOG.md` unchanged
- New CLI command registered without a `docs/` entry

**Weak signals (log, don't interrupt):**
- Editing any `.md` file (could be non-doc markdown)
- Prompt mentions "explain" without a doc-specific object

---

## Step 1 — Classify with Diátaxis

Before writing or reviewing, classify the document using the Diátaxis framework. This determines structure, tone weight, and which rules apply most strictly.

| Quadrant | Orientation | Reader need | Structure | Tone weight |
|---|---|---|---|---|
| **Tutorial** | Learning | "Teach me" | Guided steps, guaranteed success, no side-explanations | Warmest, most encouraging |
| **How-to guide** | Task | "Help me do X" | Goal → prerequisites → steps → result | Direct, assumes competence |
| **Reference** | Information | "Tell me about X" | Mirrors code structure, dry, scannable | Most neutral, most precise |
| **Explanation** | Understanding | "Help me understand why" | Discusses alternatives, context, tradeoffs | Conversational, discursive |

**Classification rules:**
- Ask: what does the reader need *right now*?
- A doc that mixes quadrants is usually wrong — split it
- README is a special case: overview + quickstart (tutorial-flavored) + pointers to reference
- Release notes are reference-flavored with explanation elements
- ADRs are explanation documents
- Runbooks are how-to guides for operations

**Common mistakes to avoid:**
- Tutorial that stops to explain theory (split the theory into an explanation doc)
- Reference page written as narrative prose (kills scannability and RAG retrieval)
- How-to guide that teaches fundamentals (that's a tutorial)
- Skipping explanation entirely (leaves users without deep understanding)

---

## Step 2 — Style rules

Every doc produced or reviewed by monodoc MUST comply with ALL sections below. Violations are bugs.

---

### 2.1 Voice and tone

- **Conversational and friendly** — sound like a knowledgeable colleague, not a textbook or marketing copy
- **Second person** — address the reader as "you", not "we" or "the user"
- **Active voice** — "Cloud Storage stores your data" not "Your data is stored by Cloud Storage"
- **Present tense** — "This command creates..." not "This command will create..."
- **No "please"** in instructions — "To view the doc, click **View**" not "please click **View**"
- **No "let's"** — don't write "Let's create a function"
- **No exclamation marks** except in rare, genuinely exciting contexts
- **No filler** — cut "simply", "easily", "just", "obviously", "note that", "please note", "it should be noted", "at this time", "in order to", "as a matter of fact", "it is important to note"
- **No jargon without definition** — define every acronym/abbreviation on first use; re-define if used infrequently
- **No pop-culture references, internet slang, or humor that won't translate** — no tl;dr, ymmv, LGTM in prose
- **No words implying ease** — never "simple", "simply", "easy", "easily", "straightforward", "trivial", "just", "merely", "obviously", "of course"
- **No buzzwords** — avoid "leverage", "utilize", "robust", "scalable", "best-in-class", "cutting-edge" without substance
- **No excessive claims** — avoid "the best", "the fastest", "the most powerful" unless substantiated with data
- **No hedging** — avoid "very", "really", "quite", "rather", "somewhat", "fairly" (weasel words)
- **No "there is/are" constructions** — rewrite to name the subject: "There are three ways to..." → "You can... in three ways:"
- **No clichés** — avoid "at the end of the day", "low-hanging fruit", "move the needle", "deep dive"
- **No redundancy** — avoid "ATM machine", "PIN number", "SSH protocol", "YAML format" (the acronym already contains the noun)

**Tone calibration:**

| Too casual | Correct | Too formal |
|---|---|---|
| "Boom — just call the API and you're golden" | "To retrieve data, call the `getData` method" | "The data may be retrieved via invocation of the `getData` method" |

---

### 2.2 Inclusive language

These are **mandatory**, not suggestions:

| Don't use | Use instead |
|---|---|
| blacklist / whitelist | denylist / allowlist |
| master / slave | primary / replica, leader / follower |
| sanity check | quick check, confidence check, coherence check |
| crazy, insane, bonkers | unexpected, surprising, complex |
| cripple, lame | impair, hinder, slow |
| blind (metaphorical) | unaware, ignore |
| guys | everyone, folks, people |
| he/him/his (generic) | they/them/their |
| man-in-the-middle | on-path attack, person-in-the-middle |
| native (for people) | built-in, integrated (for features) |
| abort | stop, cancel, end |
| kill | stop, end, terminate |
| hang | stop responding, freeze |
| dummy | placeholder, sample |
| mankind | humanity, people |
| manpower | workforce, staffing |
| grandfathered | legacy, exempt |
| handicapped | person with a disability (identity-first only if the community prefers it) |
| normal / abnormal (for people) | typical / atypical, expected / unexpected |
| first-class citizen | first-class support, built-in |
| ninja / rockstar / guru | expert, specialist |

**Example names**: use diverse, non-stereotypical placeholder names across gender, ethnicity, and culture. Rotate: Alex Chen, Priya Sharma, Jordan Williams, Fatima Al-Rashid, Sam Rivera.

---

### 2.3 Headings and titles

- **Sentence case** for ALL headings — "Create an instance", not "Create an Instance"
- **Task-based headings**: start with bare infinitive — "Configure the server" not "Configuring the server"
- **Conceptual headings**: use noun phrases — "Migration to Cloud" not "Migrating to Cloud"
- **No -ing** as the opening word (exceptions: "Billing", "Pricing")
- **No code in headings** unless unavoidable; add a descriptive noun if you must
- **No links in headings**
- **No numbers to sequence sections**
- **One h1 per page** — never skip levels (h1 → h3 without h2 is forbidden)
- **Never repeat the page title** as a subheading
- **Every heading must have content after it** — no empty headings
- **Optional sections**: prefix heading with "Optional:"
- Use "the following sections" when introducing subsections, not "this section"

---

### 2.4 Lists

- **Numbered lists** for ordered sequences (procedures, priorities)
- **Bulleted lists** for unordered items (options, features)
- **Description lists** for term–definition pairs
- **Introduce every list** with a complete sentence ending in a colon
- **Single-item lists** are not lists — rewrite as prose
- **Parallel structure** — every item must follow the same grammatical pattern
- **Capitalization**: capitalize first word of each item
- **Punctuation**: add periods to items that are complete sentences or contain verbs; omit for single-word items, pure code, or link-only items
- **Serial comma** (Oxford comma) — always
- **No "etc." or "and so on"** at list end; phrase the intro to signal incompleteness ("such as", "including")
- **Multiple paragraphs** within an item use `<p>`, never `<br>`

---

### 2.5 Procedures

- **Numbered steps** for multi-step procedures; sub-steps: lowercase letters; sub-sub-steps: Roman numerals
- **Single-step procedures** → use a bullet, not a numbered list
- **Imperative mood** — "Click **Save**", not "You should click Save"
- **One action per step** (one reader decision per step)
- **State where, then what** — "In the **Name** field, enter a name"
- **State the goal, then the action** — "To create a file, click **New**"
- **Condition before instruction** — "If you want debug output, add the `--verbose` flag" not "Add the `--verbose` flag if you want debug output"
- **Optional steps**: prefix with "Optional:" (not in parentheses)
- **Results follow actions** in the same step, separate paragraph
- **No "please"** in steps
- **No keyboard shortcuts** — prefer menu/button paths
- **Use angle brackets for menu chains** — "Click **File** > **New** > **Document**"
- **Don't repeat procedures** — link to them
- **Don't offer multiple methods** — pick the best one (keyboard-accessible, shortest)
- **Include prerequisites** before the procedure
- **Introduce procedures** with a sentence beyond the heading, ending with colon or period
- **Don't introduce code** with "run the following command" — say what the command does

---

### 2.6 Code in text

- **Code font** (backticks in Markdown) for: method names, class names, function names, property names, data types, filenames, paths, directories, command output, environment variables, HTTP verbs, HTTP status codes, port numbers, MIME types, DNS record types, enum/constant values, keywords, placeholder variables, package names, query parameters, attribute names/values, element names (without angle brackets), strings used in code, database elements, boolean literal values, IAM role names, IP addresses
- **NOT code font** for: product names, domain names (as references), URLs for navigation
- **HTTP status codes**: always both number + name in code font — "`400 Bad Request`"; precede with "an HTTP"
- **Never inflect code** — no possessives, no plurals on code elements; add a noun and inflect that: "`ADDRESS` constants" not "`ADDRESSes`"
- **UI elements rendered from code**: bold + code font
- **Method names**: omit class name unless ambiguous

---

### 2.7 Code samples

- **Wrap lines at 80 characters**
- **2-space indentation** (language-dependent; some use 4)
- **Introduce every code sample** with a sentence — colon if sample follows immediately, period if other material intervenes
- **No ellipsis (…)** to indicate omitted code — use language-appropriate comments ("// Several lines of code are omitted here.")
- **Omitted-code blocks** must NOT be click-to-copy
- **Include code samples** (~5–20 lines) at the top of each API reference page
- **Follow Google language style guides** for the sample's language
- **Code samples must be runnable** — test them or mark them as pseudocode
- **Specify the language** in fenced code blocks (```javascript, not bare ```)

---

### 2.8 API reference comments

- **Document every** class, interface, struct, constant, field, enum, typedef, method
- **First sentence** of every description must be unique, self-contained, and not repeat the element name
- **Class descriptions**: state purpose; don't start with "This class..."
- **Method descriptions**: start with a verb in present tense
  - Returns data: "Gets the...", "Returns the...", "Adds a new..."
  - Boolean getter: "Checks whether..."
  - Setter: "Sets the..."
  - Delete: "Deletes the..."
  - Callback: "Called by..."
  - Constructor: "Creates a..."
- **Parameters**: capitalize first word, end with period
  - Non-boolean: start with "The" or "A"
  - Boolean (action): state both true and false behavior
  - Boolean (state): "True if ...; false otherwise."
  - With defaults: explain behavior then "Default: ..."
- **Return values**: start with "The..." for non-boolean; "True if...; false otherwise." for boolean
- **Deprecation**: first sentence states the replacement — "Deprecated. Use `NewThing` instead."
- **No "e.g."** in first sentences (confuses doc generators); use "for example"
- **Don't pluralize class names** — use "Intent objects" not "Intents"
- **Code font + links** for all API names, classes, methods, constants, parameters
- **String literals**: code font with double quotes — `"wrap_content"`

---

### 2.9 Accessibility

Every doc must be accessible. These are not optional:

**Structure:**
- Semantic HTML — `<em>` for emphasis, not visual italics
- Proper heading hierarchy — never skip levels
- One h1 per page
- Introduce tables and interactive elements in preceding text
- Left-align all text (never center or justify)
- Don't force line breaks within sentences

**Images:**
- Alt text on EVERY `<img>` — concise, no "Image of...", include punctuation, ≤155 chars
- Empty `alt=""` for decorative images
- Never use images for text, code, or terminal output
- Use SVG over PNG when possible
- No transparent backgrounds
- No image maps
- Hide PII with opaque overlays, never blurs
- Descriptive filenames

**Links:**
- Meaningful link text — never "click here" or "read this"
- Separate adjacent links with characters
- Explain unexpected behavior (downloads, new tabs)
- Use "see" for cross-references

**Content:**
- Sentences under 26 words
- No double negatives
- No directional language ("above", "below", "right-hand side") — use "preceding", "following"
- No camelCase or ALL CAPS in prose (screen readers read letter by letter)
- Don't rely on color alone to convey meaning
- Provide captions/transcripts for audio/video

**Tables:**
- `<th>` for row/column headings
- `scope` attribute when both row and column headings
- Avoid cell merging (`colspan`, `rowspan`)
- Don't place tables mid-procedure

**Forms:**
- `<label>` for every input (outside the field)
- Error messages state what's wrong and how to fix it

---

### 2.10 Formatting and organization

**Capitalization:**
- Sentence case for headings (covered in 2.3)
- Standard American English spelling throughout

**Numbers:**
- Spell out zero through nine; use numerals for 10+
- Always use numerals with units (5 GB, 3 seconds)
- Use numerals in technical contexts (parameter values, counts)

**Dates and times:**
- Unambiguous format: "July 23, 2026" not "7/23/26"
- Spell out month names to avoid locale confusion

**UI elements:**
- **Bold** for UI element names — "Click **Save**"
- Match the exact label text from the UI

**Notes/warnings:**
- Use standard callout formats (Note, Caution, Warning)
- Don't overuse — if everything is a note, nothing is

**Paragraphs:**
- Lead with the main point
- One topic per paragraph
- Break up walls of text

---

### 2.11 Word list (key entries)

Apply these on every pass. When in doubt, consult the [full word list](https://developers.google.com/style/word-list).

| Term | Rule |
|---|---|
| abort | Don't use. Use stop, cancel, end |
| access (verb) | Use see, edit, find, use, view |
| allows you to | Use "lets you" |
| app vs application | "app" for end-user; "application" for enterprise |
| can / may / might / must | "can" = ability; "may" = policy permission; "might" = possibility; "must" = requirement |
| CLI | Don't use generically; name the specific tool |
| comprise | Use "consists of", "contains", "includes" |
| config | Spell out "configuration" in prose |
| currently | Omit — docs should be timeless |
| data | Singular — "the data is" |
| deselect | Use "clear" (for checkboxes) |
| deprecate | Means "recommend against"; not "removed" |
| dialog | UI element; "dialogue" for human conversation |
| display (verb) | Requires a direct object |
| earlier / later | For versions — not "above/below" or "higher/lower" |
| email | Not "e-mail"; don't use as verb |
| enable | For features; use "lets you" for capability |
| enter | For text input into fields |
| etc. | Don't use. List explicitly or phrase intro with "such as" |
| fill in / fill out | "fill in" for fields; "fill out" for forms |
| frontend / backend | One word, no hyphen |
| he/him/his | Use singular "they" |
| just | Usually filler — delete it |
| on-premises | Hyphenated; never "on-prem" or "on-premise" |
| please | Only for requesting forgiveness/permission; never in instructions |
| plugin / plug-in / plug in | Noun / adjective / verb |
| & | Use "and" in text; & only in code/UI |

---

### 2.12 Linking and cross-references

- **Descriptive link text** — use the destination page title or a clear description
- **Never** "click here", "this document", "this article", or bare URLs as link text
- **Keep link text short** — not full sentences
- **Important words first** in link text
- **Use "see"** for cross-references: "For more information, see [Installing the CLI](link)"
- **Include "about..." clause** when context doesn't make the destination obvious
- **Punctuation outside link tags**
- **No quotation marks** around linked text
- **Don't force new tabs** unless necessary; if you do, state "(opens in a new tab)"
- **Specify file type** for download links: "Download the [sample data (CSV)](link)"
- **Avoid duplicate links** within a section

---

### 2.13 Filenames and naming

- **Descriptive filenames** — `install-guide.md` not `doc1.md`
- **Lowercase with hyphens** — not underscores, not camelCase
- **Use example domains** for fictional examples: `example.com`, `example.org`
- **Trademarks**: use the proper form on first reference; don't use as verbs

---

### 2.14 Command-line syntax

- **Code font** for the entire command: `gcloud compute instances create my-instance`
- **Bold** for user-supplied values within commands: <code>gcloud compute instances create <b>MY_INSTANCE</b></code>
- **Angle brackets** for required placeholders: `gcloud compute instances create <INSTANCE_NAME>`
- **Square brackets** for optional arguments: `gcloud compute instances create <INSTANCE_NAME> [--zone=<ZONE>]`
- **Curly braces + pipe** for mutually exclusive choices: `{--public | --private}`
- **Ellipsis** for repeatable arguments: `gcloud compute instances delete <INSTANCE_NAME> [<INSTANCE_NAME> ...]`
- **Don't use `$` prompt prefix** unless distinguishing command from output in the same block
- **Introduce commands** by what they do, not "run the following command": "To create an instance:" not "Run the following command to create an instance:"
- **One command per code block** — don't chain unrelated commands
- **Explain every flag** that isn't self-evident — inline or in a description list after the block
- **Placeholder naming**: use `UPPER_SNAKE_CASE` for placeholders in commands; describe each in a list after the command block

---

### 2.15 Error messages and troubleshooting docs

When documenting error messages or writing troubleshooting content:

- **State what went wrong** — not just the error code
- **State why** — what condition triggered the error
- **State how to fix it** — actionable steps, not just "contact support"
- **Use the exact error text** in code font so users can search for it
- **Structure**: Error → Cause → Fix (table or heading-per-error)
- **Don't blame the user** — "The file wasn't found" not "You specified a wrong path"
- **Link to relevant docs** from error messages when possible

---

### 2.16 Readability

Target readability scores by doc type:

| Doc type | Flesch-Kincaid target | Gunning Fog target |
|---|---|---|
| Tutorial | Grade 6–8 | ≤10 |
| How-to guide | Grade 8–10 | ≤12 |
| Conceptual / explanation | Grade 8–10 | ≤12 |
| API reference | Grade 10–14 (acceptable) | ≤14 |
| README | Grade 8–10 | ≤12 |

**Rules:**
- Sentences over 26 words: rewrite or split
- Paragraphs over 5 sentences: break up
- Words with 3+ syllables: replace with simpler alternatives when possible (utilize → use, approximately → about, functionality → feature)
- Passive voice: flag every instance, fix unless the actor is genuinely unknown
- Weasel words: flag "very", "really", "quite", "rather", "fairly", "somewhat"
- Adverb overuse: flag -ly adverbs that weaken rather than specify

---

### 2.17 Terminology consistency

- **Same concept = same term** throughout the doc set. If the codebase calls it "workspace", don't alternate with "project", "environment", "context" for the same thing
- **Glossary-first**: define canonical terms in the glossary; use those terms everywhere
- **Code names win**: if the code calls it `AgentPool`, docs call it "agent pool" (not "worker group" or "agent cluster")
- **Flag synonym drift**: if review finds the same entity referred to by 2+ names, report as a Warning
- **First use = definition**: the first mention of a technical term in a doc should define it or link to its glossary entry

---

### 2.18 Global audience (i18n readiness)

- **Short sentences** — easier to translate accurately
- **No idioms, metaphors, or culturally specific references** — "it's raining cats and dogs" → "there's heavy rainfall"
- **No humor that requires cultural context**
- **Consistent terminology** — translators build translation memories; inconsistent terms multiply cost
- **Locale-neutral examples** — use ISO date formats or spelled-out months; use international phone formats; don't assume US-centric units
- **No text embedded in images** — untranslatable

---

## Step 3 — Templates catalog

When scaffolding (`/monodoc scaffold <type>`), use these structures. Pre-fill from code analysis (package.json, exported symbols, git history) where possible; use `TODO:` markers for facts that require human input.

### README
```
# Project name
One-sentence description.
## Prerequisites
## Install
## Quick start
## Usage
## Configuration
## API (if applicable)
## Contributing
## License
```

### How-to guide
```
# [Task verb] [object]
One-sentence overview.
## Before you begin
Prerequisites list.
## [Step sections — numbered within each]
## What's next
```

### Tutorial
```
# [Task verb] [object]: a tutorial
## Objectives
What you'll learn (bulleted).
## Before you begin
Prerequisites + costs.
## Step 1 — [Verb] [object]
...
## Step N — [Verb] [object]
## Clean up
## What's next
```

### API reference
```
# [Module/class name]
One-paragraph description + 5–20 line code sample.
## Members
### [Property name]
## Methods
### [method_name]
Description. Parameters table. Returns. Throws. Example.
```

### ADR (MADR v4)
```
# [ADR-NNNN] [Title]
- Status: [proposed | accepted | deprecated | superseded by ADR-NNNN]
- Date: YYYY-MM-DD
## Context and problem statement
## Decision drivers
## Considered options
1. [Option A]
2. [Option B]
## Decision outcome
Chosen option: "[Option]", because [justification].
### Consequences
- Good, because ...
- Bad, because ...
## Pros and cons of the options
### [Option A]
### [Option B]
## More information
```

### RFC / design document
```
# RFC: [Title]
- Author: [name]
- Status: [draft | review | accepted | rejected | withdrawn]
- Date: YYYY-MM-DD
## Summary
## Motivation
## Goals and non-goals
## Proposed design
## Alternatives considered
## Risks and tradeoffs
## Rollout plan
## Open questions
```

### Runbook
```
# Runbook: [Service/system name]
## Service overview
## Alert conditions
## Severity classification
## Diagnosis steps
## Mitigation / remediation
## Escalation path
## Rollback procedure
## Post-incident actions
```

### Migration guide
```
# Migrate from [X] to [Y]
## Overview
## Breaking changes
## Prerequisites
## Step-by-step migration
## Before/after examples
## Rollback procedure
## Deprecation timeline
## FAQ
```

### Changelog (Keep a Changelog)
```
# Changelog
All notable changes to this project are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/).
Versioning: [Semantic Versioning](https://semver.org/).
## [Unreleased]
## [X.Y.Z] - YYYY-MM-DD
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
```

### Post-mortem / incident report
```
# Incident report: [Title]
- Date: YYYY-MM-DD
- Severity: [P0–P4]
- Duration: [start–end]
- Author: [name]
## Summary
## Impact and blast radius
## Timeline
## Root cause
## Detection
## Resolution
## Action items
| Action | Owner | Deadline | Status |
## Lessons learned
```

### Contributing guide
```
# Contribute to [project]
## Code of conduct
## Development setup
## Branch and PR workflow
## Coding standards
## Testing requirements
## Commit conventions
## Review process
```

### Security policy (SECURITY.md)
```
# Security policy
## Supported versions
| Version | Supported |
## Report a vulnerability
## Response SLA
## Disclosure policy
```

### Troubleshooting guide
```
# Troubleshoot [topic]
## [Symptom]
**Cause:** ...
**Fix:** ...
## Diagnostic commands
## Known issues
## Get help
```

### FAQ
```
# Frequently asked questions
## [Topic group]
### [Question in sentence case?]
Answer.
```

### Glossary
```
# Glossary
| Term | Definition |
```

### Onboarding guide
```
# Get started with [project/team]
## Access and accounts
## Local environment setup
## Architecture overview
## Your first task
## Team norms
## Key contacts
```

---

## Step 3b — Monograph integration

When available, use monograph tools to power doc analysis instead of manual grep. This makes coverage, drift, and term analysis graph-aware.

| Task | Tool | How |
|---|---|---|
| **Coverage** | `mcp__monomind__monograph_dead_code` | Find exported functions with no doc comments; cross-reference against `docs/` entries |
| **Drift** | `mcp__monomind__monograph_query` | For each backticked symbol in a doc file, verify it still exists in the graph |
| **Impact** | `mcp__monomind__monograph_impact` | Before documenting a change, find all affected files/consumers |
| **API surface** | `mcp__monomind__monograph_god_nodes` | Find high-centrality files that deserve dedicated doc pages |
| **Neighbors** | `mcp__monomind__monograph_neighbors` | When writing a module doc, discover related modules for "See also" links |
| **Route map** | `mcp__monomind__monograph_route_map` | Auto-generate API endpoint reference from route definitions |
| **Suggest** | `mcp__monomind__monograph_suggest` | When starting doc work on 3+ files, get ranked relevance list |

**Fallback:** if monograph is not built or returns 0 results, fall back to `grep`/`find` via Bash.

---

## Step 3c — Lint patterns (fast pass)

The `/monodoc lint` command runs regex/pattern checks without LLM judgment. These are the highest-signal patterns, derived from Vale, alex.js, write-good, and proselint:

**Filler & weasel words** (flag for removal):
- `simply|easily|just|merely|obviously|clearly|of course|basically|actually|really|very|quite|rather|fairly|somewhat|arguably`

**Ease words** (flag as condescending):
- `simple|easy|straightforward|trivial|no-brainer`

**Passive voice** (flag for rewrite):
- Pattern: `(is|are|was|were|be|been|being)\s+([\w]+ed|[\w]+en)\b` (heuristic — false positives acceptable in lint mode)

**Inclusive language** (flag as error):
- `\b(whitelist|blacklist|master[\s/]slave|sanity\s*check|crazy|insane|dummy|mankind|manpower|grandfathered)\b`

**Google word list violations** (flag with replacement):
- `allows you to` → "lets you"
- `\betc\.` → list explicitly
- `\bcurrently\b` → omit
- `\bplease\b` (in instructions) → remove
- `\babort\b` → stop/cancel/end
- `\butilize\b` → use
- `\bleverage\b` (verb) → use

**"There is/are" constructions**:
- `\b(there\s+(is|are|was|were|will be))\b` → rewrite to name the subject

**Sentence length** (flag if >26 words):
- Split on `.!?` then count words per sentence

**Heading case** (flag title case in headings):
- In Markdown `#` lines, flag if >50% of words are capitalized (heuristic for title case)

**Click here** (flag as accessibility error):
- `\b(click\s+here|read\s+this|this\s+link|this\s+document)\b`

These patterns catch ~60% of style violations without any LLM cost. The full `/monodoc review` uses LLM judgment for the remaining 40% (tone calibration, content accuracy, Diátaxis classification, semantic completeness).

---

## Step 4 — Doc coverage and maturity

### Coverage analysis (`/monodoc coverage`)

Measure and report:

1. **API coverage** — % of public exported functions/classes/types with doc comments (use monograph or TSDoc extraction)
2. **README coverage** — which packages/directories lack a README
3. **Guide coverage** — which major features lack a how-to guide
4. **Changelog freshness** — is CHANGELOG current with latest version?
5. **Link health** — count of broken internal/external links

Output format:
```
DOC COVERAGE REPORT
━━━━━━━━━━━━━━━━━━
API docs:    72% (43/60 exports documented)
READMEs:     5/8 packages have README  ⚠ missing: @monoes/routing, monofence-ai, @monoes/memory
Guides:      3 features undocumented
Changelog:   ✓ current (v2.5.5)
Links:       2 broken (list follows)
```

### Doc maturity model (`/monodoc maturity`)

| Level | Name | Criteria |
|---|---|---|
| L1 | **Exists** | README present, may be informal or stale |
| L2 | **Referenced** | Generated API reference from code (TSDoc/JSDoc), basic README |
| L3 | **Guided** | Task-oriented how-to guides per major feature |
| L4 | **Taught** | Tutorials + versioned docs synced to releases |
| L5 | **Measured** | Analytics, freshness SLAs, i18n, readability-scored |

Score the project and report the current level with specific gaps to reach the next level.

---

## Step 5 — Doc drift detection (`/monodoc drift`)

Detect documentation that references code artifacts that no longer exist:

1. Extract code references from docs (function names, class names, file paths, CLI commands in backticks)
2. Cross-reference against monograph or codebase grep
3. Report stale references with the doc file, line number, and the missing artifact
4. Suggest: remove, update, or mark as deprecated

---

## Step 6 — Write or review

### Writing mode (`write`, `readme`, `guide`, `tutorial`, `api`, `scaffold`)

1. Classify with Diátaxis (Step 1)
2. Select the template from the catalog (Step 3) or outline from scratch
3. Pre-fill from code analysis where possible (package.json, exported symbols, monograph, git log)
4. Draft following ALL rules from Step 2
5. Compute readability score — rewrite if above target for the doc type
6. Self-review against the checklist (Step 7)
7. Fix all violations before presenting the draft

### Review mode (`review`)

1. Read the entire file
2. Classify the doc type (Diátaxis)
3. Run every rule from Step 2 against it systematically
4. Compute readability scores
5. Check terminology consistency across the doc
6. Validate links (internal anchors, external URLs if accessible)
7. Report violations grouped by section (2.1–2.18), with:
   - Line number or quoted text
   - Rule violated (section + specific rule)
   - Suggested fix
8. Severity: **Error** (violates a MUST rule), **Warning** (violates a SHOULD), **Info** (style improvement)

### Fix mode (`fix`)

1. Run review mode
2. Apply all Error and Warning fixes in place
3. Report summary: violations found, fixed, remaining (Info-level left for human decision)

---

## Step 7 — Self-review checklist

Before presenting ANY doc, verify EVERY item. Each unchecked item must be fixed.

### Voice and tone
- [ ] Second person ("you") throughout, no "we" for the reader
- [ ] Active voice — no passive constructions
- [ ] Present tense — no "will" for current behavior
- [ ] No "please" in instructions
- [ ] No filler words (simply, easily, just, obviously, note that, in order to)
- [ ] No exclamation marks
- [ ] No words implying ease (simple, easy, straightforward, trivial)
- [ ] No jargon without first-use definition
- [ ] Conversational but not casual — no slang, no pop culture, no internet abbreviations
- [ ] No weasel words (very, really, quite, rather, somewhat)
- [ ] No "there is/are" constructions
- [ ] No clichés or buzzwords
- [ ] No redundant acronym expansions (ATM machine, PIN number)

### Inclusive language
- [ ] No blocklisted terms (see 2.2 table)
- [ ] Gender-neutral pronouns (singular they)
- [ ] No ableist language
- [ ] Diverse example names

### Structure and formatting
- [ ] Correct Diátaxis quadrant — doc doesn't mix types
- [ ] Sentence case on ALL headings
- [ ] Proper heading hierarchy (no skipped levels, one h1)
- [ ] Task headings start with bare infinitive
- [ ] Every heading has content after it
- [ ] Lists introduced with complete sentences
- [ ] Parallel structure in all lists
- [ ] Serial comma used consistently
- [ ] No "etc." or "and so on"

### Code and technical
- [ ] All code elements in code font (backticks)
- [ ] No inflected code elements
- [ ] UI elements bolded
- [ ] Code samples wrapped at 80 chars
- [ ] Code samples introduced with text
- [ ] No ellipsis in code samples — use comments for omissions
- [ ] Code blocks specify language

### Procedures
- [ ] Numbered steps for multi-step; bullet for single-step
- [ ] One action per step
- [ ] Imperative mood
- [ ] Condition before instruction
- [ ] State where, then what
- [ ] Optional steps prefixed with "Optional:"
- [ ] Prerequisites listed before procedure

### Accessibility
- [ ] Alt text on all images
- [ ] No images of text/code
- [ ] Meaningful link text (no "click here")
- [ ] Sentences under 26 words
- [ ] No directional language (above/below)
- [ ] Semantic HTML
- [ ] Left-aligned text

### Readability
- [ ] Flesch-Kincaid grade level within target for doc type
- [ ] No sentences over 40 words
- [ ] No paragraphs over 5 sentences
- [ ] Simpler word chosen where equivalent (utilize → use)

### Terminology
- [ ] Same concept = same term throughout
- [ ] Technical terms defined on first use or linked to glossary
- [ ] Code names match actual codebase names

### Command-line syntax
- [ ] Placeholders in `UPPER_SNAKE_CASE` with angle brackets
- [ ] Optional args in square brackets
- [ ] Every non-obvious flag explained
- [ ] Commands introduced by what they do, not "run the following"
- [ ] No `$` prompt prefix unless distinguishing from output

### Error and troubleshooting docs
- [ ] Each error documents: what, why, and fix
- [ ] Exact error text in code font
- [ ] No blame language ("you did X wrong")

### Word list and grammar
- [ ] No "abort" — use stop/cancel/end
- [ ] No "allows you to" — use "lets you"
- [ ] No "currently" — docs are timeless
- [ ] "data" treated as singular
- [ ] No generic "CLI" — name the tool
- [ ] "can/may/might/must" used precisely
- [ ] American English spelling

### Links
- [ ] Descriptive link text
- [ ] "See" for cross-references
- [ ] No duplicate links in a section
- [ ] Punctuation outside link tags

### Global readiness
- [ ] No idioms or culturally specific references
- [ ] No text embedded in images
- [ ] Locale-neutral date/number formats

---

## Step 8 — Output

After completing the write/review/fix:

| Mode | Output |
|---|---|
| **write** | Finished doc with readability score and Diátaxis classification |
| **review** | Violation report: line numbers, rule IDs (2.1–2.18), severity, suggested fixes, readability scores |
| **fix** | Applied edits summary with before/after readability comparison |
| **lint** | Fast pattern-match results — no LLM judgment, machine-parseable |
| **coverage** | Coverage report: API %, README %, guide gaps, changelog freshness, link health |
| **maturity** | L1–L5 assessment with gap analysis to next level |
| **drift** | Stale references with doc file, line number, missing artifact, suggested action |
| **terms** | Terminology consistency report: synonym clusters, suggested canonical terms |
| **ci** | JSON or SARIF output for CI pipeline integration |
| **scaffold** | Generated doc with `TODO:` markers for human-supplied facts |

Always state what was checked and any items that couldn't be automatically verified (for example, alt text accuracy requires human judgment on whether the description matches the image's intent).

---

## Quick reference

When invoked without a subcommand, monodoc infers the mode:

1. If the argument is an existing `.md` file → **review** mode
2. If the argument is a non-existent file path → **write** mode (infer type from filename)
3. If no argument → **coverage** mode (audit the whole project)
4. If the prompt describes a doc goal → **write** mode with Diátaxis classification

**Shorthand examples:**
- `/monodoc README.md` → reviews the README
- `/monodoc docs/setup-guide.md` → reviews if exists, writes if not
- `/monodoc` → runs project-wide doc coverage report
- `/monodoc "how to configure authentication"` → writes a how-to guide
- `/monodoc adr "Use SQLite for memory storage"` → scaffolds an ADR

# TripSort Design System Options

## Goal

TripSort needs to feel like a practical photo organization workspace, not a map app, travel album, or marketing landing page. The best design direction is a quiet productivity tool with enough visual warmth to remind users that the content is travel photos.

Use this document when choosing a design reference from `VoltAgent/awesome-design-md` or when writing a local TripSort design reference under `docs/design-references/`.

## Selection Criteria

| Criterion | What TripSort Needs |
|---|---|
| Primary workflow | Upload photos, review folders, correct grouping, export ZIP |
| Density | Medium-high density; many files, folders, controls, and status labels |
| Mood | Calm, reliable, organized, desktop-tool-like |
| Visual role of photos | Useful thumbnails and context, not full-screen album storytelling |
| Visual role of map | Optional supporting preview, not the product center |
| Best base theme | Dark productivity UI with restrained accent color |
| Avoid | Decorative landing-page layouts, giant heroes, glossy gradients, fashion/editorial styling |

## Best Matches For TripSort

### 1. Linear

**Fit:** Very high  
**Use as:** Main UI foundation

Linear's ultra-minimal, precise, dark productivity style fits TripSort's organizer-first workspace well.

Good for:

- sidebar navigation
- grouped lists
- tabs
- quiet cards
- keyboard/workflow-heavy product feel
- low-noise file review screens

Why it works:

- TripSort needs users to scan, compare, and correct results.
- The UI should not compete with photo thumbnails or folder paths.
- Manual merge/split/edit controls benefit from Linear-like precision.

Risk:

- Can feel too generic if copied directly.
- Add a small travel/photo warmth through thumbnails, empty states, and accent copy.

Recommendation:

```text
Use Linear as the base design system.
Keep cards flat, borders subtle, spacing tight, and actions clear.
```

## 2. Raycast

**Fit:** High  
**Use as:** Desktop utility polish layer

Raycast's dark chrome and productivity launcher feel works well for a PC/browser tool.

Good for:

- command-like actions
- compact controls
- side panels
- keyboard-friendly UI
- polished dark app surfaces

Why it works:

- TripSort behaves like a utility that helps clean up files.
- The app should feel fast and task-oriented.

Risk:

- Too much Raycast-style gloss or gradient can distract from organization results.

Recommendation:

```text
Use Raycast for interaction polish, not for heavy visual branding.
```

## 3. Superhuman

**Fit:** Medium-high  
**Use as:** Premium workflow inspiration

Superhuman has a premium, keyboard-first dark interface. It can make TripSort feel more refined.

Good for:

- smooth tab transitions
- focused review workflows
- premium dark surfaces
- compact action bars

Risk:

- Purple glow and premium styling can become too decorative.
- TripSort should stay more practical than luxurious.

Recommendation:

```text
Borrow interaction quality and spacing discipline, not the full visual identity.
```

## 4. Mintlify

**Fit:** Medium  
**Use as:** Documentation and explanatory panels

Mintlify is reading-optimized and clean. It is less ideal for the main app shell, but useful for docs, onboarding, and technical explanation areas.

Good for:

- README/docs style
- help panels
- explanation of VLM/scoring logic
- presentation slides

Risk:

- Main TripSort app could become too documentation-like.

Recommendation:

```text
Use Mintlify for docs and onboarding, not the main organizer workspace.
```

## 5. Airbnb

**Fit:** Medium  
**Use as:** Travel/photo accent only

Airbnb has strong travel associations and photography-driven warmth.

Good for:

- empty states
- travel-specific copy
- photo-led moments
- light marketing/demo screens

Risk:

- Too consumer/travel-album-like for a file organization tool.
- Can pull the product away from its core promise: organized folders and ZIP export.

Recommendation:

```text
Use Airbnb lightly for travel warmth, not as the main app design system.
```

## 6. Vercel

**Fit:** Medium  
**Use as:** Technical precision reference

Vercel's black-and-white precision can work for developer-facing tools, but TripSort is more user-facing.

Good for:

- clean technical screens
- strong typography hierarchy
- restrained components

Risk:

- Can feel too stark and developer-platform-like.

Recommendation:

```text
Use Vercel only if TripSort is presented primarily as a technical project.
```

## 7. Notion

**Fit:** Medium-low  
**Use as:** Warm workspace alternative

Notion's warm minimalism is friendly, but less suited to dense photo/file workflows.

Good for:

- simple onboarding
- calm workspace feel
- editable text-heavy views

Risk:

- Too soft and document-like.
- Folder preview and file controls may lose clarity.

Recommendation:

```text
Use only if you want a lighter, softer TripSort variant.
```

## 8. Ollama / OpenCode / VoltAgent

**Fit:** Low-medium  
**Use as:** AI/developer mode inspiration

These styles fit local AI tooling, terminal workflows, and developer demos.

Good for:

- technical status panels
- Ollama/VLM diagnostics
- developer-facing settings

Risk:

- Too terminal-native for regular users organizing travel photos.

Recommendation:

```text
Use only for AI status and technical debug panels.
```

## Design Families In The Collection

| Design Family | Examples | Mood | Fit For TripSort |
|---|---|---|---|
| Productivity dark UI | Linear, Raycast, Superhuman, Cursor | Fast, precise, focused | Very high |
| Minimal monochrome | Vercel, xAI, Uber, Apple | Stark, premium, restrained | Medium |
| Technical docs/platform | Mintlify, ClickHouse, Together AI, IBM | Structured, explanatory | Medium |
| Warm workspace | Notion, Intercom, Zapier | Friendly, approachable | Medium-low |
| Travel/photo consumer | Airbnb, Pinterest, Apple | Visual, warm, consumer-facing | Medium as accent |
| Data-dense operations | Sentry, PostHog, Kraken | Dense, status-heavy, operational | Medium |
| Creative/collaboration | Figma, Miro, Airtable | Colorful, playful, visual | Low-medium |
| Local AI/terminal | Ollama, OpenCode, VoltAgent | Developer-native, technical | Low-medium |
| Cinematic/editorial | Runway, SpaceX, Nike, Ferrari | Dramatic, visual, brand-heavy | Low |
| Fintech trust | Stripe, Coinbase, Wise | Trustworthy, polished, conversion-led | Low-medium |
| Automotive/luxury | BMW, Bugatti, Lamborghini, Tesla | Premium, cinematic, sparse | Low |

## Recommended Direction

Use this combination:

```text
Base: Linear
Interaction polish: Raycast
Documentation/onboarding: Mintlify
Travel warmth: Airbnb, used sparingly
Technical AI status: Ollama, used sparingly
```

This gives TripSort a clear identity:

```text
Organized like Linear,
quick like Raycast,
explainable like Mintlify,
lightly travel-aware like Airbnb.
```

## What To Avoid

Avoid these as primary design systems for TripSort:

| Avoid | Reason |
|---|---|
| Nike / Ferrari / Lamborghini / SpaceX | Too cinematic and brand-heavy |
| Runway | Too creative/editorial; can make the app feel like a media product |
| Stripe | Beautiful, but too marketing/infrastructure-like |
| Miro / Figma | Too collaborative/creative-canvas-oriented |
| Binance / Kraken | Too trading/data-urgency-oriented |
| Starbucks / Mastercard | Warm branding does not match file organization |

## Suggested Local Design Direction

If creating a local TripSort design reference, define TripSort like this:

```text
TripSort is a dark, organizer-first desktop utility for reviewing automatically generated travel photo folder structures.

The interface should feel precise, calm, and efficient. It should prioritize folder preview, file metadata, confidence states, and correction controls. The map is secondary and only appears on demand.

Use dark neutral surfaces, subtle borders, compact spacing, and one clear blue accent for primary actions. Avoid decorative gradients, oversized hero sections, and travel-album styling. Photo thumbnails should support recognition, not dominate the workspace.
```

## Implementation Notes

- Keep the current dark shell unless there is a strong reason to redesign from scratch.
- Add design tokens before adding more one-off CSS.
- Use `Linear` for the main app layout and controls.
- Use `Raycast` for hover, focus, active, and command-like interactions.
- Use `Airbnb` only for empty states, demo screens, or small travel cues.
- Keep map UI visually secondary.
- Keep all controls usable at 320px mobile width and low-height landscape screens.

## Next Step

Recommended next design task:

```text
Create a project-local design reference based on Linear + Raycast under `docs/design-references/`, then apply it to TripSort's existing CSS tokens and components.
```

# arconstructive — DESIGN.md

> No brand system yet: these are a neutral stand-in. The Designer proposes brand directions first; regenerate this file after the founder picks one. Tokens are the source of truth: UI code uses them by name, never raw hex values or other fonts. Change a token here first, then in code (`web/src/app.css`).

## Overview

A calm, exact work tool for architects who assemble permit sets. It must read like a drawing set: plain canvas, black ink, one red mark where action is needed.

Look: **Mono and red**. Theme: light.

## Colors

| Token | Hex | CSS variable | Role |
|---|---|---|---|
| bg | `#F4F4F2` | `--color-bg` | page canvas |
| surface | `#E6E6E3` | `--color-surface` | cards, panels, inputs |
| border | `#D4D4D2` | `--color-border` | 1px dividers and input borders |
| ink | `#111111` | `--color-ink` | headings and body text |
| muted | `#6E6E6A` | `--color-muted` | secondary text, captions, placeholders |
| accent | `#E63B2E` | `--color-accent` | the one primary action per screen, links, focus ring |
| on-accent | `#111111` | `--color-on-accent` | text and icons on accent |
| accent-2 | `#111111` | `--color-accent-2` | highlights and charts; never a second primary button |
| success | `#1F7A4D` | `--color-success` | confirmations |
| danger | `#B42318` | `--color-danger` | errors and destructive actions |

Ink on canvas contrast: 17.1:1. Accent is for one primary action per screen; most of the screen is canvas, surface and ink.

## Typography

- Display: **Schibsted Grotesk** (headings, numbers that matter)
- Text: **Schibsted Grotesk** (body, UI labels, inputs)
- Load: `https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&display=swap`
- Case: sentence case everywhere

| Style | Size | Line height | Weight | Family |
|---|---|---|---|---|
| display | 56px | 1.05 | 600 | Schibsted Grotesk |
| h1 | 40px | 1.1 | 600 | Schibsted Grotesk |
| h2 | 32px | 1.15 | 600 | Schibsted Grotesk |
| h3 | 24px | 1.25 | 600 | Schibsted Grotesk |
| body-lg | 18px | 1.55 | 400 | Schibsted Grotesk |
| body | 16px | 1.55 | 400 | Schibsted Grotesk |
| small | 14px | 1.5 | 400 | Schibsted Grotesk |
| caption | 12px | 1.4 | 500 | Schibsted Grotesk |

On phones, display is 40px and h1 32px. Body never below 16px; line length 60–75 characters.

Artifact documents (the generated reports in the artifact canvas, and their PDF and Word exports) use a serif for their own titles and headings, so a deliverable reads as a document and not as app chrome. App UI never uses these.

| Style | Size | Line height | Weight | Family |
|---|---|---|---|---|
| doc-title | 40px (32px on phones) | 1.15 | 600 | Source Serif 4 (`--font-document`) |
| doc-h1 / h2 / h3 / h4 | 28 / 24 / 20 / 17px | 1.25 | 600 | Source Serif 4 |
| doc-body | 16px | 1.65 | 400 | Schibsted Grotesk |
| doc-table | 14px | 1.45 | 400 | Schibsted Grotesk |
| mono | 0.875em | inherit | 400 | system monospace (`--font-mono`) |

- Load: `family=Source+Serif+4:opsz,wght@8..60,400;8..60,600` in the same Google Fonts link.

## Spacing and layout

- Base unit 4px; scale: 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px, 128px.
- Content max width 1200px (reading text 680px); gutters 16px on phones, 24px on tablets, 32px on desktop.
- Section gap 96px on desktop, 64px on phones. Related items sit closer than unrelated ones.
- Breakpoints: 640px, 768px, 1024px, 1280px. Design at 390px first, then 1280px.

## Shape and elevation

| Element | Radius |
|---|---|
| buttons, inputs | 0px |
| cards, panels | 0px |
| sheets, dialogs | 2px |
| chips, badges | 0px |

- Shadow: `none`. Depth comes from surface colour and 1px borders.
- One depth cue per element: border, shadow or tint, not all three.

## Motion

- Easing `cubic-bezier(0.4, 0, 0.2, 1)`, duration 240ms (exits shorter than entrances).
- Animate opacity and transform only; respect prefers-reduced-motion (no movement, keep fades).

## Components

- **Primary button:** accent fill, on-accent text, 0px corners, 44px tall (40px dense), Schibsted Grotesk 15px weight 600. Hover darkens 8%; focus shows a 2px accent ring offset 2px; disabled at 40% opacity; loading keeps its width and shows a spinner.
- **Secondary button:** surface fill, ink text, 1px border. **Ghost:** text only, for low-stakes actions.
- **Input:** surface fill, 1px border, 0px corners, 44px tall, label above (never placeholder as label). Focus: accent border + ring. Error: danger border and a message under it that says how to fix it.
- **Card:** surface fill, 0px corners, 24px padding (16px on phones). Never a card inside a card.
- **Navigation:** web: top bar with logo, 3–5 links and one primary action; app: sidebar on desktop, bottom tab bar (max 5) on phones. The current page is marked by weight or a bar, not only colour.
- **Badge / chip:** caption size, chip corners, a tint of its colour at 12% with the colour as text.
- **Empty state:** one line on what will appear here, and the action that fills it.
- **Toast:** bottom on phones, top-right on desktop; success and danger use their colours as a 4px edge.

### Product components

- **Set drop zone:** a dashed 1px border box on canvas. States: empty (what to drop and the file rule), reading (spinner and a surface skeleton line), ready (file name and size, "Choose another file"), error (danger border, what went wrong and how to fix it).
- **Rule family list:** two-letter code in a caption chip, then the plain-words description. A list with dividers, not cards.
- **Artifact canvas:** the right-hand pane that shows a chat's deliverable. A 56px top bar (artifact title menu with its versions, Edit, Export) over a centred 760px document column on canvas. The header is the serif doc-title and chips (date, @author, kind, version). Inline code and table headers use the surface fill; tables have 1px border lines and scroll sideways on phones. States: loading (surface skeleton), generating (text appears live with an accent caret, a "Writing …" status line, and "Jump to latest" when the reader scrolls up; Edit and Export are off), ready, stopped (danger edge with what to do), empty (one line and the Edit action), old version (surface banner with "Restore this version"). Edit mode adds a sticky toolbar (text style, code, table, image, checklist, insert) and "Discard changes" / "Save version".

## Screens and states

- Every screen designs its loading (skeletons in surface colour), empty, error and success states.
- One primary action per screen. Real copy from positioning, never placeholders.
- Icons from one set (Lucide on web), 1.5px stroke, 20px in UI.
- Tap targets at least 44×44; text contrast at least 4.5:1 (3:1 for large text).

## Do

- Write like a plan checker: name the sheet, the evidence and the fix.
- Keep the architect as the party of record: the tool suggests, the architect decides.

## Don't

- Inter (or the system font) on plain white as the whole identity
- purple-to-blue gradients, gradient text, glowing blobs
- a centred hero over three identical feature cards
- emoji as icons, or icons mixed from several sets
- cards nested inside cards; a border, a shadow and a tint on the same box
- grey placeholder copy (lorem ipsum, 'Feature one'), invented logos, numbers or testimonials
- every section the same height, width and rhythm

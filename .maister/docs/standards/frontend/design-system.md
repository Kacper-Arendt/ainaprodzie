Visual and component-system conventions for the SPA.

# Design System Standards

### DESIGN.md Describes the System, This Standard Says Where It Lives
[DESIGN.md](../../../../DESIGN.md) at the repository root describes the design system: the palette and what each colour means, the type scale, spacing, shapes, elevation, every shared component and its states, and the named rules (Ink Acts, Red Means Trouble, Lamps Say Who Owes, Three Voices, Nothing Moves, Touch Floor, Hard Shadows Lift). Read the sections a change touches before building UI, and update DESIGN.md in the same change when a component's look or behaviour changes. These standards say how the code holds the system; where they and DESIGN.md disagree, the disagreement is a defect in one of them, so ask rather than pick.

### Chakra UI v3 as Component and Styling System
The design system is built on Chakra UI v3: use Chakra components, its styling props, recipes and semantic design tokens. No global class-based stylesheets and no inline `style` objects; global rules (the scrollbar gutter, the touch floor) go in `globalCss` in `theme.ts`.

### Semantic Tokens Live in One File
Colours, radii, border widths, shadows and fonts are defined once as Chakra semantic tokens in `frontend/src/theme.ts`, and a palette change is a change to that one file. The palette is the course's paper and ink with three signal voices ([DESIGN.md › Colors](../../../../DESIGN.md#colors)):
- **Ink, for action and focus**: `accent.solid` with `accent.contrast` for filled buttons, `accent.fg` for links, `accent.focusRing` for every focus ring; `border.control` is ink too, the edge of every control.
- **Red, for trouble**: `red.fg` and `red.subtle` for a live SLA breach, a failure and invalid fields, `red.solid` with `red.contrast` for the SLA stamp. No button is red, closing a ticket included: it is an ink action whose dialog says in Ink that it is final.
- **Amber and green, for lamps and notes**: `amber.*` for an internal note and a clock running out, `green.solid` for a clock with time left. They never colour an action.

Radii are `stamp` (3px), `control` (8px) and `panel` (12px), the ink line is `borderWidths.ink` (1.5px) and the one shadow is `shadows.raised`. The fonts are self-hosted through `@fontsource` packages imported in `frontend/src/fonts.ts`, never in `theme.ts`, whose `chakra typegen` (the `prepare` script) has no loader for font files: `heading` (Jersey 25), `body` (IBM Plex Sans) and `mono` (IBM Plex Mono). Buttons take their type, radius, edge and shadow from the `button` recipe in `theme.ts`, so a call site sets only `variant`, `size` and `colorPalette`. Font sizes elsewhere are still literals at call sites, recorded as known drift in DESIGN.md; until they become tokens, new code takes its size from DESIGN.md's type scale ([Typography](../../../../DESIGN.md#typography)) and adds no size the scale does not have.

### No Colour Literals in Components
Components never use hex, rgb or named colour literals; they use semantic tokens (`bg`, `fg.muted`, `border`, `accent.solid`, ...). Tests assert state through roles, `aria-*` and `data-*`, never computed colours.

### Shared Primitives in `components/ui`
Recurring building blocks live in `frontend/src/components/ui` and are reused, not re-styled per feature: the app shell, page header, panel, window panel, lamp, chip, form field and labels, password field, control style (`CONTROL_STYLE`, `TOUCH_FLOOR`), multi-select, search combobox, segmented toggle, ready button, problem text, empty state, data table, dialog, language selector, offline notice, route error. A feature that needs a variant extends the primitive rather than copying it. Their looks and states are in [DESIGN.md › Components](../../../../DESIGN.md#components).

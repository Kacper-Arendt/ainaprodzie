## Responsive Design

The layouts themselves (the shell, the ticket page's columns, the table's three forms, the filter bar on a phone) are described in [DESIGN.md › Layout](../../../../DESIGN.md#layout); these are the rules they follow.

### Mobile-First
Write responsive values mobile-first, as Chakra's responsive props read them: the `base` value is the phone's, wider widths override it.

### Chakra's Breakpoints Are the Switch Points
Layouts switch at Chakra's breakpoints (`sm`, `md`, `lg`, `xl`) through responsive props or the `sm`/`md`/`lg` conditions in `css`; no hand-written width media queries with pixel values of their own. Media queries on other features (`pointer: coarse`, `prefers-reduced-motion`) are fine.

### Fixed Geometry Where State Varies
Layouts are fluid between their switch points (flexible rows, wrapping clusters, columns that take the rest), but widths that keep things from moving are fixed in pixels on purpose: state-dependent table columns, the facts column, the login card, reserved slots for changing text ([css.md](css.md)). Sizes are written in `px`, the unit DESIGN.md and the code use; there is no rem scale.

### Cross-Device Testing
Check a layout at phone width (320 and 375px), at each breakpoint and at desktop widths.

### Touch-Friendly
On a coarse pointer every button, input, select, combobox and option is at least 44px tall (buttons also 44px wide) and control text is 16px (the Touch Floor Rule in [DESIGN.md › Layout](../../../../DESIGN.md#layout)). The floor is set once in `globalCss` in `theme.ts`; a control whose own `min-height` or `min-width` outranks it restates it with `TOUCH_FLOOR` from `components/ui/control-style.ts`. Test for the pointer, not the width: a touch laptop is wide.

### Readable Typography
Body text stays at 15px at every width; nothing is set below the chip's 11px ([DESIGN.md › Typography](../../../../DESIGN.md#typography)).

### Content Priority
Source order is the reading order on a phone and for the keyboard; a wider layout moves blocks beside each other without reordering them in the DOM.

## CSS

The values these rules apply (control heights, column widths, slot widths) are in [DESIGN.md](../../../../DESIGN.md); its Nothing Moves and One Row Height rules under [Layout](../../../../DESIGN.md#layout) point back here.

### Styling Through Chakra
All styling goes through Chakra UI v3: style props, recipes, `css` objects and `globalCss` in `theme.ts` ([design-system.md](design-system.md)). Use its patterns as intended rather than fighting them with overrides; when a recipe's spacing gets in the way, reset that one property on the call site (see the combobox below).

### Controls Sharing a Form Row Share One Geometry
Every desktop form control in a row has one height: inputs, native selects, comboboxes and any custom input. A segmented toggle or a button group sitting in the same row matches that height and the fields' corner radius; on a coarse pointer the row takes the touch floor from [responsive.md](responsive.md), and still keeps one height.
Every control in a row has the same label row (a `FieldLabel` with the same gap) and nothing else above it. Reset spacing a library wrapper adds on its own: Chakra's `Combobox.Root` recipe sets `gap: 1.5`, so a combobox in a form row passes `gap="0"`. A visually hidden label adds no margin: `FormField` drops its label-row `mb` when `labelHidden`, and a group caption stands for the hidden labels.
Check alignment in a real browser by comparing the controls' bounding-box top and height, because jsdom does no layout.

### No Context Shifts: A Change of State Never Moves Untouched Controls
A change of state (a scope, a filter, an empty or loading period, enabled vs disabled) must never move a control the reader did not touch. Take extra care here: these shifts are usually found by users, not by tests.
Every state of one control draws the same geometry: a disabled or loading variant keeps the enabled one's content and width (a menu button draws the same face, caret included, in both states).
A cluster whose content changes width with state reserves a fixed-width slot for the changing part, so where the cluster wraps never depends on the state (a pager, a date range, or nothing, all in one fixed slot; date inputs have a fixed width).
Group by edge rather than one aligned row: controls that belong together hold one edge (filters the leading edge with `me="auto"`, page actions the trailing edge), so a width change on one side never moves the other.
A header cluster whose width varies by state takes its own row under the title at every width, never jumping between beside and under the title.
What the reader unfolds grows downward from the control they touched: picking Resolved unfolds the resolution field under Status, Link a ticket unfolds its form in its own place, Filters unfolds the grid under the bar. Content below that point may move down; nothing beside or above it moves. Don't reserve empty space for a part that unfolds only on the reader's action.
A page whose one card stands alone on the viewport (the login screen) hangs the card from a fixed top offset instead of centring it vertically: a validation error adds a line under its field, and a centred card would then move everything above the error.
Verify in a real browser by comparing the controls' bounding boxes across every state (each scope, enabled and disabled, empty and full) at several widths (375, 1024, 1280, 1300, 1440, 1920) and in both locales: each width must yield exactly one layout. jsdom does no layout and cannot catch this.

### Fixed Table Layout for State-Dependent Cells
A data table whose cells hold content that varies by state (status chips, an optional action) uses `table-layout: fixed` with explicit widths for the state-dependent columns, so adding or removing a chip moves no column. Verify by comparing bounding boxes across rows in every state. The widths of the ticket table are in [DESIGN.md › Ticket Table](../../../../DESIGN.md#ticket-table-signature).

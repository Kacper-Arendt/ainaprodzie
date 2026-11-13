## Accessibility

The accessible names, live regions and focus moves of each component are specified in [DESIGN.md › Components](../../../../DESIGN.md#components); these are the rules behind them.

### Semantic HTML
Use appropriate elements (nav, main, button) that convey meaning to assistive technologies.

### Keyboard Navigation
Make all interactive elements accessible via keyboard with visible focus indicators: a 2px `accent.focusRing` ring on `:focus-visible`, on every control, whatever its colour palette.

### Color Contrast
Maintain 4.5:1 contrast for text and 3:1 for the edges and states of controls (WCAG 2.2 AA non-text contrast, which `border.control` meets); the measured ratios are in [DESIGN.md › Colors](../../../../DESIGN.md#colors). Don't rely solely on colour to convey information: every colour signal is paired with words.

### Alt Text and Labels
Provide descriptive alt text for images and labels for form inputs.

### Screen Reader Checks
Check what a screen reader hears through the accessibility tree: tests query by role and accessible name, and a new view's names, landmarks and live regions are read in a real browser's accessibility snapshot.

### ARIA When Needed
Use ARIA attributes to enhance complex components when semantic HTML isn't enough.

### Heading Structure
Use heading levels (h1-h6) in proper order for clear document outline.

### Focus Management
Manage focus appropriately in dynamic content, modals, and SPAs.

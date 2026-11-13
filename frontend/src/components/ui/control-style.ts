const COARSE_POINTER = '@media (pointer: coarse)'

// The one control geometry (standards/frontend/css.md). A danger border marks
// `aria-invalid`. On a touch screen the text is 16px, below which iOS Safari
// zooms the page on focus. It sits in `css`, which outranks the recipe and
// survives a call site's own `fontSize`; a primitive that takes a caller's
// `css` passes both (`css={[CONTROL_STYLE.css, props.css]}`).
export const CONTROL_STYLE = {
  bg: 'bg.panel',
  borderWidth: 'ink',
  borderColor: 'border.control',
  borderRadius: 'control',
  fontSize: '15px',
  focusRingColor: 'accent.focusRing',
  _invalid: { borderColor: 'red.fg', focusRingColor: 'red.fg' },
  css: { [COARSE_POINTER]: { fontSize: '16px' } },
} as const

// The 44px touch floor restated on a control whose own min-height or min-width
// (a recipe's, such as a close button's, or its `minH`) outranks the global
// floor in theme.ts.
export const TOUCH_FLOOR = { [COARSE_POINTER]: { minHeight: '44px', minWidth: '44px' } } as const

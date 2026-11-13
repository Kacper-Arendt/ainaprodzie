import { createSystem, defaultConfig, defineConfig, defineRecipe } from '@chakra-ui/react'

// Design system per DESIGN.md ("Paper and Ink", the course's own world): paper
// grounds, ink lines and text, red only for trouble, amber for internal notes,
// lamps for who owes a first response. Components read these semantic tokens
// and never a color literal.
const INK = '#1d1d1b'

const config = defineConfig({
  globalCss: {
    // The scrollbar's room is kept when a short page has none, so the centred
    // column never shifts as content comes and goes (the Nothing Moves Rule).
    // Jersey 25 has one weight: a bold heading in it must never be faked.
    html: {
      colorScheme: 'light',
      scrollbarGutter: 'stable',
      scrollbarColor: 'var(--chakra-colors-fg-muted) var(--chakra-colors-bg)',
      fontSynthesis: 'none',
    },
    body: { bg: 'bg', color: 'fg', fontSize: '15px' },
    '::selection': { bg: 'fg', color: 'bg' },
    // Chakra draws placeholders in `fg.muted/80`, 3.8:1 on a panel; the full
    // token meets the 4.5:1 text contrast. Same selector, so this one wins.
    '*::placeholder, *[data-placeholder]': { color: 'fg.muted' },
    // Touch screens get the 44px tap floor (standards/frontend/responsive.md) on
    // every control at once, so a form row keeps one height there too. A recipe
    // or style prop outranks this layer, so a control that sets its own
    // min-height or min-width (every icon button's size recipe does) restates
    // the floor (`TOUCH_FLOOR`), and the 16px touch text
    // lives in `CONTROL_STYLE`. A link drawn as a button (`Button asChild`) carries
    // the recipe's `chakra-button` class and takes the floor too; a text link does not.
    'button, a.chakra-button, select, input, [role="combobox"], [role="option"]': {
      '@media (pointer: coarse)': { minHeight: '44px' },
    },
    'button, a.chakra-button': { '@media (pointer: coarse)': { minWidth: '44px' } },
  },
  theme: {
    tokens: {
      fonts: {
        heading: { value: `'Jersey 25', 'VT323', 'Courier New', monospace` },
        body: { value: `'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif` },
        mono: { value: `'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace` },
      },
    },
    semanticTokens: {
      radii: {
        // Stamps (status, role, SLA).
        stamp: { value: '3px' },
        // Inputs, comments and inline alerts.
        control: { value: '8px' },
        // Cards, panels and dialogs.
        panel: { value: '12px' },
      },
      borderWidths: {
        // The ink line of every panel, control and button; hairlines stay 1px.
        ink: { value: '1.5px' },
      },
      shadows: {
        // The course's hard offset: a raised card (the ticket's description,
        // dialogs, menus, the offline notice), never a row or a plain panel.
        raised: { value: `4px 4px 0 ${INK}` },
      },
      colors: {
        bg: {
          // Paper.
          DEFAULT: { value: '#f0eade' },
          // Sheet: panels, inputs, table rows, dialogs.
          panel: { value: '#fbf8f1' },
          // Card: window bars, the table header, public comments, hover.
          subtle: { value: '#f6f2e9' },
          // Tone: a step darker than paper, for quiet fills.
          muted: { value: '#e8e0cf' },
        },
        fg: {
          // Ink.
          DEFAULT: { value: INK },
          // Ink 2: 6.3:1 on paper, 7:1 on a sheet.
          muted: { value: '#57544d' },
        },
        border: {
          // Hairline: dividers and the edges that only group, never a control's.
          DEFAULT: { value: '#cdc5b4' },
          // Every control's edge is ink: 16:1, far past non-text contrast.
          control: { value: INK },
        },
        // The action colour is ink: filled primary buttons, reference links,
        // the focus ring. `colorPalette="accent"` resolves every role a recipe reads.
        accent: {
          solid: { value: INK },
          contrast: { value: '#fbf8f1' },
          fg: { value: INK },
          subtle: { value: '#f6f2e9' },
          muted: { value: '#e8e0cf' },
          focusRing: { value: INK },
          // An ink button's hard shadow, a warm grey that still reads on paper.
          shadow: { value: '#9b927f' },
        },
        // The default palette of outline and ghost buttons: ink text and edge.
        gray: {
          fg: { value: INK },
          subtle: { value: '#f6f2e9' },
          muted: { value: '#e8e0cf' },
          focusRing: { value: INK },
          shadow: { value: INK },
        },
        // Trouble only: a live SLA breach, a failure, invalid fields. No button
        // is red. Red text on a sheet measures 5.5:1, on its wash 4.8:1; white on
        // the fill 4.9:1.
        red: {
          fg: { value: '#c4201b' },
          subtle: { value: '#f7e4df' },
          solid: { value: '#d9281f' },
          contrast: { value: '#ffffff' },
        },
        // Internal notes and the lamp for a clock that is running out. The ink
        // tone on the wash measures 5.6:1; the dashed edge 3.3:1.
        amber: {
          solid: { value: '#e0a100' },
          fg: { value: '#7a5800' },
          subtle: { value: '#f7edcf' },
          border: { value: '#a87a00' },
        },
        // The lamp for a ticket that owes nobody a first response.
        green: {
          solid: { value: '#2f9b57' },
        },
      },
    },
    recipes: {
      // The course's buttons: mono uppercase pills on an ink line with a hard
      // shadow that the press slides into. Call sites set no type, radius or edge.
      button: defineRecipe({
        base: {
          borderRadius: 'full',
          borderWidth: 'ink',
          fontFamily: 'mono',
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          transitionProperty: 'background-color, box-shadow, transform',
          transitionDuration: '80ms',
          transitionTimingFunction: 'ease-out',
          _active: { transform: 'translate(3px, 3px)', boxShadow: 'none' },
          _disabled: { _active: { transform: 'none' } },
          _motionReduce: { transition: 'none' },
        },
        variants: {
          size: {
            xs: { h: '32px', minW: '32px', px: '12px', fontSize: '11px' },
            sm: { h: '36px', minW: '36px', px: '14px', fontSize: '12px' },
            md: { h: '40px', minW: '40px', px: '18px', fontSize: '13px' },
          },
          variant: {
            solid: {
              borderColor: 'colorPalette.solid',
              shadowColor: 'colorPalette.shadow',
              boxShadow: '3px 3px 0 var(--shadow-color)',
              _hover: { bg: 'colorPalette.solid/88' },
            },
            outline: {
              bg: 'bg.panel',
              borderColor: 'colorPalette.fg',
              color: 'colorPalette.fg',
              shadowColor: 'colorPalette.fg',
              boxShadow: '3px 3px 0 var(--shadow-color)',
              _hover: { bg: 'bg.subtle' },
              _expanded: { bg: 'bg.subtle' },
            },
            ghost: {
              borderColor: 'transparent',
              color: 'colorPalette.fg',
              _hover: { bg: 'bg.subtle' },
              _active: { transform: 'none' },
            },
          },
        },
      }),
    },
  },
})

export const system = createSystem(defaultConfig, config)

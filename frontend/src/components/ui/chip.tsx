import type { ReactNode } from 'react'
import { Text } from '@chakra-ui/react'

/**
 * `neutral`: an ink outline on a sheet (status, role, internal note). `ink`: filled
 * ink, for the one priority that cannot wait. `danger`: filled red, for a live SLA breach only.
 */
export type ChipTone = 'neutral' | 'ink' | 'danger'

const TONES: Record<ChipTone, { bg: string; color: string; borderColor: string }> = {
  neutral: { bg: 'bg.panel', color: 'fg', borderColor: 'border.control' },
  ink: { bg: 'fg', color: 'bg.panel', borderColor: 'fg' },
  danger: { bg: 'red.solid', color: 'red.contrast', borderColor: 'red.solid' },
}

/**
 * A stamp beside a name or in a table cell: a role, a status, an internal-note marker.
 * Mono capitals on an ink line, so it carries its own fill onto any surface.
 */
export function Chip(props: { tone?: ChipTone; children: ReactNode }) {
  const tone = props.tone ?? 'neutral'
  return (
    <Text
      as="span"
      data-tone={tone}
      display="inline-block"
      {...TONES[tone]}
      borderWidth="ink"
      borderRadius="stamp"
      px="6px"
      fontFamily="mono"
      fontSize="11px"
      // Its own line height, not the surrounding text's: 19px tall in all, so a chip on a
      // line of 14px text sits inside that line and a row with one is as tall as one without.
      lineHeight="16px"
      fontWeight="600"
      letterSpacing="0.06em"
      textTransform="uppercase"
      whiteSpace="nowrap"
    >
      {props.children}
    </Text>
  )
}

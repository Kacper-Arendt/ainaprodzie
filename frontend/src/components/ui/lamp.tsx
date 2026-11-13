import { Box } from '@chakra-ui/react'

/**
 * Who owes a first response: `red` past the response deadline (a live SLA breach),
 * `amber` the clock is running out or a customer's comment waits, `green` nobody
 * owes one now, `off` the clock is settled.
 */
export type LampTone = 'red' | 'amber' | 'green' | 'off'

const FILL: Record<LampTone, string> = {
  red: 'red.solid',
  amber: 'amber.solid',
  green: 'green.solid',
  off: 'transparent',
}

/**
 * The course's square signal light beside a clock or a count. Never alone: the
 * words next to it carry the state, so it is hidden from assistive technology.
 */
export function Lamp(props: { tone: LampTone; size?: string }) {
  const size = props.size ?? '9px'
  return (
    <Box
      as="span"
      aria-hidden="true"
      data-lamp={props.tone}
      display="inline-block"
      flexShrink="0"
      w={size}
      h={size}
      bg={FILL[props.tone]}
      borderWidth="ink"
      borderColor={props.tone === 'off' ? 'border' : FILL[props.tone]}
    />
  )
}

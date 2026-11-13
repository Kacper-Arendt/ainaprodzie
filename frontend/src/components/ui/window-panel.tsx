import type { ReactNode } from 'react'
import { Box, Flex, Text } from '@chakra-ui/react'
import type { BoxProps } from '@chakra-ui/react'
import { Lamp, type LampTone } from './lamp.tsx'

const SIGNALS = ['red', 'amber', 'green'] as const

/**
 * The course's log card: a panel under a bar that names what it holds in mono
 * (`name`), with three lamps on the leading edge and a fact on the trailing
 * one (`meta`). `lamp` lights the one that says who owes a first response (red,
 * amber or green, in that order); without it the three stay dark. `raised` lifts the card with the hard shadow, for the one card a page leads with.
 */
export function WindowPanel({
  name,
  meta,
  lamp,
  raised,
  children,
  ...props
}: BoxProps & { name: ReactNode; meta?: ReactNode; lamp?: LampTone; raised?: boolean }) {
  return (
    <Box
      bg="bg.panel"
      borderWidth="ink"
      borderColor="border.control"
      borderRadius="panel"
      boxShadow={raised ? 'raised' : undefined}
      overflow="hidden"
      mb="20px"
      {...props}
    >
      <Flex
        align="center"
        gap="12px"
        px={{ base: '16px', sm: '20px' }}
        py="9px"
        bg="bg.subtle"
        borderBottomWidth="ink"
        borderColor="border.control"
      >
        <Flex as="span" gap="4px" aria-hidden="true">
          {SIGNALS.map((signal) => (
            <Lamp key={signal} tone={signal === lamp ? signal : 'off'} size="10px" />
          ))}
        </Flex>
        <Text
          flex="1"
          minW="0"
          truncate
          fontFamily="mono"
          fontSize="13px"
          fontWeight="600"
          letterSpacing="0.02em"
        >
          {name}
        </Text>
        {meta !== undefined && (
          <Text
            flexShrink="0"
            fontFamily="mono"
            fontSize="11px"
            fontWeight="600"
            letterSpacing="0.08em"
            textTransform="uppercase"
            color="fg.muted"
          >
            {meta}
          </Text>
        )}
      </Flex>
      {children}
    </Box>
  )
}

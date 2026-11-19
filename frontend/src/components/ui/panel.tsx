import type { ReactNode } from 'react'
import { Box, Flex, Heading } from '@chakra-ui/react'
import type { BoxProps } from '@chakra-ui/react'

/** The sheet a page is built from: an ink line at the panel radius. */
export function Panel(props: BoxProps) {
  return (
    <Box
      bg="bg.panel"
      borderWidth="ink"
      borderColor="border.control"
      borderRadius="panel"
      px={{ base: '16px', sm: '20px' }}
      py="18px"
      mb="20px"
      {...props}
    />
  )
}

/** A panel's title in the pixel display face, with an optional action on the trailing edge; `id` lets the panel be named by it. */
export function PanelHead(props: { title: string; action?: ReactNode; id?: string }) {
  return (
    <Flex align="center" gap="3" wrap="wrap" mb="14px">
      <Heading
        id={props.id}
        as="h2"
        flex="1"
        fontSize="26px"
        lineHeight="1"
        fontWeight="normal"
        textTransform="uppercase"
        letterSpacing="0.01em"
        textWrap="balance"
      >
        {props.title}
      </Heading>
      {props.action}
    </Flex>
  )
}

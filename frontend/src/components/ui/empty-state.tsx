import type { ReactNode } from 'react'
import { Box, Flex, Text } from '@chakra-ui/react'
import { PageHeading } from './page-header.tsx'

/** The `icon` of a not-found state: a large pixel 404 in ink, set rather than drawn. */
export function NotFoundMark() {
  return (
    <Text
      as="span"
      display="block"
      fontFamily="heading"
      fontSize="96px"
      lineHeight="0.9"
      color="fg"
    >
      404
    </Text>
  )
}

/**
 * A list or panel with nothing in it: an icon, a bold title, the hint
 * (`children`) and the one action that would put something there. Centred, so
 * an empty card does not read as a half-loaded one.
 *
 * A state that stands for the whole page (not found, a failed route) is
 * `headline`: its title is then the page's h1, in the pixel display face, which
 * names the browser tab and takes the focus on arrival as `PageHeader`'s does.
 */
export function EmptyState(props: {
  icon?: ReactNode
  title?: string
  headline?: boolean
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <Flex direction="column" align="center" textAlign="center" px="12px" py="36px" color="fg.muted">
      {props.icon !== undefined && (
        <Box aria-hidden="true" fontSize="28px" lineHeight="1" mb="12px">
          {props.icon}
        </Box>
      )}
      {props.title !== undefined &&
        (props.headline === true ? (
          <PageHeading title={props.title} fontSize="32px" color="fg" mb="8px" />
        ) : (
          <Text as="strong" display="block" fontWeight="bold" color="fg" mb="4px">
            {props.title}
          </Text>
        ))}
      {props.children}
      {props.action !== undefined && <Box mt="16px">{props.action}</Box>}
    </Flex>
  )
}

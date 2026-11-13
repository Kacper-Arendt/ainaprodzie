import { useRef, type ReactNode } from 'react'
import {
  Box,
  Flex,
  Heading,
  HStack,
  Text,
  VisuallyHidden,
  type HeadingProps,
} from '@chakra-ui/react'
import { usePageTitle } from './page-title.ts'
import { useArrivalFocus } from './use-arrived.ts'

/**
 * The display steps of a page's h1: a title longer than a step's `upTo`
 * characters is set one size smaller and on a wider measure, so a title of the
 * 200 characters a ticket allows takes four lines and never pushes the page's
 * content below the first screen. The sizes are the scale's own (DESIGN.md ›
 * Typography).
 */
const DISPLAY_STEPS = [
  { step: 'large', upTo: 40, fontSize: { base: '36px', md: '48px' }, maxW: '26ch' },
  { step: 'medium', upTo: 90, fontSize: { base: '30px', md: '36px' }, maxW: '44ch' },
  { step: 'long', upTo: Infinity, fontSize: '26px', maxW: '56ch' },
] as const

/**
 * The head of a page: the h1 (`PageHeading`), an optional one-line subtitle and
 * actions on the trailing edge. The `reference` of a ticket is part of the h1,
 * on a line of its own above the title, and the title's length picks the size.
 */
export function PageHeader(props: {
  title: string
  reference?: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  const { step, fontSize, maxW } = DISPLAY_STEPS.find((it) => props.title.length <= it.upTo)!
  return (
    <Flex as="header" align="flex-end" gap="4" wrap="wrap" mb="20px">
      <Box minW="0" flex="1000 1 320px">
        <PageHeading
          title={props.title}
          reference={props.reference}
          data-step={step}
          fontSize={fontSize}
          maxW={maxW}
          overflowWrap="anywhere"
        />
        {props.subtitle !== undefined && (
          <Text color="fg.muted" mt="8px">
            {props.subtitle}
          </Text>
        )}
      </Box>
      {props.actions !== undefined && (
        <HStack gap="3" wrap="wrap" flex="1 1 auto" justify="flex-end">
          {props.actions}
        </HStack>
      )}
    </Flex>
  )
}

/**
 * A page's h1, drawn by `PageHeader` and by a `headline` `EmptyState`: it names
 * the browser tab, and takes the focus when the reader arrives from another
 * page (`useArrivalFocus`). A `reference` leads both the name and the tab, and
 * is drawn as a mono line above the title.
 */
export function PageHeading({
  title,
  reference,
  ...props
}: HeadingProps & { title: string; reference?: string }) {
  usePageTitle(reference === undefined ? title : `${reference} · ${title}`)
  const heading = useRef<HTMLHeadingElement>(null)
  useArrivalFocus(heading)
  return (
    <Heading
      ref={heading}
      as="h1"
      tabIndex={-1}
      // Focused by the app, not reached by Tab: a heading is no control, so no ring.
      _focus={{ outline: 'none' }}
      fontWeight="normal"
      lineHeight="0.95"
      letterSpacing="0.01em"
      textTransform="uppercase"
      textWrap="balance"
      {...props}
    >
      {reference !== undefined && (
        <Text
          as="span"
          data-reference
          display="block"
          mb="6px"
          color="fg.muted"
          fontFamily="mono"
          fontSize="13px"
          fontWeight="600"
          lineHeight="1.5"
          letterSpacing="0.02em"
          textTransform="none"
        >
          {reference} <VisuallyHidden>·</VisuallyHidden>
        </Text>
      )}
      {title}
    </Heading>
  )
}

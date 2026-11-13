import { useId } from 'react'
import { Box, Flex, Grid, Link, Text, VisuallyHidden } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Lamp, type LampTone } from '../../components/ui/lamp.tsx'
import type { Attention, TicketCounts } from './use-tickets.ts'

/** Each count beside the filter that lists its tickets, live breaches first, as in the queue. */
const DESK_COUNTS = [
  { key: 'pastDeadline', attention: 'PAST_DEADLINE', lamp: 'red' },
  { key: 'dueWithinHour', attention: 'DUE_WITHIN_HOUR', lamp: 'amber' },
  { key: 'unansweredCustomerComment', attention: 'UNANSWERED_CUSTOMER_COMMENT', lamp: 'amber' },
  { key: 'unassigned', attention: 'UNASSIGNED', lamp: 'off' },
] as const satisfies { key: keyof TicketCounts; attention: Attention; lamp: LampTone }[]

/**
 * A strip of four counts above support staff's queue, before its search and
 * filters, saying what on the whole desk needs a person now, whatever the list
 * shows: each a large pixel number with its lamp (lit above zero) and its words.
 * A count above zero links to the list narrowed to exactly its tickets
 * (`search` gives that list's query string; the count `current` names is
 * marked as the page and drawn in ink). The first count is the live breaches
 * only, worded so it reads apart from the SLA filter's Breached, which also
 * holds the breaches already answered or closed. The strip keeps its
 * height while the counts load, so nothing under it moves. On a phone the
 * four cells fold two by two.
 */
export function DeskSummary(props: {
  counts: TicketCounts | undefined
  current: Attention | undefined
  search: (attention: Attention) => string
}) {
  const { t } = useTranslation('common')
  const labelId = useId()
  const { counts } = props

  return (
    <Box
      bg="bg.panel"
      borderWidth="ink"
      borderColor="border.control"
      borderRadius="panel"
      overflow="hidden"
      mb="20px"
    >
      <VisuallyHidden id={labelId}>{t('tickets.desk.label')}</VisuallyHidden>
      <Grid
        as="ul"
        aria-labelledby={labelId}
        templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }}
        listStyleType="none"
        m="0"
        p="0"
        // Hairlines between the cells: each cell draws its leading and top edge.
        css={{
          '& > li': { borderColor: 'border' },
          '& > li + li': { borderInlineStartWidth: '1.5px' },
          '@media (max-width: 47.99em)': {
            '& > li:nth-of-type(3)': { borderInlineStartWidth: '0' },
            '& > li:nth-of-type(n + 3)': { borderTopWidth: '1.5px' },
          },
        }}
      >
        {DESK_COUNTS.map(({ key, attention, lamp }) => {
          const count = counts?.[key]
          const live = count !== undefined && count > 0
          const current = props.current === attention
          const cell = (
            <Grid
              templateColumns="auto minmax(0, 1fr)"
              columnGap="12px"
              alignItems="center"
              h="full"
              minH="76px"
              px={{ base: '14px', sm: '18px' }}
              py="14px"
            >
              <Text
                as="span"
                data-attention={live || undefined}
                fontFamily="heading"
                fontSize={{ base: '36px', sm: '44px' }}
                lineHeight="0.9"
                minW="1ch"
                color={
                  current ? 'bg.panel' : live ? (lamp === 'red' ? 'red.fg' : 'fg') : 'fg.muted'
                }
                fontVariantNumeric="tabular-nums"
              >
                {count ?? ''}
              </Text>
              {/* Whitespace a grid ignores, so the count and its words are read apart. */}{' '}
              {count !== undefined && (
                <Flex as="span" align="baseline" gap="8px" minW="0">
                  <Lamp tone={live ? lamp : 'off'} />
                  <Text as="span" fontSize="13px" lineHeight="1.35">
                    {t(`tickets.desk.${key}`, { count })}
                  </Text>
                </Flex>
              )}
            </Grid>
          )
          return (
            <Box
              as="li"
              key={key}
              minW="0"
              bg={current ? 'fg' : undefined}
              color={current ? 'bg.panel' : 'fg.muted'}
            >
              {/* An empty count has no list to open. */}
              {live ? (
                <Link
                  asChild
                  display="block"
                  h="full"
                  color="inherit"
                  textDecoration="none"
                  _hover={current ? undefined : { bg: 'bg.subtle', color: 'fg' }}
                  css={{ '&:hover span span:last-child': { textDecoration: 'underline' } }}
                  focusRingColor="accent.focusRing"
                  focusRingOffset="-4px"
                >
                  <RouterLink
                    to={{ search: props.search(attention) }}
                    replace
                    aria-current={current ? 'page' : undefined}
                  >
                    {cell}
                  </RouterLink>
                </Link>
              ) : (
                cell
              )}
            </Box>
          )
        })}
      </Grid>
    </Box>
  )
}

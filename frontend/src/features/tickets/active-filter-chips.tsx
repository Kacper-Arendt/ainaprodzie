import { useEffect, useRef } from 'react'
import { Box, Button, Flex, Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import type { ActiveFilter } from './use-active-filters.ts'

/**
 * The active filters as a wrapping row of chips, each a button that lifts its
 * filter, and after them, once there are several, Clear all (`onClearAll`),
 * which lifts every one. After a removal the focus moves to the chip that took
 * its place, to the one before when it was the last, or to `fallbackFocusId`
 * when none is left, as it does after Clear all. With no filters it renders
 * nothing but stays mounted, so the focus still moves after the last chip goes.
 */
export function ActiveFilterChips(props: {
  filters: ActiveFilter[]
  onRemove: (filter: ActiveFilter) => void
  onClearAll: () => void
  fallbackFocusId: string
}) {
  const { t } = useTranslation('common')
  const { filters, fallbackFocusId } = props
  const list = useRef<HTMLUListElement>(null)
  const removed = useRef<{ key: string; index: number }>(null)

  // Runs once the URL no longer holds the removed filter, not on the click.
  useEffect(() => {
    const pending = removed.current
    if (pending === null || filters.some((filter) => filter.key === pending.key)) return
    removed.current = null
    const chips = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('button[aria-label]') ?? [],
    )
    const next =
      chips[Math.min(pending.index, chips.length - 1)] ?? document.getElementById(fallbackFocusId)
    next?.focus()
  })

  if (filters.length === 0) return null
  return (
    <Flex asChild wrap="wrap" gap="8px" mb="16px" p="0" listStyleType="none">
      <ul ref={list} aria-label={t('tickets.filters.active.label')}>
        {filters.map((filter, index) => (
          <Box as="li" key={filter.key} maxW="full">
            <Button
              type="button"
              variant="outline"
              size="xs"
              maxW="full"
              gap="6px"
              ps="10px"
              pe="8px"
              bg="bg.panel"
              aria-label={t('tickets.filters.active.remove', { filter: filter.label })}
              onClick={() => {
                removed.current = { key: filter.key, index }
                props.onRemove(filter)
              }}
            >
              <Text as="span" truncate>
                {filter.label}
              </Text>
              <RemoveMark />
            </Button>
          </Box>
        ))}
        {filters.length > 1 && (
          <Box as="li">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                props.onClearAll()
                document.getElementById(fallbackFocusId)?.focus()
              }}
            >
              {t('tickets.filters.active.clearAll')}
            </Button>
          </Box>
        )}
      </ul>
    </Flex>
  )
}

/** The cross after a chip's label, in Ink Muted so the filter's name leads. */
function RemoveMark() {
  return (
    <Box as="span" display="inline-flex" flexShrink="0" color="fg.muted" aria-hidden="true">
      <svg
        viewBox="0 0 10 10"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M2 2l6 6M8 2L2 8" />
      </svg>
    </Box>
  )
}

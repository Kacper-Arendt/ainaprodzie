import { Button, Flex, Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'

/**
 * Why an action failed, where the reader is looking. `role="alert"` so the
 * sentence reaches a screen reader that is focused on the button below it
 * (standards/frontend/accessibility.md).
 *
 * A failed load passes `onRetry`, which adds Try again on the trailing edge;
 * `retrying` disables it while the new attempt runs, keeping its label and
 * width. The button sits beside the alert, not inside it, so the alert stays
 * plain text.
 *
 * `flush` drops the top margin, for an alert that opens its container rather
 * than following a form.
 */
export function ProblemText(props: {
  error: string | undefined
  onRetry?: () => void
  retrying?: boolean
  flush?: boolean
}) {
  const { t } = useTranslation('common')
  if (props.error === undefined) return null
  return (
    <Flex
      align="center"
      wrap="wrap"
      columnGap="12px"
      rowGap="8px"
      bg="red.subtle"
      borderWidth="ink"
      borderColor="red.fg"
      borderRadius="control"
      px="12px"
      py="10px"
      mt={props.flush ? undefined : '14px'}
    >
      <Text role="alert" color="red.fg" fontSize="14px" flex="1 1 240px" minW="0">
        {props.error}
      </Text>
      {props.onRetry !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          bg="bg.panel"
          disabled={props.retrying === true}
          onClick={props.onRetry}
        >
          {t('errors.retry')}
        </Button>
      )}
    </Flex>
  )
}

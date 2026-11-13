import { useEffect } from 'react'
import { Button, Text } from '@chakra-ui/react'
import { useBlocker } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/dialog.tsx'
import { activeLanguage } from '../../i18n/index.ts'

const KEEP_ID = 'unsaved-draft-keep'

/**
 * Holds a navigation away from a ticket while its details draft is unsaved and
 * asks first, naming the changed fields; Keep editing is the default, so
 * Enter or Escape never throws the draft away. Closing the tab or reloading
 * gets the browser's own question. Without a `reference` the draft is a new
 * ticket not created yet.
 */
export function UnsavedDraftGuard(props: { reference?: string; fields: string[] }) {
  const { t } = useTranslation('common')
  const language = activeLanguage()
  const unsaved = props.fields.length > 0
  const blocker = useBlocker(unsaved)
  const blocked = blocker.state === 'blocked'

  useEffect(() => {
    if (!unsaved) return
    const ask = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [unsaved])

  const fields = new Intl.ListFormat(language, { type: 'conjunction' }).format(
    props.fields.map((field) => field.toLocaleLowerCase(language)),
  )

  return (
    <Dialog
      open={blocked}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
      title={props.reference === undefined ? t('tickets.leave.newTitle') : t('tickets.leave.title')}
      initialFocusEl={() => document.getElementById(KEEP_ID)}
      footer={
        <>
          <Button variant="outline" onClick={() => blocker.proceed?.()}>
            {t('tickets.leave.discard')}
          </Button>
          <Button id={KEEP_ID} colorPalette="accent" onClick={() => blocker.reset?.()}>
            {t('tickets.leave.keep')}
          </Button>
        </>
      }
    >
      <Text color="fg.muted" fontSize="14px">
        {props.reference === undefined
          ? t('tickets.leave.newBody', { fields })
          : t('tickets.leave.body', { reference: props.reference, fields })}
      </Text>
    </Dialog>
  )
}

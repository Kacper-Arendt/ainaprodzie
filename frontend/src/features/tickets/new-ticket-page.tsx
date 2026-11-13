import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Flex, Stack, Text } from '@chakra-ui/react'
import { Link as RouterLink, Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ProblemError } from '../../api/errors.ts'
import {
  FieldInput,
  FieldSelect,
  FieldTextarea,
  FormField,
} from '../../components/ui/form-field.tsx'
import { PageHeader } from '../../components/ui/page-header.tsx'
import { Panel } from '../../components/ui/panel.tsx'
import { ProblemText } from '../../components/ui/problem-text.tsx'
import { Redirect } from '../../components/ui/route-arrival.tsx'
import { useSession } from '../auth/use-auth.ts'
import { useOrganizations } from '../organization/use-organization.ts'
import { CATEGORIES, CATEGORY_KEYS } from './ticket-labels.ts'
import { fieldMessage, problemMessage } from './ticket-problems.ts'
import { UnsavedDraftGuard } from './unsaved-draft-guard.tsx'
import { useIdempotencyKey } from './use-idempotency-key.ts'
import { useCreateTicket } from './use-tickets.ts'
import type { CreateTicketRequest, TicketCategory } from './use-tickets.ts'

type FormFieldName = 'title' | 'description' | 'category'

/** Stands in for the organization's name while it loads, to size the notice. */
const SIZING_ORGANIZATION = 'Organization'

const FORM_FIELDS: readonly FormFieldName[] = ['title', 'description', 'category']

const FIELD_IDS: Record<FormFieldName, string> = {
  title: 'new-ticket-title',
  description: 'new-ticket-description',
  category: 'new-ticket-category',
}

function fieldErrors(t: TFunction, error: Error | null): Partial<Record<FormFieldName, string>> {
  if (!(error instanceof ProblemError) || error.status !== 422) return {}
  const errors: Partial<Record<FormFieldName, string>> = {}
  for (const { field, code } of error.fieldErrors) {
    if ((FORM_FIELDS as readonly string[]).includes(field)) {
      errors[field as FormFieldName] ??=
        field === 'title' && code === 'field.required'
          ? t('tickets.titleRequired')
          : fieldMessage(t, code)
    }
  }
  return errors
}

/**
 * The organization's SLA as a promise, in words as a customer's clocks are
 * ("within 4 hours", never "4 h" or "1 d").
 */
function expectation(t: TFunction, organization: string, slaMinutes: number) {
  return slaMinutes % 60 === 0
    ? t('tickets.new.expectationHours', { organization, count: slaMinutes / 60 })
    : t('tickets.new.expectationMinutes', { organization, count: slaMinutes })
}

/** The problem no field error explains, or nothing when every error sits under its field. */
function formProblem(t: TFunction, error: Error | null, hasFieldErrors: boolean) {
  if (error === null || hasFieldErrors) return undefined
  return problemMessage(t, error)
}

export function NewTicketPage() {
  const { t } = useTranslation('common')
  const session = useSession().data
  const isSupport = session?.roles.includes('SUPPORT') === true
  // A customer belongs to one organization, so the list holds just theirs.
  const organization = useOrganizations(session?.id ?? '', !isSupport).data?.[0]
  const createTicket = useCreateTicket()
  const idempotencyKey = useIdempotencyKey()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<TicketCategory | ''>('')
  // A blank title is told before anything is sent; the server still checks it.
  const [titleRequired, setTitleRequired] = useState(false)
  // Set once the ticket exists; going there in a render of its own drops the draft guard first.
  const [created, setCreated] = useState<string>()

  if (isSupport) return <Redirect to="/" />
  if (created !== undefined) return <Navigate replace to={`/tickets/${created}`} />

  const errors = titleRequired
    ? { title: t('tickets.titleRequired') }
    : fieldErrors(t, createTicket.error)
  const problem = formProblem(t, createTicket.error, Object.keys(errors).length > 0)
  // What leaving would discard. Nothing while the ticket is being created: leaving then loses nothing.
  const draftFields = createTicket.isPending
    ? []
    : [
        ...(title.trim() === '' ? [] : [t('tickets.new.title')]),
        ...(description.trim() === '' ? [] : [t('tickets.new.description')]),
        ...(category === '' ? [] : [t('tickets.new.category')]),
      ]

  const focusFirstInvalid = (invalid: Partial<Record<FormFieldName, string>>) => {
    const first = FORM_FIELDS.find((field) => invalid[field] !== undefined)
    if (first) document.getElementById(FIELD_IDS[first])?.focus()
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim() === '') {
      setTitleRequired(true)
      createTicket.reset()
      document.getElementById(FIELD_IDS.title)?.focus()
      return
    }
    setTitleRequired(false)
    // Fixed field order, so the same form contents always serialize to the same key.
    const request: CreateTicketRequest = {
      title: title.trim(),
      description,
      ...(category === '' ? {} : { category }),
    }
    createTicket.mutate(
      { request, idempotencyKey: idempotencyKey.keyFor(request) },
      {
        onSuccess: (ticket) => {
          idempotencyKey.clear()
          setCreated(ticket.summary.reference)
        },
        onError: (error) => {
          if (error instanceof ProblemError && error.slug === 'idempotency/key-reused') {
            idempotencyKey.clear()
          }
          focusFirstInvalid(fieldErrors(t, error))
        },
      },
    )
  }

  return (
    <>
      <PageHeader title={t('tickets.new.heading')} subtitle={t('tickets.new.intro')} />

      <Panel maxW="640px">
        {/* Until the organization loads, a stand-in sentence is drawn invisibly, so the notice keeps its real lines and the form never moves. */}
        <Text bg="bg.muted" borderRadius="control" px="12px" py="10px" mb="16px" fontSize="14px">
          {organization ? (
            expectation(t, organization.name, organization.firstResponseSlaMinutes)
          ) : (
            <Text as="span" visibility="hidden" aria-hidden="true">
              {expectation(t, SIZING_ORGANIZATION, 4)}
            </Text>
          )}
        </Text>
        <form onSubmit={onSubmit} noValidate>
          <Stack gap="14px">
            <FormField id={FIELD_IDS.title} label={t('tickets.new.title')} error={errors.title}>
              {(aria) => (
                <FieldInput
                  {...aria}
                  autoFocus
                  value={title}
                  onChange={(event) => {
                    setTitleRequired(false)
                    setTitle(event.target.value)
                  }}
                />
              )}
            </FormField>
            <FormField
              id={FIELD_IDS.description}
              label={`${t('tickets.new.description')} ${t('tickets.optional')}`}
              error={errors.description}
              hint={t('tickets.new.descriptionHint')}
            >
              {(aria) => (
                <FieldTextarea
                  {...aria}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </FormField>
            <FormField
              id={FIELD_IDS.category}
              label={`${t('tickets.new.category')} ${t('tickets.optional')}`}
              error={errors.category}
            >
              {(aria) => (
                <FieldSelect
                  {...aria}
                  value={category}
                  onChange={(event) => setCategory(event.target.value as TicketCategory | '')}
                >
                  <option value="">{t('tickets.new.categoryUnsure')}</option>
                  {CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {t(CATEGORY_KEYS[value])}
                    </option>
                  ))}
                </FieldSelect>
              )}
            </FormField>
          </Stack>
          <ProblemText error={problem} />
          <Flex justify="flex-end" gap="10px" mt="20px">
            <Button asChild variant="outline">
              <RouterLink to="/">{t('tickets.new.cancel')}</RouterLink>
            </Button>
            <Button type="submit" colorPalette="accent" disabled={createTicket.isPending}>
              {t('tickets.new.submit')}
            </Button>
          </Flex>
        </form>
        <UnsavedDraftGuard fields={draftFields} />
      </Panel>
    </>
  )
}

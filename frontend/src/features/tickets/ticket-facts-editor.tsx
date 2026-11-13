import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Box, Button, Flex, Stack, Text } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ProblemError } from '../../api/errors.ts'
import { FieldSelect, FieldTextarea, FormField } from '../../components/ui/form-field.tsx'
import { ReadyButton } from '../../components/ui/ready-button.tsx'
import { activeLanguage } from '../../i18n/index.ts'
import { useSession } from '../auth/use-auth.ts'
import { useTeams, type Team } from '../organization/use-organization.ts'
import {
  CATEGORIES,
  CATEGORY_KEYS,
  FIELD_KEYS,
  formatDateTime,
  label,
  nextStatuses,
  PRIORITIES,
  PRIORITY_KEYS,
  STATUS_KEYS,
} from './ticket-labels.ts'
import { fieldCode, fieldMessage } from './ticket-problems.ts'
import { UnsavedDraftGuard } from './unsaved-draft-guard.tsx'
import type { TicketWrites } from './use-ticket-writes.tsx'
import {
  ticketKeys,
  type TicketCategory,
  type TicketDetails,
  type TicketPriority,
  type TicketStatus,
} from './use-tickets.ts'

interface Facts {
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory | null
  teamId: string | null
  assigneeId: string | null
}

const fieldId = (field: keyof Facts) => `ticket-facts-${field}`

/** The editor's first control, `fieldId('status')`. */
export const STATUS_ID = 'ticket-facts-status'
const SAVE_STATE_ID = 'ticket-facts-save-state'
/** How long the line under Save says the changes were saved before it tells the update time again. */
const SAVED_MS = 5000

interface Person {
  id: string
  name: string
}

/**
 * The editable half of the support details panel: status, priority, category,
 * team and assignee as selects, and the resolution, with Discard and Save. The
 * status select offers only the moves the lifecycle allows, and on a resolved
 * ticket says how it is closed; the resolution unfolds under it only for a
 * resolved status, after a warning when the ticket has no first response yet.
 * With no team chosen the assignee lists every support staff member by team,
 * and picking one sets their team too. The draft holds only the fields the
 * reader picked, so the request carries just the changes and a refetched
 * ticket shows through every untouched control; each changed field says so,
 * Save fills with ink only once there is something to save and then stays in
 * view at the bottom of the window, the line under it says the changes are
 * unsaved, then for a moment that they were saved, and leaving the ticket
 * asks first. A 412 or 409 is explained above the panel; a
 * refused resolution is told at the field and anything else below the buttons.
 */
export function TicketFactsEditor(props: { ticket: TicketDetails; write: TicketWrites['facts'] }) {
  const { t } = useTranslation('common')
  const language = activeLanguage()
  const queryClient = useQueryClient()
  const teams = useTeams(useSession().data?.id ?? '', true)
  const [draft, setDraft] = useState<Partial<Facts>>({})
  const [resolutionDraft, setResolutionDraft] = useState<string>()
  const [resolutionError, setResolutionError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const actions = useRef<HTMLDivElement>(null)
  const stuck = useStuckToBottom(actions)
  const { summary } = props.ticket

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), SAVED_MS)
    return () => clearTimeout(timer)
  }, [saved])

  const current: Facts = {
    status: summary.status,
    priority: summary.priority,
    category: summary.category,
    teamId: summary.team?.id ?? null,
    assigneeId: summary.assignee?.id ?? null,
  }
  const facts: Facts = { ...current, ...draft }
  const storedResolution = props.ticket.resolution ?? ''
  const resolving = facts.status === 'RESOLVED'
  const resolution = resolving ? (resolutionDraft ?? storedResolution) : storedResolution
  const changes = Object.fromEntries(
    Object.entries(draft).filter(([field, value]) => current[field as keyof Facts] !== value),
  ) as Partial<Facts> & { resolution?: string }
  if (resolving && resolution !== storedResolution) changes.resolution = resolution
  const changed = Object.keys(changes).length > 0
  const changedNote = (field: keyof Facts | 'resolution') =>
    field in changes ? t('tickets.editor.changed') : undefined
  const statuses = [current.status, ...nextStatuses(current.status)]

  const teamOptions: Person[] = [...(teams.data ?? [])]
  if (summary.team && !teamOptions.some((team) => team.id === summary.team?.id)) {
    teamOptions.push(summary.team)
  }
  // The enabled members of a team, plus the ticket's own assignee on its own
  // team even when disabled, so the stored value shows and is no change. With
  // no team, the assignee is picked among every team (see `memberTeam`).
  const candidates = (teamId: string | null): Person[] => {
    const members: Person[] = [...(teams.data?.find((team) => team.id === teamId)?.members ?? [])]
    const assignee = summary.assignee
    if (assignee && teamId === current.teamId && !members.some((m) => m.id === assignee.id)) {
      members.push(assignee)
    }
    return members
  }

  const pick = (patch: Partial<Facts>) => {
    props.write.edited()
    setSaved(false)
    setDraft({ ...draft, ...patch })
  }

  const discard = () => {
    props.write.edited()
    setResolutionError(undefined)
    setDraft({})
    setResolutionDraft(undefined)
  }

  // The server clears an assignee who is not in the new team; the draft does
  // the same, so the reader sees it before saving.
  const pickTeam = (teamId: string | null) => {
    const keeps = candidates(teamId).some((person) => person.id === facts.assigneeId)
    pick({ teamId, assigneeId: keeps ? facts.assigneeId : null })
  }

  // An assignee picked while no team is chosen brings their own team: support staff belong to one.
  const memberTeam = (personId: string): Team | undefined =>
    teams.data?.find((team) => team.members.some((member) => member.id === personId))

  const pickAssignee = (assigneeId: string | null) => {
    const team = facts.teamId === null && assigneeId !== null ? memberTeam(assigneeId) : undefined
    pick(team ? { teamId: team.id, assigneeId } : { assigneeId })
  }

  const onSave = () => {
    setResolutionError(undefined)
    props.write.save(changes, {
      fields: { resolution: setResolutionError },
      onSuccess: () => {
        discard()
        setSaved(true)
      },
      explain: (error) => {
        if (!(error instanceof ProblemError) || error.status !== 422) return undefined
        // The status, a team or an assignee changed under the reader: show the server's state.
        const statusCode = fieldCode(error, 'status')
        discard()
        void teams.refetch()
        void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(summary.reference) })
        return statusCode ? fieldMessage(t, statusCode) : t('errors.generic')
      },
    })
  }

  const rows: Array<[keyof Facts, string, ReactNode]> = [
    [
      'status',
      facts.status,
      statuses.map((status) => (
        <option key={status} value={status}>
          {label(t, STATUS_KEYS, status)}
        </option>
      )),
    ],
    [
      'priority',
      facts.priority,
      PRIORITIES.map((priority) => (
        <option key={priority} value={priority}>
          {label(t, PRIORITY_KEYS, priority)}
        </option>
      )),
    ],
    [
      'category',
      facts.category ?? '',
      [
        <option key="" value="">
          {t('tickets.none')}
        </option>,
        ...CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {label(t, CATEGORY_KEYS, category)}
          </option>
        )),
      ],
    ],
    [
      'teamId',
      facts.teamId ?? '',
      [
        <option key="" value="">
          {t('tickets.none')}
        </option>,
        ...teamOptions.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        )),
      ],
    ],
    [
      'assigneeId',
      facts.assigneeId ?? '',
      [
        <option key="" value="">
          {t('tickets.unassigned')}
        </option>,
        ...(facts.teamId === null
          ? (teams.data ?? [])
              .filter((team) => team.members.length > 0)
              .map((team) => (
                <optgroup key={team.id} label={team.name}>
                  {team.members.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </optgroup>
              ))
          : candidates(facts.teamId).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))),
      ],
    ],
  ]

  const onChange = (field: keyof Facts, value: string) => {
    switch (field) {
      case 'status':
        return pick({ status: value as TicketStatus })
      case 'priority':
        return pick({ priority: value as TicketPriority })
      case 'category':
        return pick({ category: value === '' ? null : (value as TicketCategory) })
      case 'teamId':
        return pickTeam(value === '' ? null : value)
      case 'assigneeId':
        return pickAssignee(value === '' ? null : value)
    }
  }

  const fieldLabel: Record<keyof Facts, string> = {
    status: label(t, FIELD_KEYS, 'STATUS'),
    priority: label(t, FIELD_KEYS, 'PRIORITY'),
    category: label(t, FIELD_KEYS, 'CATEGORY'),
    teamId: label(t, FIELD_KEYS, 'TEAM'),
    assigneeId: label(t, FIELD_KEYS, 'ASSIGNEE'),
  }
  const changedLabels = [
    ...rows.filter(([field]) => field in changes).map(([field]) => fieldLabel[field]),
    ...('resolution' in changes ? [t('tickets.editor.resolution')] : []),
  ]

  // Resolving is allowed without a first response (ADR 0004), but the customer would then hear
  // nothing from support but the resolution, and the waiting time keeps running.
  const unanswered = resolving && current.status !== 'RESOLVED' && summary.firstResponseAt === null
  const unansweredWarning = unanswered && (
    <Text
      role="status"
      bg="bg.muted"
      color="fg"
      borderRadius="control"
      px="12px"
      py="10px"
      fontSize="14px"
    >
      {t('tickets.editor.noFirstResponse')}
    </Text>
  )

  // Unfolds under the status select only, the one control the reader touched to bring it.
  // Only resolving a ticket that has no resolution needs one (ADR 0004): a resolution already on the
  // ticket stays when the field is left blank, and a ticket already resolved stays resolved without one.
  const resolutionRequired = current.status !== 'RESOLVED' && storedResolution.trim() === ''
  const resolutionField = resolving && (
    <FormField
      id="ticket-facts-resolution"
      label={
        resolutionRequired
          ? t('tickets.editor.resolution')
          : `${t('tickets.editor.resolution')} ${t('tickets.optional')}`
      }
      error={resolutionError}
      note={changedNote('resolution')}
    >
      {(aria) => (
        <FieldTextarea
          {...aria}
          fontSize="14px"
          minH="76px"
          value={resolution}
          onChange={(event) => {
            props.write.edited()
            setResolutionError(undefined)
            setResolutionDraft(event.target.value)
          }}
        />
      )}
    </FormField>
  )

  return (
    <Box>
      <Stack gap="12px">
        {rows.map(([field, value, options]) => (
          <Fragment key={field}>
            <FormField
              id={fieldId(field)}
              label={fieldLabel[field]}
              // Closed is never offered here: a resolved ticket says where Close ticket is, and keeps
              // the line while the draft moves it on, so nothing below moves.
              hint={
                field === 'status' && current.status === 'RESOLVED'
                  ? t('tickets.editor.closeHint')
                  : undefined
              }
              hintHidden={field === 'status' && !resolving}
              note={changedNote(field)}
            >
              {(aria) => (
                <FieldSelect
                  {...aria}
                  fontSize="14px"
                  value={value}
                  data-changed={field in changes || undefined}
                  onChange={(event) => onChange(field, event.target.value)}
                >
                  {options}
                </FieldSelect>
              )}
            </FormField>
            {field === 'status' && unansweredWarning}
            {field === 'status' && resolutionField}
          </Fragment>
        ))}
      </Stack>
      {/* While there is a draft the buttons and the line under them stay in view at the bottom of
          the window, so a change at the top of a tall column is saved without a hunt. The bar's
          padding and edge are drawn in every state, so sticking moves nothing. */}
      <Box
        ref={actions}
        data-sticky={changed || undefined}
        data-stuck={(changed && stuck) || undefined}
        position={changed ? 'sticky' : undefined}
        // One pixel past the window's edge, so the observer can tell a stuck bar from one at rest.
        bottom="-1px"
        zIndex="1"
        bg="bg.panel"
        // Out to the panel's edges, whose padding is narrower on a phone.
        mx={{ base: '-16px', sm: '-20px' }}
        px={{ base: '16px', sm: '20px' }}
        mt="2px"
        pt="11px"
        pb="12px"
        mb="-12px"
        borderTopWidth="1px"
        borderColor={changed && stuck ? 'border' : 'transparent'}
      >
        <Flex justify="flex-end" gap="10px">
          <Button variant="ghost" disabled={!changed || props.write.pending} onClick={discard}>
            {t('tickets.editor.discard')}
          </Button>
          <ReadyButton
            ready={changed}
            disabled={props.write.pending}
            aria-describedby={changed ? SAVE_STATE_ID : undefined}
            onClick={onSave}
          >
            {t('tickets.editor.save')}
          </ReadyButton>
        </Flex>
        {/* One line under Save for the draft's state: unsaved changes, just saved (the live region
          announces it), or when the ticket was last updated. */}
        <Text
          id={SAVE_STATE_ID}
          data-unsaved={changed || undefined}
          data-saved={(saved && !changed) || undefined}
          color={changed || saved ? 'fg' : 'fg.muted'}
          fontWeight={changed ? 'semibold' : undefined}
          fontSize="12px"
          textAlign="end"
          mt="10px"
        >
          {changed
            ? t('tickets.editor.unsaved')
            : saved
              ? t('tickets.editor.saved')
              : t('tickets.editor.updated', { time: formatDateTime(language, summary.updatedAt) })}
        </Text>
      </Box>
      {props.write.below}
      <UnsavedDraftGuard reference={summary.reference} fields={changedLabels} />
    </Box>
  )
}

/**
 * Whether a bar held by `position: sticky` one pixel past the window's bottom
 * edge is stuck there: only then is its bottom cut by that pixel while it is
 * on screen.
 * A browser without IntersectionObserver (jsdom) reads it as never stuck.
 */
function useStuckToBottom(bar: RefObject<HTMLElement | null>) {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const element = bar.current
    if (element === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      // Cut at the bottom edge, not at the top one the reader scrolls it past.
      ([entry]) =>
        setStuck(
          entry.isIntersecting &&
            entry.intersectionRatio < 1 &&
            entry.boundingClientRect.bottom > (entry.rootBounds?.bottom ?? window.innerHeight),
        ),
      { threshold: [0, 1] },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [bar])
  return stuck
}

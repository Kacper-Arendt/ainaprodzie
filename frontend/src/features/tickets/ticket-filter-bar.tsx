import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Box, Button, Flex, Grid } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { fallbackErrorKey } from '../../api/errors.ts'
import { FieldLabel } from '../../components/ui/field-label.tsx'
import { FieldInput, FieldSelect, FormField } from '../../components/ui/form-field.tsx'
import { FieldMultiSelect, type SelectOption } from '../../components/ui/multi-select.tsx'
import { ProblemText } from '../../components/ui/problem-text.tsx'
import { SegmentedToggle, type SegmentedOption } from '../../components/ui/segmented-toggle.tsx'
import {
  useOrganizations,
  useTeams,
  type Team,
  type TeamMember,
} from '../organization/use-organization.ts'
import {
  ATTENTION_KEYS,
  ATTENTIONS,
  CATEGORIES,
  CATEGORY_KEYS,
  label,
  PRIORITIES,
  PRIORITY_KEYS,
  SORT_KEYS,
  SORTS,
  STATUSES,
  STATUS_KEYS,
} from './ticket-labels.ts'
import {
  activeFilterCount,
  defaultSort,
  NO_FILTERS,
  type TicketListFilters,
} from './ticket-list-filters.ts'
import type { CustomerTicketCounts, TicketCounts, TicketSort } from './use-tickets.ts'
import { ActiveFilterChips } from './active-filter-chips.tsx'
import type { ActiveFilter } from './use-active-filters.ts'

type SlaFilter = '' | 'breached' | 'withinSla'

const SLA_FILTERS: Record<SlaFilter, boolean | undefined> = {
  '': undefined,
  breached: true,
  withinSla: false,
}

/** The views a reader switches between most, each a set of filters the URL can also hold. */
type ListView = 'all' | 'assignedToMe' | 'myTeam' | 'needsMyAnswer' | 'raisedByMe'

const VIEW_KEYS: Record<ListView, string> = {
  all: 'tickets.views.all',
  assignedToMe: 'tickets.views.assignedToMe',
  myTeam: 'tickets.views.myTeam',
  needsMyAnswer: 'tickets.views.needsMyAnswer',
  raisedByMe: 'tickets.views.raisedByMe',
}

/** The count each support view shows: the size of its own preset, whatever the search. */
const VIEW_COUNTS: Partial<Record<ListView, keyof TicketCounts>> = {
  all: 'all',
  assignedToMe: 'assignedToMe',
  myTeam: 'myTeam',
}

/** The count each customer view shows, over their organization's tickets, whatever the search. */
const CUSTOMER_VIEW_COUNTS: Partial<Record<ListView, keyof CustomerTicketCounts>> = {
  all: 'all',
  needsMyAnswer: 'waitingForCustomer',
  raisedByMe: 'raisedByMe',
}

const FILTERS_ID = 'ticket-filters'
export const FILTERS_TOGGLE_ID = 'ticket-filters-toggle'
export const SEARCH_ID = 'ticket-search'

/**
 * The search box, the views, the order and the filters above the ticket list.
 * A view is a preset of filters: support staff switch between all tickets,
 * those assigned to them and their team's; a customer
 * between all of their organization's, those waiting for their answer and
 * those they raised. A view reads as
 * pressed while the filters are exactly its own. The full filter set (text,
 * status, category and priority; support staff also organization, team,
 * assignee, SLA and what needs attention, with My team and Me first) folds away
 * behind Filters, which counts the active ones and opens by itself when the URL
 * brings some. Open, a field that narrows the list reads its value in semibold
 * Ink and one left at its "Any …" choice in Ink Muted. Folded, the active
 * filters stay in sight as chips that each lift one, with Clear all once there
 * are several, unless a pressed view already names them (`activeFilters`,
 * which the list also names in its empty state). Every view also shows how many tickets it holds, from
 * `counts` for support staff and `customerCounts` for a customer, so a
 * customer sees at once how many tickets wait for their answer. `apply`
 * receives each change.
 */
export function TicketFilterBar(props: {
  filters: TicketListFilters
  apply: (patch: Partial<TicketListFilters>) => void
  userId: string
  isSupport: boolean
  activeFilters: ActiveFilter[]
  counts?: TicketCounts
  customerCounts?: CustomerTicketCounts
}) {
  const { t } = useTranslation('common')
  const { filters, apply, userId, isSupport, activeFilters, counts, customerCounts } = props
  // A customer is never sent to `/api/teams`, which refuses them.
  const organizations = useOrganizations(userId, isSupport)
  const teams = useTeams(userId, isSupport)
  const activeCount = activeFilterCount(filters)
  const [expanded, setExpanded] = useState(activeCount > 0)
  const sortId = useId()

  const sla =
    (Object.keys(SLA_FILTERS) as SlaFilter[]).find(
      (choice) => SLA_FILTERS[choice] === filters.slaBreached,
    ) ?? ''

  const ownTeam = teams.data?.find((team) => team.member)
  const teamOptions: SelectOption<string>[] = [
    ...(ownTeam ? [{ value: ownTeam.id, label: t('tickets.filters.myTeam') }] : []),
    ...(teams.data ?? [])
      .filter((team) => team !== ownTeam)
      .map((team) => ({ value: team.id, label: team.name })),
  ]
  // An assignee always belongs to the ticket's team, so Me is offered only
  // where the reader is one of the staff listed.
  const assigneeOptions = (teamId: string | undefined): SelectOption<string>[] => {
    const staff = supportStaff(teams.data ?? [], teamId)
    return [
      ...(staff.some((person) => person.id === userId)
        ? [{ value: userId, label: t('tickets.filters.me') }]
        : []),
      ...staff
        .filter((person) => person.id !== userId)
        .map((person) => ({ value: person.id, label: person.name })),
    ]
  }
  // A person from the URL outside the chosen team is still named, not unknown.
  const personName = (id: string | undefined) =>
    id === userId
      ? t('tickets.filters.me')
      : supportStaff(teams.data ?? [], undefined).find((person) => person.id === id)?.name
  const organizationOptions = (organizations.data ?? []).map((organization) => ({
    value: organization.id,
    label: organization.name,
  }))

  const presets: Partial<Record<ListView, Partial<TicketListFilters>>> = isSupport
    ? {
        all: {},
        assignedToMe: { assigneeId: userId },
        ...(ownTeam ? { myTeam: { teamId: ownTeam.id } } : {}),
      }
    : {
        all: {},
        needsMyAnswer: { status: ['WAITING_FOR_CUSTOMER'] },
        raisedByMe: { authorId: userId },
      }
  const views = Object.keys(presets) as ListView[]
  const narrowedBy = (preset: Partial<TicketListFilters>) =>
    activeFilterCount({ ...filters, ...NO_FILTERS, ...preset }) === activeCount &&
    // As strings, so a preset's statuses match the same statuses from the URL.
    (Object.keys(preset) as Array<keyof TicketListFilters>).every(
      (key) => String(filters[key]) === String(preset[key]),
    )
  const view = views.find((candidate) => narrowedBy(presets[candidate] ?? {}))
  const viewCount = (value: ListView): number | undefined => {
    if (isSupport) {
      const key = VIEW_COUNTS[value]
      return key && counts ? counts[key] : undefined
    }
    const key = CUSTOMER_VIEW_COUNTS[value]
    return key && customerCounts ? customerCounts[key] : undefined
  }
  const viewOptions: SegmentedOption<ListView>[] = views.map((value) => ({
    value,
    label: t(VIEW_KEYS[value]),
    count: viewCount(value),
    // The tickets support await the customer's answer on are the customer's work to do.
    attention: value === 'needsMyAnswer',
  }))
  const sort = filters.sort ?? defaultSort(isSupport)

  return (
    <>
      <TicketSearch text={filters.text} onSearch={(text) => apply({ text })} />
      <Flex align="flex-end" gap="12px" wrap="wrap" mb="12px">
        <Box me="auto" w={{ base: 'full', sm: 'auto' }}>
          <SegmentedToggle
            label={t('tickets.views.label')}
            options={viewOptions}
            value={view}
            onChange={(next) => apply({ ...NO_FILTERS, text: filters.text, ...presets[next] })}
            countLabel={(count) => t('tickets.views.count', { count })}
          />
        </Box>
        {/* On a phone too narrow for the label and the longest order
            ("Kolejność", "Najdłużej oczekujące" at the 16px touch text) beside
            Filters, the order takes the row and Filters moves under it, so its
            value never clips and the label always says it is the order. Where
            even the label and the select cannot share a line, the label sits
            above it. */}
        <Flex
          align="center"
          wrap="wrap"
          columnGap="8px"
          rowGap="6px"
          flex={{ base: '1 1 290px', sm: 'none' }}
        >
          <FieldLabel htmlFor={sortId} color="fg.muted" whiteSpace="nowrap">
            {t('tickets.sort.label')}
          </FieldLabel>
          <Box flex={{ base: '1 1 210px', sm: 'none' }} minW="0" w={{ sm: '210px' }}>
            <FieldSelect
              id={sortId}
              value={sort}
              onChange={(event) => {
                const next = event.target.value as TicketSort
                apply({ sort: next === defaultSort(isSupport) ? undefined : next })
              }}
            >
              {SORTS.map((value) => (
                <option key={value} value={value}>
                  {label(t, SORT_KEYS, value)}
                </option>
              ))}
            </FieldSelect>
          </Box>
        </Flex>
        <Button
          type="button"
          variant="outline"
          // One width whatever the count, so the order beside it never moves.
          minW="128px"
          id={FILTERS_TOGGLE_ID}
          aria-expanded={expanded}
          aria-controls={FILTERS_ID}
          onClick={() => setExpanded(!expanded)}
        >
          {activeCount > 0
            ? t('tickets.filters.toggleCount', { count: activeCount })
            : t('tickets.filters.toggle')}
        </Button>
      </Flex>
      {/* Open, the fields show the filters themselves; a pressed view names its own. */}
      <ActiveFilterChips
        filters={expanded || view !== undefined ? [] : activeFilters}
        onRemove={(filter) => apply(filter.remove)}
        onClearAll={() => apply({ ...NO_FILTERS, text: filters.text })}
        fallbackFocusId={FILTERS_TOGGLE_ID}
      />
      <Grid
        id={FILTERS_ID}
        display={expanded ? 'grid' : 'none'}
        templateColumns="repeat(auto-fill, minmax(180px, 1fr))"
        gap="12px"
        mb="16px"
        pt="12px"
        borderTopWidth="1px"
        borderColor="border"
      >
        <SetMark set={filters.status.length > 0}>
          <FormField id="ticket-status" label={t('tickets.filters.status')}>
            {(aria) => (
              <FieldMultiSelect
                aria={aria}
                options={STATUSES.map((value) => ({ value, label: label(t, STATUS_KEYS, value) }))}
                anyLabel={t('tickets.filters.anyStatus')}
                value={filters.status}
                onChange={(status) => apply({ status })}
              />
            )}
          </FormField>
        </SetMark>
        <FilterSelect
          id="ticket-category"
          label={t('tickets.filters.category')}
          anyLabel={t('tickets.filters.anyCategory')}
          options={CATEGORIES.map((value) => ({ value, label: label(t, CATEGORY_KEYS, value) }))}
          value={filters.category}
          onChange={(category) => apply({ category })}
        />
        <FilterSelect
          id="ticket-priority"
          label={t('tickets.filters.priority')}
          anyLabel={t('tickets.filters.anyPriority')}
          options={PRIORITIES.map((value) => ({ value, label: label(t, PRIORITY_KEYS, value) }))}
          value={filters.priority}
          onChange={(priority) => apply({ priority })}
        />
        {isSupport && (
          <>
            <FilterSelect
              id="ticket-organization"
              label={t('tickets.filters.organization')}
              anyLabel={t('tickets.filters.anyOrganization')}
              options={organizationOptions}
              pending={organizations.isPending}
              value={filters.organizationId}
              onChange={(organizationId) => apply({ organizationId })}
            />
            <FilterSelect
              id="ticket-team"
              label={t('tickets.filters.team')}
              anyLabel={t('tickets.filters.anyTeam')}
              options={teamOptions}
              pending={teams.isPending}
              value={filters.teamId}
              onChange={(teamId) => {
                // Someone outside the new team would only empty the list.
                const keeps = assigneeOptions(teamId).some((o) => o.value === filters.assigneeId)
                apply({ teamId, assigneeId: keeps ? filters.assigneeId : undefined })
              }}
            />
            <FilterSelect
              id="ticket-assignee"
              label={t('tickets.filters.assignee')}
              anyLabel={t('tickets.filters.anyAssignee')}
              options={assigneeOptions(filters.teamId)}
              outsideLabel={personName(filters.assigneeId)}
              pending={teams.isPending}
              value={filters.assigneeId}
              onChange={(assigneeId) => apply({ assigneeId })}
            />
          </>
        )}
        {isSupport && (
          <>
            <SetMark set={sla !== ''}>
              <FormField id="ticket-sla" label={t('tickets.filters.sla')}>
                {(aria) => (
                  <FieldSelect
                    {...aria}
                    value={sla}
                    onChange={(event) =>
                      apply({ slaBreached: SLA_FILTERS[event.target.value as SlaFilter] })
                    }
                  >
                    <option value="">{t('tickets.filters.anySla')}</option>
                    <option value="breached">{t('tickets.filters.breached')}</option>
                    <option value="withinSla">{t('tickets.filters.withinSla')}</option>
                  </FieldSelect>
                )}
              </FormField>
            </SetMark>
            <FilterSelect
              id="ticket-attention"
              label={t('tickets.filters.attention')}
              anyLabel={t('tickets.filters.anyAttention')}
              options={ATTENTIONS.map((value) => ({
                value,
                label: label(t, ATTENTION_KEYS, value),
              }))}
              value={filters.attention}
              onChange={(attention) => apply({ attention })}
            />
          </>
        )}
        {/* The last cell, so appearing with the first filter moves no other control. */}
        {activeCount > 0 && (
          <Flex align="flex-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => apply({ ...NO_FILTERS, text: filters.text })}
            >
              {t('tickets.filters.clear')}
            </Button>
          </Flex>
        )}
        {(teams.isError || organizations.isError) && (
          <Box gridColumn="1 / -1">
            <ProblemText
              error={t(fallbackErrorKey(organizations.error ?? teams.error))}
              onRetry={() => {
                if (organizations.isError) void organizations.refetch()
                if (teams.isError) void teams.refetch()
              }}
              retrying={organizations.isFetching || teams.isFetching}
            />
          </Box>
        )}
      </Grid>
    </>
  )
}

/**
 * The support staff of one team, or of every team when none is chosen, each
 * once and sorted by name as the API sorts a team's members.
 */
function supportStaff(teams: Team[], teamId: string | undefined): TeamMember[] {
  const members = teams.filter((team) => teamId === undefined || team.id === teamId)
  const byId = new Map(members.flatMap((team) => team.members).map((m) => [m.id, m]))
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

/**
 * A single select whose empty choice, `anyLabel`, sends no parameter. A value
 * from the URL that is none of the options shows as `outsideLabel` when the
 * caller can still name it, as loading while the options are `pending`, and
 * otherwise as unknown (a team or person this reader cannot see), never as
 * the empty choice it is not.
 */
function FilterSelect<V extends string>(props: {
  id: string
  label: string
  anyLabel: string
  options: SelectOption<V>[]
  pending?: boolean
  outsideLabel?: string
  value: V | undefined
  onChange: (value: V | undefined) => void
}) {
  const { t } = useTranslation('common')
  const { value } = props
  const known = value === undefined || props.options.some((option) => option.value === value)

  return (
    <SetMark set={value !== undefined}>
      <FormField id={props.id} label={props.label}>
        {(aria) => (
          <FieldSelect
            {...aria}
            value={value ?? ''}
            onChange={(event) => props.onChange((event.target.value || undefined) as V | undefined)}
          >
            <option value="">{props.anyLabel}</option>
            {props.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {!known && (
              <option value={value}>
                {props.outsideLabel ??
                  (props.pending ? t('loading') : t('tickets.filters.unknown'))}
              </option>
            )}
          </FieldSelect>
        )}
      </FormField>
    </SetMark>
  )
}

/**
 * Tells a set filter field from one left at its "Any …" choice: the value of a
 * set one reads in semibold Ink, an unset one in Ink Muted like a placeholder.
 * The open list of a native select keeps plain Ink, whichever is chosen.
 */
function SetMark(props: { set: boolean; children: ReactNode }) {
  return (
    <Box
      data-set={props.set || undefined}
      css={{
        '& select, & [data-part="value-text"]': props.set
          ? { color: 'fg', fontWeight: 'semibold' }
          : { color: 'fg.muted', fontWeight: 'normal' },
        '& option': { color: 'fg', fontWeight: 'normal' },
      }}
    >
      {props.children}
    </Box>
  )
}

/**
 * The search box holds a draft until it is submitted. A text the URL brings
 * (back, a pasted link) replaces the draft; the box stays mounted, so a search
 * keeps the keyboard focus where it was.
 */
function TicketSearch(props: { text?: string; onSearch: (text: string | undefined) => void }) {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState(props.text ?? '')
  const [urlText, setUrlText] = useState(props.text)
  if (props.text !== urlText) {
    setUrlText(props.text)
    setDraft(props.text ?? '')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    props.onSearch(draft.trim() || undefined)
  }

  return (
    <Flex as="form" onSubmit={onSubmit} gap="12px" align="flex-end" mb="12px">
      <Box flex="1">
        <FormField id={SEARCH_ID} label={t('tickets.search.label')}>
          {(aria) => (
            <FieldInput
              {...aria}
              type="search"
              value={draft}
              placeholder={t('tickets.search.placeholder')}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </FormField>
      </Box>
      <Button type="submit" colorPalette="accent">
        {t('tickets.search.submit')}
      </Button>
    </Flex>
  )
}

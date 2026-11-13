import {
  ATTENTION_KEYS,
  CATEGORY_KEYS,
  PRIORITY_KEYS,
  SORT_KEYS,
  STATUS_KEYS,
} from './ticket-labels.ts'
import type {
  Attention,
  TicketCategory,
  TicketListParams,
  TicketPriority,
  TicketSort,
  TicketStatus,
} from './use-tickets.ts'

/**
 * The ticket list's filters, order and page as the URL's query string holds
 * them, under the API's own parameter names. Category and priority are single
 * choices in the list, though the API takes several. `attention` keeps what
 * one of the desk summary's counts holds. `sort` is set only when it differs
 * from the reader's default order.
 */
export interface TicketListFilters {
  text?: string
  status: TicketStatus[]
  category?: TicketCategory
  priority?: TicketPriority
  organizationId?: string
  teamId?: string
  assigneeId?: string
  slaBreached?: boolean
  attention?: Attention
  authorId?: string
  sort?: TicketSort
  page: number
}

/** What every filter reads when none is set: the patch Clear applies. The order stays the reader's. */
export const NO_FILTERS = {
  text: undefined,
  status: [],
  category: undefined,
  priority: undefined,
  organizationId: undefined,
  teamId: undefined,
  assigneeId: undefined,
  slaBreached: undefined,
  attention: undefined,
  authorId: undefined,
} satisfies Partial<TicketListFilters>

/** How many filters narrow the list, the search text aside. */
export function activeFilterCount(filters: TicketListFilters): number {
  return [
    filters.status.length > 0,
    filters.category !== undefined,
    filters.priority !== undefined,
    filters.organizationId !== undefined,
    filters.teamId !== undefined,
    filters.assigneeId !== undefined,
    // Within SLA (`false`) narrows the list as much as Breached does.
    filters.slaBreached !== undefined,
    filters.attention !== undefined,
    filters.authorId !== undefined,
  ].filter(Boolean).length
}

/**
 * Support staff work the queue, so their list opens on the response deadline;
 * a customer follows their organization's tickets, most recently updated first.
 */
export function defaultSort(support: boolean): TicketSort {
  return support ? 'RESPONSE_DEADLINE' : 'RECENTLY_UPDATED'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE = /^\d+$/
// The API binds the page to a Java int; a larger one would be a 400.
const MAX_PAGE = 2 ** 31 - 1

function member<V extends string>(keys: Record<V, string>, value: string | null): V | undefined {
  return value !== null && Object.hasOwn(keys, value) ? (value as V) : undefined
}

/** Lower case, as the API writes ids, so an id from the URL matches the one in a list. */
function uuid(value: string | null): string | undefined {
  return value !== null && UUID.test(value) ? value.toLowerCase() : undefined
}

function page(value: string | null): number {
  const number = value !== null && PAGE.test(value) ? Number(value) : 0
  return number <= MAX_PAGE ? number : 0
}

function slaBreached(value: string | null): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/**
 * Reads the filters from a URL a reader may have edited by hand: a value the
 * API would refuse is dropped, so the list never asks for a 400. A customer
 * sees one organization, no assignment, no SLA and no desk, so those filters
 * are ignored. The author has no field in the filters, only a customer's Raised
 * by me view, so any other author is ignored too rather than narrow the list
 * unseen.
 */
export function parseFilters(
  search: URLSearchParams,
  support: boolean,
  userId: string,
): TicketListFilters {
  const authorId = uuid(search.get('authorId'))
  const statuses = search.getAll('status').flatMap((value) => member(STATUS_KEYS, value) ?? [])
  const sort = member(SORT_KEYS, search.get('sort'))
  return {
    text: search.get('text')?.trim() || undefined,
    status: [...new Set(statuses)],
    category: member(CATEGORY_KEYS, search.get('category')),
    priority: member(PRIORITY_KEYS, search.get('priority')),
    organizationId: support ? uuid(search.get('organizationId')) : undefined,
    teamId: support ? uuid(search.get('teamId')) : undefined,
    assigneeId: support ? uuid(search.get('assigneeId')) : undefined,
    slaBreached: support ? slaBreached(search.get('slaBreached')) : undefined,
    attention: support ? member(ATTENTION_KEYS, search.get('attention')) : undefined,
    authorId: !support && authorId === userId ? authorId : undefined,
    sort: sort === defaultSort(support) ? undefined : sort,
    page: page(search.get('page')),
  }
}

/** The query string for the filters; the first page and unset filters leave no parameter. */
export function filtersSearch(filters: TicketListFilters): URLSearchParams {
  const search = new URLSearchParams()
  const set = (name: string, value: string | number | boolean | undefined) => {
    if (value !== undefined) search.set(name, String(value))
  }
  set('text', filters.text)
  for (const status of filters.status) search.append('status', status)
  set('category', filters.category)
  set('priority', filters.priority)
  set('organizationId', filters.organizationId)
  set('teamId', filters.teamId)
  set('assigneeId', filters.assigneeId)
  set('slaBreached', filters.slaBreached)
  set('attention', filters.attention)
  set('authorId', filters.authorId)
  set('sort', filters.sort)
  if (filters.page > 0) set('page', filters.page)
  return search
}

/**
 * What a link from the list hands the ticket page in its navigation state, so
 * its "All tickets" link returns to the same filters and page.
 */
export interface ListOrigin {
  listSearch: string
}

/** The list's query string from a navigation state, or none when the reader came from elsewhere. */
export function listSearch(state: unknown): string {
  const search = (state as Partial<ListOrigin> | null)?.listSearch
  return typeof search === 'string' ? search : ''
}

export function listParams(
  filters: TicketListFilters,
  support: boolean,
  size: number,
): TicketListParams {
  return {
    text: filters.text,
    status: filters.status.length > 0 ? filters.status : undefined,
    category: filters.category ? [filters.category] : undefined,
    priority: filters.priority ? [filters.priority] : undefined,
    organizationId: filters.organizationId,
    teamId: filters.teamId,
    assigneeId: filters.assigneeId,
    slaBreached: filters.slaBreached,
    attention: filters.attention,
    authorId: filters.authorId,
    sort: filters.sort ?? defaultSort(support),
    page: filters.page,
    size,
  }
}

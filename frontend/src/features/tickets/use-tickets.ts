import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { components, paths } from '../../api/types.gen.ts'

export type TicketPage = components['schemas']['TicketPage']
export type TicketCounts = components['schemas']['TicketCounts']
export type CustomerTicketCounts = components['schemas']['CustomerTicketCounts']
export type TicketSummary = components['schemas']['TicketSummary']
export type TicketDetails = components['schemas']['TicketDetails']
export type TicketStatus = TicketSummary['status']
export type TicketPriority = TicketSummary['priority']
export type TicketCategory = NonNullable<TicketSummary['category']>
export type LinkRelation = components['schemas']['TicketLink']['relation']
export type TicketAuditEntry = components['schemas']['TicketAuditEntry']
export type AuditedField = TicketAuditEntry['field']
export type CreateTicketRequest = components['schemas']['CreateTicketRequest']
export type AddCommentRequest = components['schemas']['AddCommentRequest']
export type CloseTicketRequest = components['schemas']['CloseTicketRequest']
export type UpdateTicketRequest = components['schemas']['UpdateTicketRequest']
export type LinkTicketRequest = components['schemas']['LinkTicketRequest']

const TICKETS_PATH = '/api/tickets' satisfies keyof paths
const COUNTS_PATH = '/api/tickets/counts' satisfies keyof paths
const CUSTOMER_COUNTS_PATH = '/api/tickets/customer-counts' satisfies keyof paths
const TICKET_PATH = '/api/tickets/{reference}' satisfies keyof paths
const COMMENTS_PATH = '/api/tickets/{reference}/comments' satisfies keyof paths
const CLOSE_PATH = '/api/tickets/{reference}/close' satisfies keyof paths
const LINK_PATH = '/api/tickets/{reference}/links/{linkedReference}' satisfies keyof paths

export type TicketListParams = NonNullable<paths[typeof TICKETS_PATH]['get']['parameters']['query']>
export type TicketSort = NonNullable<TicketListParams['sort']>
export type Attention = NonNullable<TicketListParams['attention']>

export const ticketKeys = {
  lists: () => ['tickets', 'list'] as const,
  list: (params: TicketListParams) => [...ticketKeys.lists(), params] as const,
  counts: () => ['tickets', 'counts'] as const,
  /** Under the desk counts' key, so invalidating the counts reaches a customer's too. */
  customerCounts: () => [...ticketKeys.counts(), 'customer'] as const,
  detail: (reference: string) => ['tickets', 'detail', reference] as const,
  /** The mutation key every ticket write carries, so a page can tell when one starts. */
  writes: () => ['tickets', 'write'] as const,
}

/** Array parameters repeat their name (`status=NEW&status=CLOSED`), as Spring binds them. */
function queryString(params: TicketListParams): string {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== '') search.append(name, String(item))
    }
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

function ticketPath(template: string, reference: string): string {
  return template.replace('{reference}', encodeURIComponent(reference))
}

function linkPath(reference: string, linkedReference: string): string {
  return ticketPath(LINK_PATH, reference).replace(
    '{linkedReference}',
    encodeURIComponent(linkedReference),
  )
}

/**
 * `refetchInterval` keeps a list that is on screen current (its clocks and
 * breaches) while the tab is visible; a search that only offers a pick needs none.
 */
export function useTickets(
  params: TicketListParams,
  { enabled = true, refetchInterval }: { enabled?: boolean; refetchInterval?: number } = {},
) {
  return useQuery({
    queryKey: ticketKeys.list(params),
    enabled,
    refetchInterval,
    queryFn: () => api<TicketPage>(TICKETS_PATH + queryString(params)),
    // The previous page stays on screen while the next one loads, so the table never collapses.
    placeholderData: keepPreviousData,
  })
}

/** Support staff's desk counts, kept current like the list beside them. */
export function useTicketCounts({
  enabled = true,
  refetchInterval,
}: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ticketKeys.counts(),
    enabled,
    refetchInterval,
    queryFn: () => api<TicketCounts>(COUNTS_PATH),
  })
}

/** A customer's view counts over their organization's tickets, kept current like the list beside them. */
export function useCustomerTicketCounts({
  enabled = true,
  refetchInterval,
}: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ticketKeys.customerCounts(),
    enabled,
    refetchInterval,
    queryFn: () => api<CustomerTicketCounts>(CUSTOMER_COUNTS_PATH),
  })
}

export function useTicket(reference: string) {
  return useQuery({
    queryKey: ticketKeys.detail(reference),
    queryFn: () => api<TicketDetails>(ticketPath(TICKET_PATH, reference)),
  })
}

/** The tag the server compares `If-Match` with: the version in double quotes, never weak. */
function ifMatch(version: number): Record<string, string> {
  return { 'If-Match': `"${version}"` }
}

function idempotency(key: string | undefined): Record<string, string> {
  return key ? { 'Idempotency-Key': key } : {}
}

/**
 * Every write answers the whole ticket, so the answer becomes the cached ticket
 * at once. A refetch still in flight read an older version, so it is cancelled
 * first rather than allowed to land on top. Lists show summaries of the ticket
 * (status, priority, update time), so every one of them is refetched, whatever
 * its filters, and so are the view counts of either role.
 */
async function storeTicket(queryClient: QueryClient, ticket: TicketDetails) {
  const detail = ticketKeys.detail(ticket.summary.reference)
  await queryClient.cancelQueries({ queryKey: detail })
  queryClient.setQueryData(detail, ticket)
  void queryClient.invalidateQueries({ queryKey: ticketKeys.lists() })
  void queryClient.invalidateQueries({ queryKey: ticketKeys.counts() })
}

export function useCreateTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ticketKeys.writes(),
    mutationFn: (variables: { request: CreateTicketRequest; idempotencyKey?: string }) =>
      api<TicketDetails>(TICKETS_PATH, {
        method: 'POST',
        body: variables.request,
        headers: idempotency(variables.idempotencyKey),
      }),
    onSuccess: (ticket) => storeTicket(queryClient, ticket),
  })
}

export function useAddComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ticketKeys.writes(),
    mutationFn: (variables: {
      reference: string
      request: AddCommentRequest
      idempotencyKey?: string
    }) =>
      api<TicketDetails>(ticketPath(COMMENTS_PATH, variables.reference), {
        method: 'POST',
        body: variables.request,
        headers: idempotency(variables.idempotencyKey),
      }),
    onSuccess: (ticket) => storeTicket(queryClient, ticket),
  })
}

export function useCloseTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ticketKeys.writes(),
    mutationFn: (variables: { reference: string; version: number; request: CloseTicketRequest }) =>
      api<TicketDetails>(ticketPath(CLOSE_PATH, variables.reference), {
        method: 'POST',
        body: variables.request,
        headers: ifMatch(variables.version),
      }),
    onSuccess: (ticket) => storeTicket(queryClient, ticket),
  })
}

/** `request` holds only the changed fields: an absent field keeps its value, `null` clears it. */
export function useUpdateTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ticketKeys.writes(),
    mutationFn: (variables: { reference: string; version: number; request: UpdateTicketRequest }) =>
      api<TicketDetails>(ticketPath(TICKET_PATH, variables.reference), {
        method: 'PATCH',
        body: variables.request,
        headers: ifMatch(variables.version),
      }),
    onSuccess: (ticket) => storeTicket(queryClient, ticket),
  })
}

/**
 * A link changes both tickets, but the answer is only the addressed one; the
 * other ticket is refetched when next shown.
 */
async function storeLinkAnswer(
  queryClient: QueryClient,
  ticket: TicketDetails,
  linkedReference: string,
) {
  await storeTicket(queryClient, ticket)
  await queryClient.invalidateQueries({ queryKey: ticketKeys.detail(linkedReference) })
}

export function useLinkTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ticketKeys.writes(),
    mutationFn: (variables: {
      reference: string
      linkedReference: string
      request: LinkTicketRequest
    }) =>
      api<TicketDetails>(linkPath(variables.reference, variables.linkedReference), {
        method: 'PUT',
        body: variables.request,
      }),
    onSuccess: (ticket, variables) =>
      storeLinkAnswer(queryClient, ticket, variables.linkedReference),
  })
}

export function useUnlinkTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ticketKeys.writes(),
    mutationFn: (variables: { reference: string; linkedReference: string }) =>
      api<TicketDetails>(linkPath(variables.reference, variables.linkedReference), {
        method: 'DELETE',
      }),
    onSuccess: (ticket, variables) =>
      storeLinkAnswer(queryClient, ticket, variables.linkedReference),
  })
}

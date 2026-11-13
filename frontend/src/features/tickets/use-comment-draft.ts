import { useEffect, useState } from 'react'

export interface CommentDraft {
  body: string
  /** An internal note rather than a public comment; only support staff write one. */
  note: boolean
}

const EMPTY: CommentDraft = { body: '', note: false }

/** Per signed-in user and ticket, so another account in the same tab never sees it. */
const storageKey = (userId: string, reference: string) => `retrofit.draft.${userId}.${reference}`

function read(key: string): CommentDraft {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Partial<CommentDraft> | null
    return typeof stored?.body === 'string'
      ? { body: stored.body, note: stored.note === true }
      : EMPTY
  } catch {
    return EMPTY
  }
}

/**
 * The comment being written on a ticket, kept in the tab's session storage so
 * leaving for the list or another ticket and coming back finds it again. An
 * empty body leaves nothing stored, and neither does a draft while `sending`:
 * a page left before the server answers never learns the send succeeded, so
 * a stored copy would come back to be sent twice. A refused send stores it
 * again. Storage that is unavailable (a private window, blocked site data)
 * only loses that convenience.
 */
export function useCommentDraft(userId: string, reference: string, sending: boolean) {
  const key = storageKey(userId, reference)
  const [draft, setDraft] = useState(() => read(key))

  useEffect(() => {
    try {
      if (draft.body === '' || sending) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, JSON.stringify(draft))
    } catch {
      // Without storage the draft lives as long as the page, as any other field.
    }
  }, [key, draft, sending])

  return [draft, setDraft] as const
}

/** The comment composer's field. */
export const BODY_ID = 'comment-body'

/**
 * Brings the composer into the middle of the view and puts the caret in it,
 * gliding there unless the reader asked for reduced motion.
 */
export function focusComposer() {
  const body = document.getElementById(BODY_ID)
  if (body === null) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  body.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  body.focus({ preventScroll: true })
}

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from './provider.tsx'
import { Dialog } from './dialog.tsx'

describe('Dialog', () => {
  it('shows its title and body when open and closes through the Close button', async () => {
    const onOpenChange = vi.fn()
    render(
      <Provider>
        <Dialog open onOpenChange={onOpenChange} title="Ticket details">
          The body text.
        </Dialog>
      </Provider>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Ticket details' })
    expect(dialog.textContent).toContain('The body text.')

    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

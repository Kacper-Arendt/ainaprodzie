import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Provider } from './provider.tsx'
import { RouteError } from './route-error.tsx'
import { renderElement } from '../../test/harness.tsx'

describe('RouteError', () => {
  it('shows the not-found variant with a link back home', () => {
    renderElement(<RouteError notFound />)

    expect(screen.getByText('Page not found')).toBeTruthy()
    expect(screen.getByText('The page you are looking for does not exist.')).toBeTruthy()
    const back = screen.getByRole('link', { name: 'Back to home' })
    expect(back.getAttribute('href')).toBe('/')
  })

  it('shows the generic variant with a reload button when a loader throws', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          loader: () => {
            throw new Error('boom')
          },
          element: null,
          errorElement: <RouteError />,
        },
      ],
      { initialEntries: ['/'] },
    )
    render(
      <Provider>
        <RouterProvider router={router} />
      </Provider>,
    )

    expect(await screen.findByText('Something went wrong')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.queryByText('Page not found')).toBeNull()
  })
})

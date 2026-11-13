import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from './provider.tsx'
import { FieldTextarea, FormField } from './form-field.tsx'

describe('FormField', () => {
  it('wires the control to its label and error, and marks it invalid on the flag alone', () => {
    render(
      <Provider>
        <FormField id="email" label="Email" error="Email is required.">
          {(aria) => <input {...aria} />}
        </FormField>
        <FormField id="password" label="Password" invalid>
          {(aria) => <input {...aria} />}
        </FormField>
        <FormField id="name" label="Name">
          {(aria) => <input {...aria} />}
        </FormField>
      </Provider>,
    )

    const email = screen.getByLabelText('Email')
    expect(email.id).toBe('email')
    expect(email.getAttribute('aria-invalid')).toBe('true')
    const describedBy = email.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Email is required.')
    expect(screen.getByRole('alert').id).toBe(describedBy)

    const password = screen.getByLabelText('Password')
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(password.getAttribute('aria-describedby')).toBeNull()

    const name = screen.getByLabelText('Name')
    expect(name.getAttribute('aria-invalid')).toBeNull()
  })

  it('labels a textarea and marks it invalid only while an error is shown', () => {
    render(
      <Provider>
        <FormField id="description" label="Description" error="Too long.">
          {(aria) => <FieldTextarea {...aria} />}
        </FormField>
        <FormField id="resolution" label="Resolution">
          {(aria) => <FieldTextarea {...aria} />}
        </FormField>
      </Provider>,
    )

    const description = screen.getByLabelText('Description')
    expect(description.tagName).toBe('TEXTAREA')
    expect(description.getAttribute('aria-invalid')).toBe('true')
    expect(
      document.getElementById(description.getAttribute('aria-describedby')!)?.textContent,
    ).toBe('Too long.')

    const resolution = screen.getByLabelText('Resolution')
    expect(resolution.tagName).toBe('TEXTAREA')
    expect(resolution.getAttribute('aria-invalid')).toBeNull()
    expect(resolution.getAttribute('aria-describedby')).toBeNull()
  })

  it('describes the control by its hint, and by the error first while one is shown', () => {
    render(
      <Provider>
        <FormField id="resolution" label="Resolution" hint="Resolve it first." error="Too long.">
          {(aria) => <FieldTextarea {...aria} />}
        </FormField>
        <FormField id="status" label="Status" hint="Close it once it is resolved.">
          {(aria) => <input {...aria} />}
        </FormField>
        <FormField id="note" label="Note" hint="Shown only sometimes." hintHidden>
          {(aria) => <input {...aria} />}
        </FormField>
      </Provider>,
    )

    expect(screen.getByLabelText('Resolution').getAttribute('aria-describedby')).toBe(
      'resolution-error resolution-hint',
    )
    const status = screen.getByLabelText('Status')
    expect(status.getAttribute('aria-describedby')).toBe('status-hint')
    expect(document.getElementById('status-hint')?.textContent).toBe(
      'Close it once it is resolved.',
    )

    // A hidden hint keeps its line but describes nothing.
    expect(screen.getByLabelText('Note').getAttribute('aria-describedby')).toBeNull()
    expect(document.getElementById('note-hint')).toBeTruthy()
  })
})

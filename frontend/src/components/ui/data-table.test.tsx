import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Provider } from './provider.tsx'
import { DataTable, type DataTableColumn } from './data-table.tsx'

interface Ticket {
  id: number
  subject: string
  status: string
}

const columns: DataTableColumn<Ticket>[] = [
  { key: 'subject', header: 'Subject' },
  { key: 'status', header: 'Status', width: '120px' },
]

describe('DataTable', () => {
  it('renders the column headers and one row per item', () => {
    render(
      <Provider>
        <DataTable
          columns={columns}
          rows={[
            { id: 1, subject: 'Cannot log in', status: 'OPEN' },
            { id: 2, subject: 'Invoice missing', status: 'CLOSED' },
          ]}
          getRowKey={(row) => String(row.id)}
          emptyTitle="Nothing here"
          emptyHint="Rows will appear here."
        />
      </Provider>,
    )

    expect(screen.getByRole('columnheader', { name: 'Subject' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    const rows = screen.getAllByRole('row')
    // One header row plus one row per item.
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('Cannot log in')).toBeTruthy()
    expect(within(rows[2]).getByText('CLOSED')).toBeTruthy()
  })

  it('labels a stacked value with its header, hidden from screen readers that hear the header row', () => {
    render(
      <Provider>
        <DataTable
          columns={[columns[0], { ...columns[1], stackedLabel: true }]}
          rows={[{ id: 1, subject: 'Cannot log in', status: 'OPEN' }]}
          getRowKey={(row) => String(row.id)}
          emptyTitle="Nothing here"
          emptyHint="Rows will appear here."
        />
      </Provider>,
    )

    const cell = within(screen.getAllByRole('row')[1]).getAllByRole('cell')[1]
    expect(within(cell).getByText('Status').getAttribute('aria-hidden')).toBe('true')
    expect(within(cell).getByText('OPEN')).toBeTruthy()
  })

  it('renders the empty state instead of a table when there are no rows', () => {
    render(
      <Provider>
        <DataTable
          columns={columns}
          rows={[] as Ticket[]}
          getRowKey={(row) => String(row.id)}
          emptyTitle="Nothing here"
          emptyHint="Rows will appear here."
        />
      </Provider>,
    )

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.getByText('Rows will appear here.')).toBeTruthy()
  })
})

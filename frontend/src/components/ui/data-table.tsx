import type { ReactNode } from 'react'
import { Box, Flex, Table } from '@chakra-ui/react'
import { EmptyState } from './empty-state.tsx'

export interface DataTableColumn<T> {
  key: keyof T & string
  header: string
  /** Fixed width for a column whose content varies by state (standards/frontend/css.md). */
  width?: string
  /** Shows the header before the value once the row stacks, for a value that does not name itself. */
  stackedLabel?: boolean
  /** Holds the value to the trailing edge of its grid area once the row stacks. */
  stackedAlign?: 'start' | 'end'
  /**
   * Leaves the column out of a table that fits but is not `TABLE_ROOMY`, where
   * the fixed widths would squeeze the flexible column too far; the caller shows
   * its value inside another cell there. A stacked row still has its area.
   */
  wideOnly?: boolean
}

interface GridLayout {
  templateColumns: string
  templateAreas: string
}

/**
 * How a row is laid out where the columns no longer fit: a CSS grid whose
 * areas are named after the column keys.
 */
export interface StackedLayout extends GridLayout {
  /**
   * From `TABLE_TWO_LINES` until the table fits: a wider grid, typically two
   * lines, whose fixed tracks line the values up down the list like columns.
   * Every value then starts its area, as in the table.
   */
  twoLines?: GridLayout
}

/**
 * The condition under which the table draws as a table: its fixed columns,
 * the `wideOnly` ones left out, plus a 190px title need 950px. It is a
 * container query on the table's own width, not a breakpoint, because the
 * docked chat narrows the page without changing the window. A cell that styles
 * itself per layout uses it too.
 */
export const TABLE_FITS = '@container data-table (min-width: 950px)'

/** Wide enough for the `wideOnly` columns too, with the title still 190px: 1080px. */
export const TABLE_ROOMY = '@container data-table (min-width: 1080px)'

/**
 * Wide enough for a stacked row's `twoLines` grid: 640px, a little under the
 * 649px the table gets on half a desktop screen (a 768px window).
 */
export const TABLE_TWO_LINES = '@container data-table (min-width: 640px)'

/**
 * A plain table of rows, one cell per column key. `table-layout: fixed`, so a
 * cell whose content changes with state never moves a column. With no rows it
 * draws the empty state instead of an empty grid.
 *
 * Where the table does not fit (`TABLE_FITS`) each row stacks into the
 * `stacked` grid (its `twoLines` variant from `TABLE_TWO_LINES`) and the
 * header row is only read aloud. The table roles are
 * spelled out because some browsers drop a table's semantics once its rows
 * stop being `display: table-row`.
 */
export function DataTable<T extends Record<keyof T, ReactNode>>(props: {
  columns: DataTableColumn<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  emptyTitle: string
  emptyHint: string
  /** The one action that would put rows here, such as clearing the filters. */
  emptyAction?: ReactNode
  stacked?: StackedLayout
}) {
  if (props.rows.length === 0) {
    return (
      <EmptyState title={props.emptyTitle} action={props.emptyAction}>
        {props.emptyHint}
      </EmptyState>
    )
  }
  return (
    <Box containerType="inline-size" containerName="data-table">
      <Table.Root
        role="table"
        size="sm"
        tableLayout="fixed"
        fontSize="14px"
        css={{ display: 'block', [TABLE_FITS]: { display: 'table' } }}
      >
        <Table.Header
          role="rowgroup"
          css={{
            display: 'block',
            srOnly: true,
            [TABLE_FITS]: { display: 'table-header-group', srOnly: false },
          }}
        >
          <Table.Row role="row" bg="bg.panel">
            {props.columns.map((column) => (
              <Table.ColumnHeader
                key={column.key}
                role="columnheader"
                w={column.width}
                css={
                  column.wideOnly
                    ? {
                        [TABLE_FITS]: { display: 'none' },
                        [TABLE_ROOMY]: { display: 'table-cell' },
                      }
                    : undefined
                }
                px="14px"
                py="12px"
                color="fg.muted"
                fontFamily="mono"
                fontSize="11px"
                fontWeight="600"
                letterSpacing="0.07em"
                textTransform="uppercase"
                borderBottomWidth="ink"
                borderColor="border.control"
              >
                {column.header}
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body
          role="rowgroup"
          css={{ display: 'block', [TABLE_FITS]: { display: 'table-row-group' } }}
        >
          {props.rows.map((row) => (
            <Table.Row
              key={props.getRowKey(row)}
              role="row"
              bg="bg.panel"
              _hover={{ bg: 'bg.subtle' }}
              position="relative"
              columnGap="8px"
              rowGap="4px"
              borderBottomStyle="dashed"
              borderColor="border"
              _last={{ borderBottomWidth: '0', '& > td': { borderBottomWidth: '0' } }}
              css={{
                display: 'grid',
                gridTemplateColumns: props.stacked?.templateColumns,
                gridTemplateAreas: props.stacked?.templateAreas,
                px: '16px',
                py: '12px',
                borderBottomWidth: '1px',
                [TABLE_TWO_LINES]: {
                  gridTemplateColumns: props.stacked?.twoLines?.templateColumns,
                  gridTemplateAreas: props.stacked?.twoLines?.templateAreas,
                },
                [TABLE_FITS]: {
                  display: 'table-row',
                  gridTemplateColumns: 'none',
                  gridTemplateAreas: 'none',
                  px: '0',
                  py: '0',
                  borderBottomWidth: '0',
                },
              }}
            >
              {props.columns.map((column) => (
                <Table.Cell
                  key={column.key}
                  role="cell"
                  minW="0"
                  borderBottomStyle="dashed"
                  borderColor="border"
                  css={{
                    display: 'block',
                    gridArea: column.key,
                    justifySelf: column.stackedAlign ?? 'start',
                    maxW: '100%',
                    px: '0',
                    py: '0',
                    borderBottomWidth: '0',
                    [TABLE_TWO_LINES]: { justifySelf: props.stacked?.twoLines && 'start' },
                    [TABLE_FITS]: {
                      display: column.wideOnly ? 'none' : 'table-cell',
                      gridArea: 'auto',
                      justifySelf: 'auto',
                      maxW: 'none',
                      px: '14px',
                      py: '11px',
                      borderBottomWidth: '1px',
                    },
                    [TABLE_ROOMY]: { display: 'table-cell' },
                  }}
                >
                  {column.stackedLabel ? (
                    <Flex align="baseline" wrap="wrap" columnGap="4px" minW="0">
                      {/* The header row already names the cell for a screen reader. */}
                      <Box
                        as="span"
                        aria-hidden="true"
                        color="fg.muted"
                        css={{ [TABLE_FITS]: { display: 'none' } }}
                      >
                        {column.header}
                      </Box>
                      <Box minW="0">{row[column.key]}</Box>
                    </Flex>
                  ) : (
                    row[column.key]
                  )}
                </Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  )
}

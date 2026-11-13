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
   * Leaves the column out of the table between `lg` and `xl`, where the fixed
   * widths would squeeze the flexible column too far; the caller shows its
   * value inside another cell there. A stacked row still has its area.
   */
  fromXl?: boolean
}

interface GridLayout {
  templateColumns: string
  templateAreas: string
}

/**
 * How a row is laid out below the `lg` breakpoint, where the columns no longer
 * fit: a CSS grid whose areas are named after the column keys.
 */
export interface StackedLayout extends GridLayout {
  /**
   * From `md` to `lg`: a wider grid, typically two lines, whose fixed tracks
   * line the values up down the list like columns. Every value then starts its
   * area, as in the table.
   */
  md?: GridLayout
}

/**
 * A plain table of rows, one cell per column key. `table-layout: fixed`, so a
 * cell whose content changes with state never moves a column. With no rows it
 * draws the empty state instead of an empty grid.
 *
 * Below `lg` each row stacks into the `stacked` grid (its `md` variant from
 * `md`) and the header row is only read aloud. The table roles are spelled out because some browsers drop
 * a table's semantics once its rows stop being `display: table-row`.
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
    <Table.Root
      role="table"
      size="sm"
      tableLayout="fixed"
      fontSize="14px"
      display={{ base: 'block', lg: 'table' }}
    >
      <Table.Header
        role="rowgroup"
        display={{ base: 'block', lg: 'table-header-group' }}
        srOnly={{ base: true, lg: false }}
      >
        <Table.Row role="row" bg="bg.panel">
          {props.columns.map((column) => (
            <Table.ColumnHeader
              key={column.key}
              role="columnheader"
              display={column.fromXl ? { lg: 'none', xl: 'table-cell' } : undefined}
              w={column.width}
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
      <Table.Body role="rowgroup" display={{ base: 'block', lg: 'table-row-group' }}>
        {props.rows.map((row) => (
          <Table.Row
            key={props.getRowKey(row)}
            role="row"
            bg="bg.panel"
            _hover={{ bg: 'bg.subtle' }}
            position="relative"
            display={{ base: 'grid', lg: 'table-row' }}
            gridTemplateColumns={{
              base: props.stacked?.templateColumns,
              md: props.stacked?.md?.templateColumns,
              lg: 'none',
            }}
            gridTemplateAreas={{
              base: props.stacked?.templateAreas,
              md: props.stacked?.md?.templateAreas,
              lg: 'none',
            }}
            columnGap="8px"
            rowGap="4px"
            px={{ base: '16px', lg: '0' }}
            py={{ base: '12px', lg: '0' }}
            borderBottomWidth={{ base: '1px', lg: '0' }}
            borderBottomStyle="dashed"
            borderColor="border"
            _last={{ borderBottomWidth: '0', '& > td': { borderBottomWidth: '0' } }}
          >
            {props.columns.map((column) => (
              <Table.Cell
                key={column.key}
                role="cell"
                gridArea={{ base: column.key, lg: 'auto' }}
                justifySelf={{
                  base: column.stackedAlign ?? 'start',
                  md: props.stacked?.md && 'start',
                  lg: 'auto',
                }}
                display={{
                  base: 'block',
                  lg: column.fromXl ? 'none' : 'table-cell',
                  xl: 'table-cell',
                }}
                minW="0"
                maxW={{ base: '100%', lg: 'none' }}
                px={{ base: '0', lg: '14px' }}
                py={{ base: '0', lg: '11px' }}
                borderBottomWidth={{ base: '0', lg: '1px' }}
                borderBottomStyle="dashed"
                borderColor="border"
              >
                {column.stackedLabel ? (
                  <Flex align="baseline" wrap="wrap" columnGap="4px" minW="0">
                    {/* The header row already names the cell for a screen reader. */}
                    <Box as="span" aria-hidden="true" color="fg.muted" hideFrom="lg">
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
  )
}

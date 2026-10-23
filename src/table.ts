export type ColumnAlignment = 'left' | 'right'

/**
 * Pads every cell to its column's widest cell and joins the cells of a row with
 * two spaces. A column absent from `align` is left-aligned. Cells are plain
 * text: a styled cell would count its escape codes as width.
 */
export function alignColumns(
  rows: readonly (readonly string[])[],
  align: readonly ColumnAlignment[] = [],
): string[] {
  const columnCount = Math.max(0, ...rows.map((row) => row.length))
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(0, ...rows.map((row) => (row[column] ?? '').length)),
  )
  return rows.map((row) =>
    widths
      .map((width, column) => {
        const cell = row[column] ?? ''
        return align[column] === 'right' ? cell.padStart(width) : cell.padEnd(width)
      })
      .join('  ')
      .trimEnd(),
  )
}

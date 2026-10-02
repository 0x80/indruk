import type { LineCount, Totals } from './count.ts'

const whole = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** A share as a whole percent, or `<1%` for a nonzero share under one percent. */
function percent(part: number, total: number): string {
  if (total === 0) return '0%'
  const share = (part / total) * 100
  return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`
}

/** Categories under this share of all code fold into one `other` line. */
const MINOR_CATEGORY_SHARE = 0.01

const LARGEST_COUNT = 5

const LANGUAGE_COUNT = 4

/** Pads every column to its widest cell, right-aligned except the first and, with `trailing`, the last. */
function alignedRows(rows: readonly (readonly string[])[], trailing = false): string[] {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  )
  return rows.map((row) =>
    row
      .map((cell, column) =>
        column === 0 || (trailing && column === row.length - 1)
          ? cell.padEnd(widths[column] ?? 0)
          : cell.padStart(widths[column] ?? 0),
      )
      .join('  ')
      .trimEnd(),
  )
}

/**
 * The highlights: the totals, the test share, the language mix when there is
 * more than one, code per category, and the largest buckets.
 */
export function formatSummary(count: LineCount, name: string): string {
  const { grand } = count
  if (grand.files === 0) return `${name}: no code found\n`
  const lines = [
    `${name}: ${whole.format(grand.code)} lines of code in ${whole.format(grand.files)} files`,
    `tests ${percent(grand.tests, grand.code)} · comments ${whole.format(grand.comment)} · complexity ${whole.format(grand.complexity)}`,
  ]
  if (count.languages.length > 1) {
    lines.push(
      count.languages
        .slice(0, LANGUAGE_COUNT)
        .map((language) => `${language.name} ${percent(language.code, grand.code)}`)
        .join(' · '),
    )
  }

  const major = count.categories.filter(
    (category) => category.code >= grand.code * MINOR_CATEGORY_SHARE,
  )
  const minor = count.categories.slice(major.length)
  const rows = major.map((category) => {
    const packages = category.buckets.filter((bucket) => bucket.name !== category.name).length
    return [
      category.name,
      whole.format(category.code),
      percent(category.code, grand.code),
      packages === 0 ? '' : `${packages} ${packages === 1 ? 'package' : 'packages'}`,
    ]
  })
  if (minor.length > 0) {
    const code = minor.reduce((sum, category) => sum + category.code, 0)
    rows.push([
      'other',
      whole.format(code),
      percent(code, grand.code),
      minor.map((category) => category.name).join(', '),
    ])
  }
  lines.push('', ...alignedRows(rows, true))

  const largest = count.categories
    .flatMap((category) => category.buckets)
    .sort((left, right) => right.code - left.code)
    .slice(0, LARGEST_COUNT)
  if (largest.length > 1) {
    lines.push(
      '',
      `largest: ${largest.map((bucket) => `${bucket.name.split('/').at(-1) ?? bucket.name} ${compact.format(bucket.code)}`).join(' · ')}`,
    )
  }
  return `${lines.join('\n')}\n`
}

const COLUMNS = ['code', 'tests', 'comment', 'files', 'complexity'] as const

function totalsCells(label: string, totals: Totals): string[] {
  return [
    label,
    whole.format(totals.code),
    percent(totals.tests, totals.code),
    whole.format(totals.comment),
    whole.format(totals.files),
    whole.format(totals.complexity),
  ]
}

/**
 * A category's own bucket, a top-level package or the files outside any
 * package beneath it, is listed under it only when the category holds other
 * buckets; alone, the category row already is its count.
 */
export function formatFull(count: LineCount): string {
  const rows: string[][] = [['', ...COLUMNS]]
  for (const category of count.categories) {
    rows.push(totalsCells(category.name, category))
    if (category.buckets.length === 1 && category.buckets[0]?.name === category.name) continue
    for (const bucket of category.buckets) {
      const label =
        bucket.name === category.name ? '(top level)' : bucket.name.slice(category.name.length + 1)
      rows.push(totalsCells(`  ${label}`, bucket))
    }
  }
  rows.push(totalsCells('total', count.grand))
  return `${alignedRows(rows).join('\n')}\n`
}

export function formatJson(count: LineCount, root: string): string {
  return `${JSON.stringify({ root, ...count }, undefined, 2)}\n`
}

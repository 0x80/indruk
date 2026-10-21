import type { styleText } from 'node:util'
import { alignColumns, type ColumnAlignment } from '@emberengineering/cli-output'
import type { LineCount, Totals } from './count.ts'
import { DOCS_DIRECTORY, type DocsCount } from './docs.ts'

/**
 * Styles a piece of report text. The command passes `styleText`, which
 * follows Node's color policy: plain when stdout is not a terminal or
 * `NO_COLOR` is set, unless `FORCE_COLOR` asks for color. A test passes a
 * painter that returns the text unchanged, or one that marks the style.
 */
export type Paint = (format: Parameters<typeof styleText>[0], text: string) => string

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

/** Aligns every column right except the first and, with `trailing`, the last. */
function alignedRows(rows: readonly (readonly string[])[], trailing = false): string[] {
  const columnCount = rows[0]?.length ?? 0
  const align = Array.from(
    { length: columnCount },
    (_, column): ColumnAlignment =>
      column === 0 || (trailing && column === columnCount - 1) ? 'left' : 'right',
  )
  return alignColumns(rows, { align })
}

/** Aligns a table and dims its header row. */
function table(paint: Paint, rows: readonly (readonly string[])[], trailing = false): string[] {
  const [header = '', ...body] = alignedRows(rows, trailing)
  return [paint('dim', header), ...body]
}

/** Average silent reading rate for English non-fiction, in words per minute (Brysbaert, 2019). */
const READING_WORDS_PER_MINUTE = 238

function plural(count: number, noun: string): string {
  return `${whole.format(count)} ${count === 1 ? noun : `${noun}s`}`
}

function readingTime(words: number): string {
  const minutes = Math.max(1, Math.round(words / READING_WORDS_PER_MINUTE))
  return minutes < 60 ? plural(minutes, 'minute') : plural(Math.round(minutes / 60), 'hour')
}

function docsLine(paint: Paint, docs: DocsCount): string {
  return `${plural(docs.words, 'word')} in ${plural(docs.files, 'document')} under ${DOCS_DIRECTORY}/${paint('dim', `, about ${readingTime(docs.words)} of reading`)}`
}

/** Words and files per subdirectory of the docs directory, with a total row in the full report. */
function docsRows(paint: Paint, docs: DocsCount, withTotal: boolean): string[] {
  const rows = [[`${DOCS_DIRECTORY}/`, 'words', 'share', 'files']]
  for (const entry of docs.packages) {
    rows.push([
      entry.name,
      whole.format(entry.words),
      percent(entry.words, docs.words),
      whole.format(entry.files),
    ])
  }
  if (!withTotal) return table(paint, rows)
  rows.push(['total', whole.format(docs.words), '', whole.format(docs.files)])
  const lines = table(paint, rows)
  return [...lines.slice(0, -1), paint('bold', lines.at(-1) ?? '')]
}

/**
 * The highlights: the code total with its production and test parts, the
 * complexity and language mix, then what is not code (comments and
 * documentation), production and test code per category, the buckets
 * holding the most production code, and words per docs subdirectory.
 * `docs` is undefined when the run did not read documentation.
 */
export function formatSummary(
  count: LineCount,
  name: string,
  paint: Paint,
  docs?: DocsCount,
): string {
  const { grand } = count
  const title = paint('bold', name)
  const hasDocs = docs !== undefined && docs.files > 0
  if (grand.files === 0) {
    if (!hasDocs) return `${title}: no code found\n`
    const lines = [
      `${title}: no code found`,
      `docs ${docsLine(paint, docs)}`,
      '',
      ...docsRows(paint, docs, false),
    ]
    return `${lines.join('\n')}\n`
  }

  const lines = [
    `${title}: ${whole.format(grand.code)} lines of code in ${plural(grand.files, 'file')}`,
    ...alignedRows([
      [
        '  production',
        whole.format(grand.production.code),
        percent(grand.production.code, grand.code),
      ],
      ['  tests', whole.format(grand.tests.code), percent(grand.tests.code, grand.code)],
    ]),
    `complexity ${whole.format(grand.complexity)}`,
  ]
  if (count.languages.length > 1) {
    lines.push(
      count.languages
        .slice(0, LANGUAGE_COUNT)
        .map((language) => `${language.name} ${percent(language.code, grand.code)}`)
        .join(' · '),
    )
  }
  const notCode = [
    ['comments', `${plural(grand.comment, 'line')}${paint('dim', ', not counted as code')}`],
  ]
  if (hasDocs) notCode.push(['docs', docsLine(paint, docs)])
  lines.push('', ...alignedRows(notCode, true))

  const isMajor = (category: Totals): boolean => category.code >= grand.code * MINOR_CATEGORY_SHARE
  const major = count.categories.filter(isMajor)
  const minor = count.categories.filter((category) => !isMajor(category))
  const rows = [['', 'production', 'share', 'tests', '']]
  for (const category of major) {
    const packages = category.buckets.filter((bucket) => bucket.name !== category.name).length
    rows.push([
      category.name,
      whole.format(category.production.code),
      percent(category.production.code, grand.production.code),
      whole.format(category.tests.code),
      packages === 0 ? '' : paint('dim', `${packages} ${packages === 1 ? 'package' : 'packages'}`),
    ])
  }
  if (minor.length > 0) {
    const production = minor.reduce((sum, category) => sum + category.production.code, 0)
    const tests = minor.reduce((sum, category) => sum + category.tests.code, 0)
    rows.push([
      'other',
      whole.format(production),
      percent(production, grand.production.code),
      whole.format(tests),
      paint('dim', minor.map((category) => category.name).join(', ')),
    ])
  }
  lines.push('', ...table(paint, rows, true))

  const largest = count.categories
    .flatMap((category) => category.buckets)
    .filter((bucket) => bucket.production.code > 0)
    .sort((left, right) => right.production.code - left.production.code)
    .slice(0, LARGEST_COUNT)
  if (largest.length > 1) {
    lines.push(
      '',
      `${paint('dim', 'most production code:')} ${largest.map((bucket) => `${bucket.name.split('/').at(-1) ?? bucket.name} ${compact.format(bucket.production.code)}`).join(' · ')}`,
    )
  }
  if (hasDocs) lines.push('', ...docsRows(paint, docs, false))
  return `${lines.join('\n')}\n`
}

const COLUMNS = ['production', 'tests', 'test share', 'comment', 'files', 'complexity'] as const

function totalsCells(label: string, totals: Totals): string[] {
  return [
    label,
    whole.format(totals.production.code),
    whole.format(totals.tests.code),
    percent(totals.tests.code, totals.code),
    whole.format(totals.comment),
    whole.format(totals.files),
    whole.format(totals.complexity),
  ]
}

/**
 * A category's own bucket, a top-level package or the files outside any
 * package beneath it, is listed under it only when the category holds other
 * buckets; alone, the category row already is its count. Category rows and
 * the total are bold. Words per docs subdirectory follow in a table of their
 * own.
 */
export function formatFull(count: LineCount, paint: Paint, docs?: DocsCount): string {
  const rows: string[][] = [['', ...COLUMNS]]
  const bold = new Set<number>()
  for (const category of count.categories) {
    bold.add(rows.length)
    rows.push(totalsCells(category.name, category))
    if (category.buckets.length === 1 && category.buckets[0]?.name === category.name) continue
    for (const bucket of category.buckets) {
      const label =
        bucket.name === category.name ? '(top level)' : bucket.name.slice(category.name.length + 1)
      rows.push(totalsCells(`  ${label}`, bucket))
    }
  }
  bold.add(rows.length)
  rows.push(totalsCells('total', count.grand))
  const lines = table(paint, rows).map((line, index) =>
    bold.has(index) ? paint('bold', line) : line,
  )
  if (docs !== undefined && docs.files > 0) lines.push('', ...docsRows(paint, docs, true))
  return `${lines.join('\n')}\n`
}

export function formatJson(count: LineCount, root: string, docs?: DocsCount): string {
  return `${JSON.stringify({ root, ...count, docs }, undefined, 2)}\n`
}

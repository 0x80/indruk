import type { SccFile, SccLanguage } from './scc.ts'

export type Totals = {
  files: number
  /** Code lines, test files included. */
  code: number
  /** The share of `code` that sits in test files. */
  tests: number
  comment: number
  complexity: number
}

export type Bucket = Totals & {
  /** A workspace package directory, a top-level directory, or {@link ROOT_BUCKET}. */
  name: string
  category: string
}

export type LineCount = {
  grand: Totals
  /** Sorted by code, largest first. */
  categories: (Totals & { name: string; buckets: Bucket[] })[]
  /** Sorted by code, largest first. */
  languages: (Totals & { name: string })[]
}

/** Where a file sitting directly in the checkout root is counted. */
export const ROOT_BUCKET = '(root)'

/**
 * Languages counted only on request: prose, data and configuration, whose
 * line counts say little about how much code there is. A Drizzle snapshot or
 * a fixture alone can be tens of thousands of JSON lines.
 */
const NON_CODE_LANGUAGES = new Set([
  'AsciiDoc',
  'CSV',
  'Docker ignore',
  'gitignore',
  'INI',
  'JSON',
  'JSON5',
  'JSONC',
  'JSONL',
  'License',
  'Markdown',
  'MDX',
  'Org',
  'Plain Text',
  'ReStructuredText',
  'SVG',
  'Textile',
  'TOML',
  'XML',
  'XML Schema',
  'YAML',
])

export function isCodeLanguage(language: string): boolean {
  return !NON_CODE_LANGUAGES.has(language)
}

/**
 * The languages a run counts: every one under `--all-languages` or with
 * `--extensions`, since naming extensions asks for those files whatever their
 * language, and only programming languages otherwise.
 */
export function selectLanguages(
  languages: readonly SccLanguage[],
  options: { allLanguages: boolean; extensions: readonly string[] | undefined },
): SccLanguage[] {
  if (options.allLanguages || options.extensions !== undefined) return [...languages]
  return languages.filter((language) => isCodeLanguage(language.Name))
}

/** Directories that hold only tests or what tests read. */
const TEST_DIRECTORIES = new Set([
  '__fixtures__',
  '__mocks__',
  '__tests__',
  'e2e',
  'fixtures',
  'test',
  'tests',
])

/**
 * Whether a path is test code by the naming conventions JavaScript, Python
 * and Go projects share. A heuristic: a test helper outside these shapes
 * counts as source.
 */
export function isTestPath(location: string): boolean {
  const segments = location.split('/')
  const name = segments.at(-1) ?? ''
  return (
    segments.slice(0, -1).some((segment) => TEST_DIRECTORIES.has(segment)) ||
    /\.(?:test|spec)\.[^/]+$/u.test(name) ||
    /[.-]test-(?:support|utils|helpers)\.[^/]+$/u.test(name) ||
    /^test_.+\.py$|_test\.(?:go|py)$/u.test(name)
  )
}

/**
 * The bucket and category a repository-relative path belongs to. A file in a
 * workspace package is counted under that package, and its category is the
 * package's first path segment. Any other file is counted under its top-level
 * directory.
 */
export function bucketFor(
  location: string,
  packageDirectories: readonly string[],
): { bucket: string; category: string } {
  const owner = packageDirectories.find((directory) => location.startsWith(`${directory}/`))
  if (owner !== undefined) return { bucket: owner, category: owner.split('/')[0] ?? owner }
  const slash = location.indexOf('/')
  if (slash === -1) return { bucket: ROOT_BUCKET, category: ROOT_BUCKET }
  const top = location.slice(0, slash)
  return { bucket: top, category: top }
}

function emptyTotals(): Totals {
  return { files: 0, code: 0, tests: 0, comment: 0, complexity: 0 }
}

function addTo(target: Totals, file: SccFile, isTest: boolean): void {
  target.files += 1
  target.code += file.Code
  if (isTest) target.tests += file.Code
  target.comment += file.Comment
  target.complexity += file.Complexity
}

function entry<T extends Totals>(map: Map<string, T>, key: string, create: () => T): T {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}

const byCode = (left: Totals, right: Totals): number => right.code - left.code

/** Sum scc's per-file counts into languages, buckets, categories and a grand total. */
export function aggregate(
  languages: readonly SccLanguage[],
  packageDirectories: readonly string[],
): LineCount {
  const grand = emptyTotals()
  const buckets = new Map<string, Bucket>()
  const categories = new Map<string, Totals & { name: string }>()
  const languageTotals = new Map<string, Totals & { name: string }>()

  for (const language of languages) {
    for (const file of language.Files ?? []) {
      const isTest = isTestPath(file.Location)
      const { bucket, category } = bucketFor(file.Location, packageDirectories)
      addTo(grand, file, isTest)
      addTo(
        entry(buckets, bucket, () => ({ name: bucket, category, ...emptyTotals() })),
        file,
        isTest,
      )
      addTo(
        entry(categories, category, () => ({ name: category, ...emptyTotals() })),
        file,
        isTest,
      )
      addTo(
        entry(languageTotals, language.Name, () => ({ name: language.Name, ...emptyTotals() })),
        file,
        isTest,
      )
    }
  }

  return {
    grand,
    categories: [...categories.values()].sort(byCode).map((category) => ({
      ...category,
      buckets: [...buckets.values()]
        .filter((bucket) => bucket.category === category.name)
        .sort(byCode),
    })),
    languages: [...languageTotals.values()].sort(byCode),
  }
}

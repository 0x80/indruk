import type { SccFile, SccLanguage } from './scc.ts'
import type { WorkspacePackage } from './workspace.ts'

export type Counts = {
  files: number
  code: number
  comment: number
  complexity: number
}

/** Counts over every file, and the same counts for each side of the production and test split. */
export type Totals = Counts & {
  /** Every file that is not test code: what the checkout runs, ships or builds with. */
  production: Counts
  /** Tests and what only tests use: helpers, fixtures, runner setup and test-support packages. */
  tests: Counts
}

export type Bucket = Totals & {
  /** A workspace package directory, a top-level directory, or {@link ROOT_BUCKET}. */
  name: string
  category: string
}

export type LineCount = {
  grand: Totals
  /** Sorted by production code, largest first. */
  categories: (Totals & { name: string; buckets: Bucket[] })[]
  /** Sorted by code, largest first, as the language mix reports each one's share of all code. */
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
 * and Go projects share: test files, test directories, test helpers, and a
 * test runner's own config and setup files. A heuristic: a test helper
 * outside these shapes counts as production code.
 */
export function isTestPath(location: string): boolean {
  const segments = location.split('/')
  const name = segments.at(-1) ?? ''
  return (
    segments.slice(0, -1).some((segment) => TEST_DIRECTORIES.has(segment)) ||
    /\.(?:test|spec)(?:-d)?\.[^/]+$/u.test(name) ||
    /(?:^|[.-])test-(?:support|utils|helpers)\.[^/]+$/u.test(name) ||
    /^(?:vitest|jest|playwright)\.(?:[^/]+\.)?(?:config|setup|workspace)\.[^/]+$/u.test(name) ||
    /^test_.+\.py$|_test\.(?:go|py)$|^conftest\.py$/u.test(name)
  )
}

/**
 * Where a repository-relative path is counted, and whether it is test code.
 * A file in a workspace package is counted under that package, and its
 * category is the package's first path segment. Any other file is counted
 * under its top-level directory. Every file of a test-support package is test
 * code; elsewhere {@link isTestPath} decides.
 */
export function classify(
  location: string,
  packages: readonly WorkspacePackage[],
): { bucket: string; category: string; isTest: boolean } {
  const owner = packages.find((candidate) => location.startsWith(`${candidate.directory}/`))
  const isTest = owner?.testSupport === true || isTestPath(location)
  if (owner !== undefined) {
    return { bucket: owner.directory, category: owner.directory.split('/')[0] ?? '', isTest }
  }
  const slash = location.indexOf('/')
  if (slash === -1) return { bucket: ROOT_BUCKET, category: ROOT_BUCKET, isTest }
  const top = location.slice(0, slash)
  return { bucket: top, category: top, isTest }
}

function emptyCounts(): Counts {
  return { files: 0, code: 0, comment: 0, complexity: 0 }
}

function emptyTotals(): Totals {
  return { ...emptyCounts(), production: emptyCounts(), tests: emptyCounts() }
}

function addCounts(target: Counts, file: SccFile): void {
  target.files += 1
  target.code += file.Code
  target.comment += file.Comment
  target.complexity += file.Complexity
}

function addTo(target: Totals, file: SccFile, isTest: boolean): void {
  addCounts(target, file)
  addCounts(isTest ? target.tests : target.production, file)
}

function entry<T extends Totals>(map: Map<string, T>, key: string, create: () => T): T {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}

/** Largest production code first; all-test groups by their test code after them. */
const byProduction = (left: Totals, right: Totals): number =>
  right.production.code - left.production.code || right.code - left.code

export function aggregate(
  languages: readonly SccLanguage[],
  packages: readonly WorkspacePackage[],
): LineCount {
  const grand = emptyTotals()
  const buckets = new Map<string, Bucket>()
  const categories = new Map<string, Totals & { name: string }>()
  const languageTotals = new Map<string, Totals & { name: string }>()

  for (const language of languages) {
    for (const file of language.Files ?? []) {
      const { bucket, category, isTest } = classify(file.Location, packages)
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
    categories: [...categories.values()].sort(byProduction).map((category) => ({
      ...category,
      buckets: [...buckets.values()]
        .filter((bucket) => bucket.category === category.name)
        .sort(byProduction),
    })),
    languages: [...languageTotals.values()].sort((left, right) => right.code - left.code),
  }
}

import { describe, expect, it } from 'vitest'
import {
  aggregate,
  classify,
  isCodeLanguage,
  isTestPath,
  ROOT_BUCKET,
  selectLanguages,
} from './count.ts'

describe('isTestPath', () => {
  it.each([
    'packages/a/src/lease.test.ts',
    'apps/web/src/button.spec.tsx',
    'packages/a/src/lease.integration.test.ts',
    'packages/a/src/git-test-support.ts',
    'packages/a/src/test-support.ts',
    'packages/a/src/types.test-d.ts',
    'packages/a/test/fixtures/repo/index.ts',
    'apps/web/__tests__/page.tsx',
    'packages/a/vitest.config.ts',
    'packages/a/vitest.integration.config.ts',
    'packages/a/vitest.setup.ts',
    'apps/web/playwright.config.ts',
    'tools/parser_test.go',
    'tools/test_parser.py',
    'tools/conftest.py',
  ])('reads %s as test code', (path) => {
    expect(isTestPath(path)).toBe(true)
  })

  it.each([
    'packages/a/src/lease.ts',
    'packages/test-gate/src/main.ts',
    'packages/a/src/testing.ts',
    'packages/a/src/contest.ts',
    'packages/a/src/vitest-reporter.ts',
    'packages/a/src/latest-support.ts',
  ])('reads %s as production code', (path) => {
    expect(isTestPath(path)).toBe(false)
  })
})

describe('classify', () => {
  const packages = [
    { directory: 'packages/server/db', testSupport: false },
    { directory: 'packages/foundation', testSupport: false },
    { directory: 'packages/test-harness', testSupport: true },
    { directory: 'scripts', testSupport: false },
  ]

  it('counts a file under its workspace package, categorized by the first segment', () => {
    expect(classify('packages/server/db/src/schema.ts', packages)).toEqual({
      bucket: 'packages/server/db',
      category: 'packages',
      isTest: false,
    })
    expect(classify('scripts/src/validate.test.ts', packages)).toEqual({
      bucket: 'scripts',
      category: 'scripts',
      isTest: true,
    })
  })

  it('reads every file of a test-support package as test code', () => {
    expect(classify('packages/test-harness/src/home.ts', packages)).toEqual({
      bucket: 'packages/test-harness',
      category: 'packages',
      isTest: true,
    })
  })

  it('does not take a sibling sharing a name prefix for the package', () => {
    expect(classify('packages/foundation-extra/src/a.ts', packages)).toEqual({
      bucket: 'packages',
      category: 'packages',
      isTest: false,
    })
  })

  it('counts any other file under its top-level directory, and a root file under the root', () => {
    expect(classify('docs/reports/a.html', packages)).toEqual({
      bucket: 'docs',
      category: 'docs',
      isTest: false,
    })
    expect(classify('vitest.config.ts', packages)).toEqual({
      bucket: ROOT_BUCKET,
      category: ROOT_BUCKET,
      isTest: true,
    })
  })
})

describe('isCodeLanguage', () => {
  it('leaves prose and data out and keeps programming languages', () => {
    expect(isCodeLanguage('JSON')).toBe(false)
    expect(isCodeLanguage('Markdown')).toBe(false)
    expect(isCodeLanguage('TypeScript')).toBe(true)
    expect(isCodeLanguage('SQL')).toBe(true)
  })
})

describe('selectLanguages', () => {
  const languages = [
    { Name: 'TypeScript', Files: [] },
    { Name: 'JSONC', Files: [] },
    { Name: 'Markdown', Files: [] },
  ]
  const names = (selected: readonly { Name: string }[]) => selected.map((language) => language.Name)

  it('keeps only programming languages by default', () => {
    expect(
      names(selectLanguages(languages, { allLanguages: false, extensions: undefined })),
    ).toEqual(['TypeScript'])
  })

  it('keeps every language under --all-languages or when extensions were named', () => {
    const every = ['TypeScript', 'JSONC', 'Markdown']
    expect(
      names(selectLanguages(languages, { allLanguages: true, extensions: undefined })),
    ).toEqual(every)
    expect(
      names(selectLanguages(languages, { allLanguages: false, extensions: ['jsonc', 'md'] })),
    ).toEqual(every)
  })
})

describe('aggregate', () => {
  const file = (Location: string, Code: number) => ({
    Location,
    Code,
    Comment: 1,
    Complexity: 2,
  })

  const split = (totals: { production: { code: number }; tests: { code: number } }) => [
    totals.production.code,
    totals.tests.code,
  ]

  it('sums buckets, categories, languages and the total, split into production and tests', () => {
    const count = aggregate(
      [
        {
          Name: 'TypeScript',
          Files: [
            file('apps/web/src/page.ts', 30),
            file('apps/web/src/page.test.ts', 20),
            file('apps/api/src/route.ts', 40),
            file('scripts/build.ts', 5),
          ],
        },
        { Name: 'SQL', Files: [file('apps/api/schema.sql', 8)] },
        { Name: 'TSX', Files: null },
      ],
      [
        { directory: 'apps/web', testSupport: false },
        { directory: 'apps/api', testSupport: false },
      ],
    )

    expect(count.grand).toEqual({
      files: 5,
      code: 103,
      comment: 5,
      complexity: 10,
      production: { files: 4, code: 83, comment: 4, complexity: 8 },
      tests: { files: 1, code: 20, comment: 1, complexity: 2 },
    })
    expect(count.categories.map((category) => [category.name, ...split(category)])).toEqual([
      ['apps', 78, 20],
      ['scripts', 5, 0],
    ])
    expect(count.categories[0]?.buckets.map((bucket) => [bucket.name, ...split(bucket)])).toEqual([
      ['apps/api', 48, 0],
      ['apps/web', 30, 20],
    ])
    expect(count.languages.map((language) => [language.name, ...split(language)])).toEqual([
      ['TypeScript', 75, 20],
      ['SQL', 8, 0],
    ])
  })

  it('counts a test-support package as test code and orders it after packages with production code', () => {
    const count = aggregate(
      [
        {
          Name: 'TypeScript',
          Files: [file('packages/harness/src/home.ts', 500), file('packages/core/src/a.ts', 10)],
        },
      ],
      [
        { directory: 'packages/harness', testSupport: true },
        { directory: 'packages/core', testSupport: false },
      ],
    )

    expect(count.categories[0]?.buckets.map((bucket) => [bucket.name, ...split(bucket)])).toEqual([
      ['packages/core', 10, 0],
      ['packages/harness', 0, 500],
    ])
  })

  it('orders languages by all their code, since the language mix reports shares of all code', () => {
    const count = aggregate(
      [
        { Name: 'TypeScript', Files: [file('src/a.ts', 10)] },
        { Name: 'JavaScript', Files: [file('src/a.test.js', 40)] },
      ],
      [],
    )

    expect(count.languages.map((language) => language.name)).toEqual(['JavaScript', 'TypeScript'])
  })
})

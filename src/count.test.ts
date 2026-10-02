import { describe, expect, it } from 'vitest'
import {
  aggregate,
  bucketFor,
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
    'packages/a/test/fixtures/repo/index.ts',
    'apps/web/__tests__/page.tsx',
    'tools/parser_test.go',
    'tools/test_parser.py',
  ])('reads %s as test code', (path) => {
    expect(isTestPath(path)).toBe(true)
  })

  it.each([
    'packages/a/src/lease.ts',
    'packages/test-gate/src/main.ts',
    'packages/a/src/testing.ts',
    'packages/a/src/contest.ts',
  ])('reads %s as source', (path) => {
    expect(isTestPath(path)).toBe(false)
  })
})

describe('bucketFor', () => {
  const packages = ['packages/server/db', 'packages/foundation', 'scripts']

  it('counts a file under its workspace package, categorized by the first segment', () => {
    expect(bucketFor('packages/server/db/src/schema.ts', packages)).toEqual({
      bucket: 'packages/server/db',
      category: 'packages',
    })
    expect(bucketFor('scripts/src/validate.ts', packages)).toEqual({
      bucket: 'scripts',
      category: 'scripts',
    })
  })

  it('does not take a sibling sharing a name prefix for the package', () => {
    expect(bucketFor('packages/foundation-extra/src/a.ts', packages)).toEqual({
      bucket: 'packages',
      category: 'packages',
    })
  })

  it('counts any other file under its top-level directory, and a root file under the root', () => {
    expect(bucketFor('docs/reports/a.html', packages)).toEqual({
      bucket: 'docs',
      category: 'docs',
    })
    expect(bucketFor('vitest.config.ts', packages)).toEqual({
      bucket: ROOT_BUCKET,
      category: ROOT_BUCKET,
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

  it('sums buckets, categories, languages and the total, with test code split out', () => {
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
      ['apps/web', 'apps/api'],
    )

    expect(count.grand).toEqual({ files: 5, code: 103, tests: 20, comment: 5, complexity: 10 })
    expect(count.categories.map((category) => [category.name, category.code])).toEqual([
      ['apps', 98],
      ['scripts', 5],
    ])
    expect(count.categories[0]?.buckets.map((bucket) => [bucket.name, bucket.code])).toEqual([
      ['apps/web', 50],
      ['apps/api', 48],
    ])
    expect(count.categories[0]?.buckets[0]?.tests).toBe(20)
    expect(count.languages.map((language) => [language.name, language.code])).toEqual([
      ['TypeScript', 95],
      ['SQL', 8],
    ])
  })
})

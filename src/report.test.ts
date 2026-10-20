import { describe, expect, it } from 'vitest'
import { aggregate } from './count.ts'
import type { DocsCount } from './docs.ts'
import { formatFull, formatSummary, type Paint } from './report.ts'

const plain: Paint = (_, text) => text

const file = (Location: string, Code: number) => ({ Location, Code, Comment: 0, Complexity: 1 })

const count = aggregate(
  [
    {
      Name: 'TypeScript',
      Files: [
        file('packages/a/src/index.ts', 600),
        file('packages/a/src/index.test.ts', 400),
        file('packages/b/src/index.ts', 300),
        file('scripts/build.ts', 95),
        file('README.ts', 5),
      ],
    },
  ],
  [
    { directory: 'packages/a', testSupport: false },
    { directory: 'packages/b', testSupport: false },
  ],
)

const docs: DocsCount = {
  files: 3,
  words: 2380,
  packages: [
    { name: 'guides', files: 2, words: 2000 },
    { name: '(top level)', files: 1, words: 380 },
  ],
}

describe('formatSummary', () => {
  it('reports production and test code under the total, then comments and docs apart from code', () => {
    expect(formatSummary(count, 'demo', plain, docs)).toBe(
      [
        'demo: 1,400 lines of code in 5 files',
        '  production  1,000  71%',
        '  tests         400  29%',
        'complexity 5',
        '',
        'comments  0 lines, not counted as code',
        'docs      2,380 words in 3 documents under docs/, about 10 minutes of reading',
        '',
        '          production  share  tests',
        'packages         900    90%    400  2 packages',
        'scripts           95    10%      0',
        'other              5    <1%      0  (root)',
        '',
        'most production code: a 600 · b 300 · scripts 95 · (root) 5',
        '',
        'docs/        words  share  files',
        'guides       2,000    84%      2',
        '(top level)    380    16%      1',
        '',
      ].join('\n'),
    )
  })

  it('styles the name and what is not code without shifting any column', () => {
    const marked: Paint = (format, text) => (text === '' ? '' : `<${String(format)}>${text}</>`)

    const lines = formatSummary(count, 'demo', marked, docs).split('\n')

    expect(lines.slice(0, 3)).toEqual([
      '<bold>demo</>: 1,400 lines of code in 5 files',
      '  production  1,000  71%',
      '  tests         400  29%',
    ])
    expect(lines[5]).toBe('comments  0 lines<dim>, not counted as code</>')
    expect(lines.slice(8, 10)).toEqual([
      '<dim>          production  share  tests</>',
      'packages         900    90%    400  <dim>2 packages</>',
    ])
  })

  it('names the language mix only when there is more than one language', () => {
    const mixed = aggregate(
      [
        { Name: 'TypeScript', Files: [file('src/a.ts', 90)] },
        { Name: 'SQL', Files: [file('src/a.sql', 10)] },
      ],
      [],
    )

    expect(formatSummary(mixed, 'demo', plain).split('\n')[4]).toBe('TypeScript 90% · SQL 10%')
  })

  it('folds only the categories under one percent of all code into other, whatever their production order', () => {
    const uneven = aggregate(
      [
        {
          Name: 'TypeScript',
          Files: [file('big/a.ts', 1000), file('tiny/a.ts', 1), file('suite/a.test.ts', 100)],
        },
      ],
      [],
    )

    expect(formatSummary(uneven, 'demo', plain).split('\n').slice(7, 11)).toEqual([
      '       production  share  tests',
      'big         1,000   100%      0',
      'suite           0     0%    100',
      'other           1    <1%      0  tiny',
    ])
  })

  it('leaves the docs line out when documentation was not read or holds no file', () => {
    const empty: DocsCount = { files: 0, words: 0, packages: [] }

    for (const absent of [undefined, empty]) {
      const lines = formatSummary(count, 'demo', plain, absent).split('\n')
      expect(lines.slice(4, 7)).toEqual(['', 'comments  0 lines, not counted as code', ''])
      expect(lines.slice(-3)).toEqual([
        '',
        'most production code: a 600 · b 300 · scripts 95 · (root) 5',
        '',
      ])
    }
  })

  it('reads a long document set in hours', () => {
    const long: DocsCount = { files: 1, words: 238 * 150, packages: [] }

    expect(formatSummary(count, 'demo', plain, long).split('\n')[6]).toBe(
      'docs      35,700 words in 1 document under docs/, about 3 hours of reading',
    )
  })

  it('says so when nothing was counted, and still reports the docs', () => {
    expect(formatSummary(aggregate([], []), 'demo', plain)).toBe('demo: no code found\n')
    expect(formatSummary(aggregate([], []), 'demo', plain, docs)).toBe(
      [
        'demo: no code found',
        'docs 2,380 words in 3 documents under docs/, about 10 minutes of reading',
        '',
        'docs/        words  share  files',
        'guides       2,000    84%      2',
        '(top level)    380    16%      1',
        '',
      ].join('\n'),
    )
  })
})

describe('formatFull', () => {
  it("lists a category's own bucket beside the packages inside it", () => {
    const nested = aggregate(
      [
        {
          Name: 'TypeScript',
          Files: [file('tools/src/index.ts', 40), file('tools/plugin/src/index.ts', 10)],
        },
      ],
      [
        { directory: 'tools/plugin', testSupport: false },
        { directory: 'tools', testSupport: false },
      ],
    )

    expect(formatFull(nested, plain).split('\n').slice(1, 4)).toEqual([
      'tools                  50      0          0%        0      2           2',
      '  (top level)          40      0          0%        0      1           1',
      '  plugin               10      0          0%        0      1           1',
    ])
  })

  it('lists each package under its category by its name inside it', () => {
    expect(formatFull(count, plain).split('\n').slice(0, 4)).toEqual([
      '          production  tests  test share  comment  files  complexity',
      'packages         900    400         31%        0      3           3',
      '  a              600    400         40%        0      2           2',
      '  b              300      0          0%        0      1           1',
    ])
  })

  it('follows the code table with words per docs subdirectory and their total', () => {
    expect(formatFull(count, plain, docs).split('\n').slice(-6)).toEqual([
      '',
      'docs/        words  share  files',
      'guides       2,000    84%      2',
      '(top level)    380    16%      1',
      'total        2,380             3',
      '',
    ])
  })
})

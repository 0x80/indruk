import { describe, expect, it } from 'vitest'
import { aggregate } from './count.ts'
import { formatFull, formatSummary } from './report.ts'

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
  ['packages/a', 'packages/b'],
)

describe('formatSummary', () => {
  it('reports the totals, each category with its package count, and the largest buckets', () => {
    expect(formatSummary(count, 'demo')).toBe(
      [
        'demo: 1,400 lines of code in 5 files',
        'tests 29% · comments 0 · complexity 5',
        '',
        'packages  1,300  93%  2 packages',
        'scripts      95   7%',
        'other         5  <1%  (root)',
        '',
        'largest: a 1K · b 300 · scripts 95 · (root) 5',
        '',
      ].join('\n'),
    )
  })

  it('names the language mix only when there is more than one language', () => {
    const mixed = aggregate(
      [
        { Name: 'TypeScript', Files: [file('src/a.ts', 90)] },
        { Name: 'SQL', Files: [file('src/a.sql', 10)] },
      ],
      [],
    )

    expect(formatSummary(mixed, 'demo').split('\n')[2]).toBe('TypeScript 90% · SQL 10%')
  })

  it('says so when nothing was counted', () => {
    expect(formatSummary(aggregate([], []), 'demo')).toBe('demo: no code found\n')
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
      ['tools/plugin', 'tools'],
    )

    expect(formatFull(nested).split('\n').slice(1, 4)).toEqual([
      'tools            50     0%        0      2           2',
      '  (top level)    40     0%        0      1           1',
      '  plugin         10     0%        0      1           1',
    ])
  })

  it('lists each package under its category by its name inside it', () => {
    expect(formatFull(count).split('\n').slice(0, 4)).toEqual([
      '           code  tests  comment  files  complexity',
      'packages  1,300    31%        0      3           3',
      '  a       1,000    40%        0      2           2',
      '  b         300     0%        0      1           1',
    ])
  })
})

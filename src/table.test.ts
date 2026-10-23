import { describe, expect, it } from 'vitest'
import { alignColumns } from './table.ts'

describe('alignColumns', () => {
  it('pads each column to its widest cell and right-aligns the columns asked for', () => {
    expect(
      alignColumns(
        [
          ['package', 'lines'],
          ['a', '1,200'],
          ['longer', '7'],
        ],
        ['left', 'right'],
      ),
    ).toEqual(['package  lines', 'a        1,200', 'longer       7'])
  })

  it('drops the padding after the last cell of a left-aligned row', () => {
    expect(alignColumns([['a', 'b'], ['ccc', 'dddd']])).toEqual(['a    b', 'ccc  dddd'])
  })
})

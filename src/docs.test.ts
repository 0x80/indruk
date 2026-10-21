import { mkdir, writeFile } from 'node:fs/promises'
import { temporaryDirectory } from '@emberengineering/config-vitest/temporary-directory'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countDocs, proseWords, TOP_LEVEL_DOCS } from './docs.ts'

describe('proseWords', () => {
  it.each([
    ['plain paragraphs', 'One two three.\n\nFour five.\n', 5],
    ['a heading and a list', '# Getting started\n\n- install it\n- run it\n', 6],
    ['inline code as part of the sentence', 'Run `pnpm test` first.\n', 4],
    ['a link by its text, not its target', 'See [the guide](https://example.com/a/b/c).\n', 3],
    ['emphasis inside a word as one word', 'un**believ**able\n', 1],
    ['the cells of a table written without spaces', '|name|value|\n|---|---|\n|a|b c|\n', 5],
  ])('counts %s', (_, markdown, words) => {
    expect(proseWords(markdown, 'markdown')).toBe(words)
  })

  it.each([
    ['a fenced code block', 'Before.\n\n```ts\nconst a = 1\nconst b = 2\n```\n\nAfter.\n'],
    ['an indented code block', 'Before.\n\n    const a = 1\n\nAfter.\n'],
    ['raw HTML', 'Before.\n\n<details><summary>x</summary></details>\n\nAfter.\n'],
    ['an image', 'Before. ![a diagram of it](diagram.png) After.\n'],
  ])('leaves out %s', (_, markdown) => {
    expect(proseWords(markdown, 'markdown')).toBe(2)
  })

  it.each([
    [
      'YAML front matter in Markdown',
      'markdown',
      '---\ntitle: Getting started\ntags: [a, b]\n---\n\nOne two.\n',
    ],
    [
      'TOML front matter in Markdown',
      'markdown',
      '+++\ntitle = "Getting started"\n+++\n\nOne two.\n',
    ],
    ['YAML front matter in MDX, braces included', 'mdx', '---\ntitle: {draft}\n---\n\nOne two.\n'],
  ] as const)('leaves out %s', (_, format, text) => {
    expect(proseWords(text, format)).toBe(2)
  })

  it.each([
    ['raw HTML in Markdown', 'markdown', 'one<br>two and <b>three</b>\n'],
    ['a component in MDX', 'mdx', 'one<br />two and <b>three</b>\n'],
  ] as const)('keeps the words on each side of %s apart', (_, format, text) => {
    expect(proseWords(text, format)).toBe(4)
  })

  it('does not count a dash or bullet standing alone as a word', () => {
    expect(proseWords('one — two · three\n', 'markdown')).toBe(3)
  })

  it('counts the same words however the paragraph is wrapped', () => {
    const unwrapped = 'The quick brown fox jumps over the lazy dog and keeps running.\n'
    const wrapped = 'The quick brown fox\njumps over the lazy\ndog and keeps running.\n'

    expect(proseWords(wrapped, 'markdown')).toBe(proseWords(unwrapped, 'markdown'))
  })

  it('counts the text inside MDX components and leaves out imports and expressions', () => {
    const mdx = [
      "import { Note } from './note.tsx'",
      '',
      '# Title',
      '',
      '<Note>Read this first.</Note>',
      '',
      'The total is {1 + 1} here.',
      '',
    ].join('\n')

    expect(proseWords(mdx, 'mdx')).toBe(8)
  })

  it('throws on an MDX document that does not parse', () => {
    expect(() => proseWords('The total is {1 +\n', 'mdx')).toThrow()
  })
})

describe('countDocs', () => {
  it('reads only Markdown and MDX under docs, summing words per subdirectory', async () => {
    const root = await temporaryDirectory('line-count-docs-')
    const write = async (path: string, contents: string): Promise<void> => {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), contents)
    }
    await write('docs/ops/runbook.md', 'One two three.\n')
    await write('docs/ops/deep/notes.mdx', 'Four five.\n')
    await write('docs/layout.md', 'Six.\n')
    const file = (Location: string) => ({ Location, Code: 1, Comment: 0, Complexity: 0 })

    const count = await countDocs(root, [
      {
        Name: 'Markdown',
        Files: [
          file('docs/layout.md'),
          file('docs/ops/runbook.md'),
          file('README.md'),
          file('packages/a/docs/guide.md'),
        ],
      },
      { Name: 'MDX', Files: [file('docs/ops/deep/notes.mdx')] },
      { Name: 'TypeScript', Files: [file('docs/example.ts')] },
      { Name: 'Markdown', Files: null },
    ])

    expect(count).toEqual({
      files: 3,
      words: 6,
      packages: [
        { name: 'ops', files: 2, words: 5 },
        { name: TOP_LEVEL_DOCS, files: 1, words: 1 },
      ],
    })
  })

  it('names the file that does not parse', async () => {
    const root = await temporaryDirectory('line-count-docs-')
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs', 'broken.mdx'), 'The total is {1 +\n')

    await expect(
      countDocs(root, [
        {
          Name: 'MDX',
          Files: [{ Location: 'docs/broken.mdx', Code: 1, Comment: 0, Complexity: 0 }],
        },
      ]),
    ).rejects.toThrow('docs/broken.mdx does not parse as MDX')
  })
})

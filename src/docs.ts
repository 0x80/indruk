import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mdxFromMarkdown } from 'mdast-util-mdx'
import { frontmatter } from 'micromark-extension-frontmatter'
import { gfm } from 'micromark-extension-gfm'
import { mdxjs } from 'micromark-extension-mdxjs'
import type { SccLanguage } from './scc.ts'

/**
 * Prose under the checkout's `docs` directory, measured in words, since a
 * line count of Markdown depends on whether the author wraps paragraphs.
 */
export type DocsCount = {
  files: number
  words: number
  /**
   * One entry per subdirectory of `docs`, plus {@link TOP_LEVEL_DOCS} for the
   * files directly inside it. Sorted by words, largest first.
   */
  packages: { name: string; files: number; words: number }[]
}

/** The directory, relative to the checkout root, whose documents are counted. */
export const DOCS_DIRECTORY = 'docs'

/** Where a document sitting directly in {@link DOCS_DIRECTORY} is counted. */
export const TOP_LEVEL_DOCS = '(top level)'

/**
 * Which grammar a document is parsed with. Both include GitHub's tables,
 * strikethrough and footnotes, and a leading YAML or TOML front matter block.
 */
export type DocumentFormat = 'markdown' | 'mdx'

/** The scc languages whose files are read as documentation, and the grammar each is parsed with. */
const DOCUMENT_LANGUAGES = new Map<string, DocumentFormat>([
  ['Markdown', 'markdown'],
  ['MDX', 'mdx'],
])

/**
 * Nodes whose content a reader does not read as prose: code, images, front
 * matter, and MDX's import, export and expression blocks. Raw HTML is not
 * read either, but keeps the words on each side of it apart.
 */
const SKIPPED_NODES = new Set([
  'yaml',
  'toml',
  'code',
  'image',
  'imageReference',
  'definition',
  'mdxjsEsm',
  'mdxFlowExpression',
  'mdxTextExpression',
])

/** Containers whose children run together as one line of text. */
const PHRASING_CONTAINERS = new Set([
  'paragraph',
  'heading',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
  'tableCell',
  'mdxJsxTextElement',
])

function proseText(node: Nodes): string {
  if (SKIPPED_NODES.has(node.type)) return ''
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'break' || node.type === 'html') return ' '
  if (!('children' in node)) return ''
  const separator = PHRASING_CONTAINERS.has(node.type) ? '' : ' '
  const text = node.children.map((child) => proseText(child)).join(separator)
  /** An inline MDX component, `<br />` included, separates the words around it as raw HTML does. */
  return node.type === 'mdxJsxTextElement' ? ` ${text} ` : text
}

/**
 * The words a reader reads in one document: the text of its headings,
 * paragraphs, lists and tables, inline code and the text inside MDX
 * components included. Front matter, code blocks, raw HTML, images, link
 * targets and MDX code are left out. A word is a run of non-space characters holding at
 * least one letter or digit, so a lone dash or bullet is not one. Throws when
 * an MDX document does not parse.
 */
export function proseWords(text: string, format: DocumentFormat): number {
  const matter: ('yaml' | 'toml')[] = ['yaml', 'toml']
  const tree =
    format === 'mdx'
      ? fromMarkdown(text, {
          extensions: [frontmatter(matter), gfm(), mdxjs()],
          mdastExtensions: [frontmatterFromMarkdown(matter), gfmFromMarkdown(), mdxFromMarkdown()],
        })
      : fromMarkdown(text, {
          extensions: [frontmatter(matter), gfm()],
          mdastExtensions: [frontmatterFromMarkdown(matter), gfmFromMarkdown()],
        })
  return proseText(tree)
    .split(/\s+/u)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length
}

/**
 * Words of prose in every Markdown and MDX file scc found under the
 * checkout's `docs` directory, per subdirectory. Documents elsewhere, such as
 * a package README, are not counted. Files are read one at a time, so a
 * checkout with thousands of documents never holds more than one open.
 * Throws naming the file when one does not parse.
 */
export async function countDocs(
  root: string,
  languages: readonly SccLanguage[],
): Promise<DocsCount> {
  const count: DocsCount = { files: 0, words: 0, packages: [] }
  const packages = new Map<string, DocsCount['packages'][number]>()
  for (const language of languages) {
    const format = DOCUMENT_LANGUAGES.get(language.Name)
    if (format === undefined) continue
    for (const file of language.Files ?? []) {
      const segments = file.Location.split('/')
      if (segments[0] !== DOCS_DIRECTORY || segments.length < 2) continue
      const contents = await readFile(join(root, file.Location), 'utf8')
      let words: number
      try {
        words = proseWords(contents, format)
      } catch (error) {
        throw new Error(
          `${file.Location} does not parse as ${language.Name}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      const name = segments.length > 2 ? (segments[1] ?? TOP_LEVEL_DOCS) : TOP_LEVEL_DOCS
      let entry = packages.get(name)
      if (entry === undefined) {
        entry = { name, files: 0, words: 0 }
        packages.set(name, entry)
      }
      entry.files += 1
      entry.words += words
      count.files += 1
      count.words += words
    }
  }
  count.packages = [...packages.values()].sort((left, right) => right.words - left.words)
  return count
}

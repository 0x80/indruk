import { basename, dirname } from 'node:path'
import process from 'node:process'
import { parseArgs, styleText } from 'node:util'
import { aggregate, selectLanguages } from './count.ts'
import { countDocs } from './docs.ts'
import { GitCommandError, readCommonGitDirectory, runGit } from './git.ts'
import { formatFull, formatJson, formatSummary, type Paint } from './report.ts'
import { runScc } from './scc.ts'
import { workspacePackages } from './workspace.ts'

export type IndrukIo = {
  stdout: (text: string) => void
  stderr: (text: string) => void
  cwd: string
}

const HELP = `Usage: indruk [options]

Lines of code in the current checkout, split into production code and test
code, per workspace package. Test code is test files, test directories,
test helpers (*-test-support, *-test-utils), test runner config and setup,
and every file of a private package that ships a test runner as a
dependency. Counts programming languages only; prose, data and
configuration files are left out unless asked for.

Comments are counted apart from code. Markdown and MDX under docs/ are
measured in words of prose per subdirectory, leaving out front matter, code
blocks, HTML and link targets, since a line count depends on how the author
wraps paragraphs.

Options
  --full                 every package, with test share, comments and complexity
  --json                 the whole count as JSON
  --extensions <list>    only these file extensions, as in ts,tsx; skips the docs count
  --all-languages        also count Markdown, JSON, YAML and other non-code files
  -h, --help             print this message

Requires scc on PATH: https://github.com/boyter/scc#install
`

/**
 * The checkout to count and the name to report it under: the git top level
 * above `cwd`, or `cwd` itself when git answers that it is not inside a
 * repository. Any other git refusal, such as an unsafe directory, throws
 * rather than counting the wrong tree. A linked worktree of an ordinary clone
 * is named after the directory holding its `.git`; a submodule or a worktree
 * of a bare clone, whose common directory is not a `.git`, after its top level.
 */
export async function checkout(cwd: string): Promise<{ root: string; name: string }> {
  /** The C locale keeps git's refusal in the English the check below reads. */
  const environment = { ...process.env, LC_ALL: 'C' }
  let root: string
  try {
    const answer = await runGit(['rev-parse', '--path-format=absolute', '--show-toplevel'], {
      cwd,
      env: environment,
    })
    root = answer.replace(/\r?\n$/u, '')
  } catch (error) {
    if (error instanceof GitCommandError && NOT_A_REPOSITORY.test(error.stderr)) {
      return { root: cwd, name: basename(cwd) }
    }
    throw error
  }
  const commonDirectory = await readCommonGitDirectory(cwd, environment)
  const name =
    basename(commonDirectory) === '.git' ? basename(dirname(commonDirectory)) : basename(root)
  return { root, name }
}

/** Styles by Node's color policy, which `FORCE_COLOR` and `NO_COLOR` override. */
const paint: Paint = (format, text) => styleText(format, text)

/** Git's refusal when `cwd` is in no repository. */
const NOT_A_REPOSITORY = /not a git repository/u

function parseExtensions(value: string): string[] {
  const extensions = value
    .split(',')
    .map((extension) => extension.trim().replace(/^\./u, ''))
    .filter((extension) => extension.length > 0)
  if (extensions.length === 0) throw new Error('--extensions needs at least one extension')
  return extensions
}

/** Runs `indruk` and answers its exit code; a refusal is written to stderr. */
export async function main(argv: readonly string[], io: IndrukIo): Promise<number> {
  try {
    const { values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        full: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        extensions: { type: 'string' },
        'all-languages': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
    if (values.help) {
      io.stdout(HELP)
      return 0
    }
    if (values.full && values.json) throw new Error('--full and --json cannot be combined')

    const { root, name } = await checkout(io.cwd)
    const extensions =
      values.extensions === undefined ? undefined : parseExtensions(values.extensions)
    const [languages, packages] = await Promise.all([
      runScc(root, extensions),
      workspacePackages(root),
    ])
    const count = aggregate(
      selectLanguages(languages, { allLanguages: values['all-languages'], extensions }),
      packages,
    )
    /** Naming extensions asks for those files only, so documentation is not read. */
    const docs = extensions === undefined ? await countDocs(root, languages) : undefined

    io.stdout(
      values.json
        ? formatJson(count, root, docs)
        : values.full
          ? formatFull(count, paint, docs)
          : formatSummary(count, name, paint, docs),
    )
    return 0
  } catch (error) {
    io.stderr(`indruk: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

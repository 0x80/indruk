import { basename, dirname } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import type { CliOutput } from '@emberengineering/cli-output'
import { GitCommandError, runGit } from '@emberengineering/foundation/git'
import { aggregate, selectLanguages } from './count.ts'
import { formatFull, formatJson, formatSummary } from './report.ts'
import { runScc } from './scc.ts'
import { workspacePackageDirectories } from './workspace.ts'

export type LineCountIo = Pick<CliOutput, 'stdout' | 'stderr'> & { cwd: string }

const HELP = `Usage: linecount [options]

Lines of code in the current checkout: the totals, the share in tests, and
code per workspace package. Counts programming languages only; prose, data
and configuration files are left out unless asked for.

Options
  --full                 every package, with test share, comments and complexity
  --json                 the whole count as JSON
  --extensions <list>    only these file extensions, as in ts,tsx
  --all-languages        also count Markdown, JSON, YAML and other non-code files
  -h, --help             print this message

Requires scc on PATH (brew install scc).
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
  let output: string
  try {
    output = await runGit(
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
      /** The C locale keeps git's refusal in the English the check below reads. */
      { cwd, env: { ...process.env, LC_ALL: 'C' } },
    )
  } catch (error) {
    if (error instanceof GitCommandError && NOT_A_REPOSITORY.test(error.stderr)) {
      return { root: cwd, name: basename(cwd) }
    }
    throw error
  }
  const [root, commonDirectory] = output.trim().split('\n')
  if (root === undefined || commonDirectory === undefined) {
    throw new Error('git rev-parse answered without a top level and a common directory')
  }
  const name =
    basename(commonDirectory) === '.git' ? basename(dirname(commonDirectory)) : basename(root)
  return { root, name }
}

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

/** Runs `linecount` and answers its exit code; a refusal is written to stderr. */
export async function main(argv: readonly string[], io: LineCountIo): Promise<number> {
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
    const [languages, packageDirectories] = await Promise.all([
      runScc(root, extensions),
      workspacePackageDirectories(root),
    ])
    const count = aggregate(
      selectLanguages(languages, { allLanguages: values['all-languages'], extensions }),
      packageDirectories,
    )

    io.stdout(
      values.json
        ? formatJson(count, root)
        : values.full
          ? formatFull(count)
          : formatSummary(count, name),
    )
    return 0
  } catch (error) {
    io.stderr(`linecount: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

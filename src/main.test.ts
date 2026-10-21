import { execFileSync } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { CHILD_PROCESS_BUDGET_MILLISECONDS } from '@emberengineering/config-vitest/spawn-budgets'
import { temporaryDirectory } from '@emberengineering/config-vitest/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkout, main } from './main.ts'

vi.setConfig({
  testTimeout: CHILD_PROCESS_BUDGET_MILLISECONDS,
  hookTimeout: CHILD_PROCESS_BUDGET_MILLISECONDS,
})

/** `createUnitConfig` does not unstub, so an env stub would outlive its test. */
afterEach(() => {
  vi.unstubAllEnvs()
})

/** Runs git as a fixed author, so a commit needs no configured identity. */
function git(args: readonly string[]): void {
  execFileSync('git', args, {
    timeout: CHILD_PROCESS_BUDGET_MILLISECONDS,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'a',
      GIT_AUTHOR_EMAIL: 'a@b',
      GIT_COMMITTER_NAME: 'a',
      GIT_COMMITTER_EMAIL: 'a@b',
    },
  })
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const code = await main(argv, {
    stdout: (chunk) => {
      out += chunk
    },
    stderr: (chunk) => {
      err += chunk
    },
    cwd: import.meta.dirname,
  })
  return { code, out, err }
}

describe('main', () => {
  it('prints the help on stdout', async () => {
    const result = await run(['--help'])

    expect(result.code).toBe(0)
    expect(result.out).toMatch(/^Usage: linecount \[options\]/u)
  })

  it.each([
    [['--full', '--json'], 'linecount: --full and --json cannot be combined\n'],
    [['--extensions', ' , '], 'linecount: --extensions needs at least one extension\n'],
    [
      ['src'],
      "linecount: Unexpected argument 'src'. This command does not take positional arguments\n",
    ],
  ])('refuses %j before counting anything', async (argv, message) => {
    const result = await run(argv)

    expect(result).toEqual({ code: 1, out: '', err: message })
  })
})

describe('checkout', () => {
  it('names a linked worktree after its repository and counts from its top level', async () => {
    const directory = await temporaryDirectory('line-count-main-', { realPath: true })
    const repository = join(directory, 'demo')
    git(['init', '-q', repository])
    git(['-C', repository, 'commit', '-q', '--allow-empty', '-m', 'start'])
    const worktree = join(directory, 'feature')
    git(['-C', repository, 'worktree', 'add', '-q', worktree])
    await mkdir(join(worktree, 'src'))

    expect(await checkout(join(worktree, 'src'))).toEqual({ root: worktree, name: 'demo' })
  })

  it('names a worktree of a bare clone after its own top level', async () => {
    const directory = await temporaryDirectory('line-count-main-', { realPath: true })
    const source = join(directory, 'source')
    git(['init', '-q', source])
    git(['-C', source, 'commit', '-q', '--allow-empty', '-m', 'start'])
    const bare = join(directory, 'demo.git')
    git(['clone', '-q', '--bare', source, bare])
    const worktree = join(directory, 'feature')
    git(['-C', bare, 'worktree', 'add', '-q', worktree])

    expect(await checkout(worktree)).toEqual({ root: worktree, name: 'feature' })
  })

  it('counts the directory itself outside any repository', async () => {
    const directory = await temporaryDirectory('line-count-main-', { realPath: true })
    vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(directory))

    expect(await checkout(directory)).toEqual({ root: directory, name: basename(directory) })
  })

  it('refuses a repository git will not read rather than counting the subdirectory', async () => {
    const directory = await temporaryDirectory('line-count-main-', { realPath: true })
    git(['init', '-q', directory])
    git(['-C', directory, 'config', 'core.repositoryformatversion', '99'])
    await mkdir(join(directory, 'src'))

    await expect(checkout(join(directory, 'src'))).rejects.toThrow('Expected git repo version')
  })
})

/**
 * A repository whose scc on PATH reports one TypeScript file, a README and
 * one runbook under docs/ops, with the Markdown files written to disk.
 */
async function fakeCheckout(
  extraFiles: readonly { Location: string; Code: number }[] = [],
): Promise<string> {
  const directory = await temporaryDirectory('line-count-main-', { realPath: true })
  const repository = join(directory, 'demo')
  git(['init', '-q', repository])
  const bin = join(directory, 'bin')
  await mkdir(bin)
  const sccOutput = JSON.stringify([
    {
      Name: 'TypeScript',
      Files: [
        { Location: 'src/a.ts', Code: 70, Comment: 5, Complexity: 3 },
        ...extraFiles.map((extra) => ({ ...extra, Comment: 0, Complexity: 0 })),
      ],
    },
    {
      Name: 'Markdown',
      Files: [
        { Location: 'README.md', Code: 30, Comment: 0, Complexity: 0 },
        { Location: 'docs/ops/runbook.md', Code: 3, Comment: 0, Complexity: 0 },
      ],
    },
  ])
  await writeFile(join(bin, 'scc'), `#!/bin/sh\nprintf '%s' '${sccOutput}'\n`)
  await chmod(join(bin, 'scc'), 0o755)
  await writeFile(join(repository, 'README.md'), 'Not counted.\n')
  await mkdir(join(repository, 'docs', 'ops'), { recursive: true })
  await writeFile(
    join(repository, 'docs', 'ops', 'runbook.md'),
    'Read me first.\n\n```sh\nls -la\n```\n',
  )
  vi.stubEnv('PATH', `${bin}:${process.env['PATH'] ?? ''}`)
  return repository
}

async function runIn(
  repository: string,
  argv: readonly string[],
): Promise<{ code: number; out: string }> {
  let out = ''
  const code = await main(argv, {
    stdout: (chunk) => {
      out += chunk
    },
    stderr: () => {},
    cwd: repository,
  })
  return { code, out }
}

describe('main counting a checkout', () => {
  it('counts only programming languages as code, and Markdown under docs as words', async () => {
    const { code, out } = await runIn(await fakeCheckout(), [])

    expect(code).toBe(0)
    const lines = out.split('\n')
    expect(lines[0]).toBe('demo: 70 lines of code in 1 file')
    expect(lines[6]).toBe('docs      3 words in 1 document under docs/, about 1 minute of reading')
    expect(lines.slice(-4)).toEqual([
      '',
      'docs/  words  share  files',
      'ops        3   100%      1',
      '',
    ])
  })

  it('prints the production, test and docs counts as JSON', async () => {
    const repository = await fakeCheckout()

    const { code, out } = await runIn(repository, ['--json'])

    expect(code).toBe(0)
    const parsed: unknown = JSON.parse(out)
    expect(parsed).toMatchObject({
      root: repository,
      grand: {
        files: 1,
        code: 70,
        production: { files: 1, code: 70, comment: 5, complexity: 3 },
        tests: { files: 0, code: 0, comment: 0, complexity: 0 },
      },
      docs: { files: 1, words: 3, packages: [{ name: 'ops', files: 1, words: 3 }] },
    })
  })

  it('counts every file of a private package that ships a test runner as test code', async () => {
    const repository = await fakeCheckout([{ Location: 'packages/harness/src/home.ts', Code: 50 }])
    await writeFile(join(repository, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    await mkdir(join(repository, 'packages', 'harness'), { recursive: true })
    await writeFile(
      join(repository, 'packages', 'harness', 'package.json'),
      JSON.stringify({ private: true, dependencies: { vitest: '4.0.0' } }),
    )

    const { code, out } = await runIn(repository, ['--json'])

    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({
      grand: { code: 120, production: { code: 70 }, tests: { code: 50 } },
    })
  })

  it('reads no docs when extensions are named', async () => {
    const repository = await fakeCheckout()

    const json = await runIn(repository, ['--json', '--extensions', 'ts'])
    const summary = await runIn(repository, ['--extensions', 'ts'])

    const parsed: unknown = JSON.parse(json.out)
    expect(parsed).toMatchObject({ root: repository })
    expect(parsed).not.toHaveProperty('docs')
    expect(summary.out).not.toMatch(/ words in \d+ documents? under docs\//u)
  })
})

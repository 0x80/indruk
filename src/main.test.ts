import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { CHILD_PROCESS_BUDGET_MILLISECONDS } from '@emberengineering/config-vitest/spawn-budgets'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
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

async function temporaryDirectory(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'line-count-main-')))
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  return directory
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
    const directory = await temporaryDirectory()
    const repository = join(directory, 'demo')
    git(['init', '-q', repository])
    git(['-C', repository, 'commit', '-q', '--allow-empty', '-m', 'start'])
    const worktree = join(directory, 'feature')
    git(['-C', repository, 'worktree', 'add', '-q', worktree])
    await mkdir(join(worktree, 'src'))

    expect(await checkout(join(worktree, 'src'))).toEqual({ root: worktree, name: 'demo' })
  })

  it('names a worktree of a bare clone after its own top level', async () => {
    const directory = await temporaryDirectory()
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
    const directory = await temporaryDirectory()
    vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(directory))

    expect(await checkout(directory)).toEqual({ root: directory, name: basename(directory) })
  })

  it('refuses a repository git will not read rather than counting the subdirectory', async () => {
    const directory = await temporaryDirectory()
    git(['init', '-q', directory])
    git(['-C', directory, 'config', 'core.repositoryformatversion', '99'])
    await mkdir(join(directory, 'src'))

    await expect(checkout(join(directory, 'src'))).rejects.toThrow('Expected git repo version')
  })
})

describe('main counting a checkout', () => {
  it('reports only the programming languages scc found, by default', async () => {
    const directory = await temporaryDirectory()
    const repository = join(directory, 'demo')
    git(['init', '-q', repository])
    const bin = join(directory, 'bin')
    await mkdir(bin)
    const sccOutput = JSON.stringify([
      {
        Name: 'TypeScript',
        Files: [{ Location: 'src/a.ts', Code: 70, Comment: 5, Complexity: 3 }],
      },
      { Name: 'Markdown', Files: [{ Location: 'README.md', Code: 30, Comment: 0, Complexity: 0 }] },
    ])
    await writeFile(join(bin, 'scc'), `#!/bin/sh\nprintf '%s' '${sccOutput}'\n`)
    await chmod(join(bin, 'scc'), 0o755)
    vi.stubEnv('PATH', `${bin}:${process.env['PATH'] ?? ''}`)

    let out = ''
    const code = await main([], {
      stdout: (chunk) => {
        out += chunk
      },
      stderr: () => {},
      cwd: repository,
    })

    expect(code).toBe(0)
    expect(out.split('\n')[0]).toBe('demo: 70 lines of code in 1 files')
  })
})

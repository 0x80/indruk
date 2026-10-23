import { runProcess } from './process.ts'

/** Git ran and refused; `stderr` holds its reason. */
export class GitCommandError extends Error {
  readonly stderr: string

  constructor(arguments_: readonly string[], status: number | null, stderr: string) {
    super(`git ${arguments_.join(' ')} exited with ${status}: ${stderr.trim()}`)
    this.stderr = stderr
  }
}

/** Git's stdout for `arguments_` run in `cwd`; throws {@link GitCommandError} on a nonzero exit. */
export async function runGit(
  arguments_: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const result = await runProcess('git', arguments_, options)
  if (result.status !== 0) throw new GitCommandError(arguments_, result.status, result.stderr)
  return result.stdout
}

/** The absolute path of the repository's common git directory, shared by its worktrees. */
export async function readCommonGitDirectory(
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const answer = await runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    env: environment,
  })
  const directory = answer.replace(/\r?\n$/u, '')
  if (directory === '') throw new Error('Git returned no common directory')
  return directory
}

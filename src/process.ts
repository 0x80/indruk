import { spawn } from 'node:child_process'

export type ProcessResult = {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** Stdout passed `outputLimit`; the child was killed and `stdout` holds only the start. */
  stdoutTruncated: boolean
}

/** The program could not start, such as `ENOENT` when it is not on PATH. */
export class ProcessLaunchError extends Error {
  readonly code: string | undefined

  constructor(command: string, cause: NodeJS.ErrnoException) {
    super(`${command} could not start: ${cause.message}`, { cause })
    this.code = cause.code
  }
}

/**
 * Runs `command` to its end and answers what it printed. Stdout past
 * `outputLimit` bytes kills the child rather than holding an unbounded answer.
 */
export async function runProcess(
  command: string,
  arguments_: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; outputLimit?: number },
): Promise<ProcessResult> {
  const limit = options.outputLimit ?? Number.POSITIVE_INFINITY
  return await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stdoutTruncated = false
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return
      stdoutBytes += chunk.length
      if (stdoutBytes > limit) {
        stdoutTruncated = true
        child.kill()
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(new ProcessLaunchError(command, error))
    })
    child.on('close', (status, signal) => {
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdoutTruncated,
      })
    })
  })
}

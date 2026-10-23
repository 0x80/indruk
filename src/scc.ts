import { z } from 'zod'
import { ProcessLaunchError, runProcess } from './process.ts'

/**
 * The part of `scc --by-file --format=json` the count reads. scc emits
 * `"Files": null` for a language that matched no file under `-i`.
 */
const sccLanguagesSchema = z.array(
  z.object({
    Name: z.string(),
    Files: z
      .array(
        z.object({
          Location: z.string(),
          Code: z.number(),
          Comment: z.number(),
          Complexity: z.number(),
        }),
      )
      .nullable(),
  }),
)

export type SccLanguage = z.infer<typeof sccLanguagesSchema>[number]

export type SccFile = NonNullable<SccLanguage['Files']>[number]

/** scc's JSON for a large monorepo runs to tens of megabytes. */
const OUTPUT_LIMIT = 256 * 1024 * 1024

/**
 * scc's per-file counts for every file under `root` that `.gitignore` keeps,
 * limited to `extensions` when given. Throws with an install hint when scc is
 * not on PATH, and on any run that did not end cleanly with a whole answer.
 */
export async function runScc(
  root: string,
  extensions: readonly string[] | undefined,
): Promise<SccLanguage[]> {
  const sccArguments = ['--by-file', '--format=json']
  if (extensions !== undefined) sccArguments.push('--include-ext', extensions.join(','))
  let result
  try {
    result = await runProcess('scc', [...sccArguments, '.'], {
      cwd: root,
      outputLimit: OUTPUT_LIMIT,
    })
  } catch (error) {
    if (error instanceof ProcessLaunchError && error.code === 'ENOENT') {
      throw new Error('scc is not installed. Install it from https://github.com/boyter/scc#install, as in: brew install scc', { cause: error })
    }
    throw error
  }
  if (result.status !== 0 || result.stdoutTruncated) {
    const reason = result.stdoutTruncated
      ? `printed more than ${OUTPUT_LIMIT / 1024 / 1024} MB; run it inside a checkout`
      : `exited with ${result.status ?? result.signal}`
    throw new Error(`scc ${reason}: ${result.stderr.trim()}`)
  }
  return sccLanguagesSchema.parse(JSON.parse(result.stdout))
}

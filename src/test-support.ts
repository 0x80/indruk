import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'

/** The ceiling for a test that spawns `git` or `scc`. */
export const CHILD_PROCESS_BUDGET_MILLISECONDS = 30_000

/**
 * A fresh directory under the system temporary directory, removed when the
 * test finishes. `realPath` resolves a symlinked temporary root such as
 * macOS's `/var`, for a test comparing against a path git prints.
 */
export async function temporaryDirectory(
  prefix: string,
  options: { realPath?: boolean } = {},
): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(async () => {
    await rm(created, { recursive: true, force: true })
  })
  return options.realPath === true ? await realpath(created) : created
}

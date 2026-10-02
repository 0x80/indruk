import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const packageRoot = resolve(import.meta.dirname, '..')
const providedRevision = process.env.GIT_REVISION?.trim()
if (providedRevision !== undefined && !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(providedRevision)) {
  throw new Error('GIT_REVISION must be a 40- or 64-character hexadecimal commit ID')
}
const repositoryRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim()
const normalizedRevision = providedRevision?.toLowerCase()
if (normalizedRevision !== undefined && normalizedRevision !== repositoryRevision.toLowerCase()) {
  throw new Error('GIT_REVISION does not match the repository HEAD')
}
const commit = normalizedRevision ?? repositoryRevision
const lockfileSha256 = createHash('sha256')
  .update(readFileSync(join(repositoryRoot, 'pnpm-lock.yaml')))
  .digest('hex')

writeFileSync(
  join(packageRoot, 'dist', '.agent-tooling-build.json'),
  `${JSON.stringify({ commit, lockfileSha256 })}\n`,
)

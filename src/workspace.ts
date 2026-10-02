import { access, glob, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { isMissingPath, isRecord } from '@emberengineering/foundation'
import { parse } from 'yaml'

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingPath(error)) return undefined
    throw error
  }
}

function stringList(value: unknown, source: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${source} does not hold a list of package globs`)
  }
  return value
}

/**
 * The checkout's workspace globs: `packages` in `pnpm-workspace.yaml`, else
 * `workspaces` in the root `package.json`, in either of its two shapes. A
 * checkout with neither has none; a file that is present but unreadable throws.
 */
async function workspaceGlobs(root: string): Promise<string[]> {
  const pnpmWorkspace = await readOptional(join(root, 'pnpm-workspace.yaml'))
  if (pnpmWorkspace !== undefined) {
    const document: unknown = parse(pnpmWorkspace)
    if (!isRecord(document) || document['packages'] === undefined) return []
    return stringList(document['packages'], 'pnpm-workspace.yaml packages')
  }
  const manifest = await readOptional(join(root, 'package.json'))
  if (manifest === undefined) return []
  const parsed: unknown = JSON.parse(manifest)
  if (!isRecord(parsed) || parsed['workspaces'] === undefined) return []
  const workspaces = parsed['workspaces']
  if (isRecord(workspaces)) return stringList(workspaces['packages'], 'package.json workspaces')
  return stringList(workspaces, 'package.json workspaces')
}

async function holdsManifest(directory: string): Promise<boolean> {
  try {
    await access(join(directory, 'package.json'))
    return true
  } catch (error) {
    if (isMissingPath(error)) return false
    throw error
  }
}

/**
 * Every workspace package directory under `root`, relative to it, deepest
 * first so the first prefix a path matches is its own package. The root
 * package is left out: every file would otherwise belong to it.
 */
export async function workspacePackageDirectories(root: string): Promise<string[]> {
  const patterns = await workspaceGlobs(root)
  const excluded = new Set<string>()
  const included = new Set<string>()
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!')
    const target = negated ? excluded : included
    for await (const match of glob(negated ? pattern.slice(1) : pattern, {
      cwd: root,
      withFileTypes: true,
    })) {
      if (match.isDirectory()) target.add(relative(root, join(match.parentPath, match.name)))
    }
  }
  const directories: string[] = []
  for (const directory of included) {
    if (directory === '' || directory === '.' || excluded.has(directory)) continue
    if (await holdsManifest(join(root, directory))) directories.push(directory)
  }
  return directories.sort(
    (left, right) => right.split('/').length - left.split('/').length || left.localeCompare(right),
  )
}

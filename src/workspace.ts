import { glob, readFile } from 'node:fs/promises'
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

export type WorkspacePackage = {
  /** Relative to the checkout root. */
  directory: string
  /**
   * Whether the package is shared setup for the checkout's own test suites:
   * a private package that ships a test runner among its dependencies, such
   * as a vitest config factory or an integration-test harness. Every file in
   * it is test code.
   */
  testSupport: boolean
}

/** Test runners whose presence in a private package's dependencies marks it as test setup. */
const TEST_RUNNERS = ['vitest', 'jest', 'mocha', '@playwright/test']

function isTestSupportManifest(manifest: Record<string, unknown>): boolean {
  if (manifest['private'] !== true) return false
  return ['dependencies', 'peerDependencies'].some((field) => {
    const dependencies = manifest[field]
    return (
      isRecord(dependencies) && TEST_RUNNERS.some((runner) => Object.hasOwn(dependencies, runner))
    )
  })
}

/** The package manifest in `directory`, or undefined when it holds none. */
async function readManifest(directory: string): Promise<Record<string, unknown> | undefined> {
  const path = join(directory, 'package.json')
  const contents = await readOptional(path)
  if (contents === undefined) return undefined
  let manifest: unknown
  try {
    /** A leading byte order mark is legal in a manifest npm and pnpm read, and JSON.parse refuses it. */
    manifest = JSON.parse(contents.replace(/^\uFEFF/u, ''))
  } catch (error) {
    throw new Error(`${path} is not valid JSON`, { cause: error })
  }
  if (!isRecord(manifest)) throw new Error(`${path} does not hold a JSON object`)
  return manifest
}

/**
 * Every workspace package under `root`, deepest first so the first prefix a
 * path matches is its own package. The root package is left out: every file
 * would otherwise belong to it.
 */
export async function workspacePackages(root: string): Promise<WorkspacePackage[]> {
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
  const packages: WorkspacePackage[] = []
  for (const directory of included) {
    if (directory === '' || directory === '.' || excluded.has(directory)) continue
    const manifest = await readManifest(join(root, directory))
    if (manifest !== undefined) {
      packages.push({ directory, testSupport: isTestSupportManifest(manifest) })
    }
  }
  return packages.sort(
    (left, right) =>
      right.directory.split('/').length - left.directory.split('/').length ||
      left.directory.localeCompare(right.directory),
  )
}

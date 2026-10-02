import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { workspacePackageDirectories } from './workspace.ts'

/** A checkout owned by the calling test, removed when that test finishes. */
async function checkout(): Promise<{
  root: string
  write: (path: string, contents?: string) => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'line-count-workspace-'))
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true })
  })
  return {
    root,
    write: async (path, contents = '{}') => {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), contents)
    },
  }
}

describe('workspacePackageDirectories', () => {
  it('expands the pnpm globs to directories holding a manifest, deepest first', async () => {
    const { root, write } = await checkout()
    await write(
      'pnpm-workspace.yaml',
      "packages:\n  - 'apps/*'\n  - 'packages/*/*'\n  - scripts\n  - '!apps/retired'\n",
    )
    await write('apps/web/package.json')
    await write('apps/retired/package.json')
    await write('apps/notes/README.md')
    await write('apps/tsconfig.tsbuildinfo', '')
    await write('packages/server/db/package.json')
    await write('scripts/package.json')

    expect(await workspacePackageDirectories(root)).toEqual([
      'packages/server/db',
      'apps/web',
      'scripts',
    ])
  })

  it('reads package.json workspaces in its object shape when there is no pnpm file', async () => {
    const { root, write } = await checkout()
    await write('package.json', JSON.stringify({ workspaces: { packages: ['libs/*'] } }))
    await write('libs/core/package.json')

    expect(await workspacePackageDirectories(root)).toEqual(['libs/core'])
  })

  it('answers no packages for a checkout that declares no workspace', async () => {
    const { root, write } = await checkout()
    await write('package.json', JSON.stringify({ name: 'single' }))

    expect(await workspacePackageDirectories(root)).toEqual([])
  })

  it('refuses a workspace file whose packages are not a list of globs', async () => {
    const { root, write } = await checkout()
    await write('pnpm-workspace.yaml', 'packages: apps/*\n')

    await expect(workspacePackageDirectories(root)).rejects.toThrow(
      'pnpm-workspace.yaml packages does not hold a list of package globs',
    )
  })
})

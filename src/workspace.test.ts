import { mkdir, writeFile } from 'node:fs/promises'
import { temporaryDirectory } from '@emberengineering/config-vitest/temporary-directory'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { workspacePackages } from './workspace.ts'

/** A checkout owned by the calling test, removed when that test finishes. */
async function checkout(): Promise<{
  root: string
  write: (path: string, contents?: string) => Promise<void>
}> {
  const root = await temporaryDirectory('line-count-workspace-')
  return {
    root,
    write: async (path, contents = '{}') => {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), contents)
    },
  }
}

const directories = (packages: readonly { directory: string }[]) =>
  packages.map((entry) => entry.directory)

describe('workspacePackages', () => {
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

    expect(directories(await workspacePackages(root))).toEqual([
      'packages/server/db',
      'apps/web',
      'scripts',
    ])
  })

  it('reads package.json workspaces in its object shape when there is no pnpm file', async () => {
    const { root, write } = await checkout()
    await write('package.json', JSON.stringify({ workspaces: { packages: ['libs/*'] } }))
    await write('libs/core/package.json')

    expect(directories(await workspacePackages(root))).toEqual(['libs/core'])
  })

  it('answers no packages for a checkout that declares no workspace', async () => {
    const { root, write } = await checkout()
    await write('package.json', JSON.stringify({ name: 'single' }))

    expect(await workspacePackages(root)).toEqual([])
  })

  it('refuses a workspace file whose packages are not a list of globs', async () => {
    const { root, write } = await checkout()
    await write('pnpm-workspace.yaml', 'packages: apps/*\n')

    await expect(workspacePackages(root)).rejects.toThrow(
      'pnpm-workspace.yaml packages does not hold a list of package globs',
    )
  })

  it('marks a private package shipping a test runner as test support, and nothing else', async () => {
    const { root, write } = await checkout()
    await write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    const manifest = (fields: Record<string, unknown>) => JSON.stringify(fields)
    await write(
      'packages/config-vitest/package.json',
      manifest({ private: true, dependencies: { vitest: '4.0.0' } }),
    )
    await write(
      'packages/e2e-harness/package.json',
      manifest({ private: true, peerDependencies: { '@playwright/test': '1.0.0' } }),
    )
    await write(
      'packages/app/package.json',
      manifest({ private: true, devDependencies: { vitest: '4.0.0' } }),
    )
    await write(
      'packages/vitest-plugin/package.json',
      manifest({ dependencies: { vitest: '4.0.0' } }),
    )

    expect(await workspacePackages(root)).toEqual([
      { directory: 'packages/app', testSupport: false },
      { directory: 'packages/config-vitest', testSupport: true },
      { directory: 'packages/e2e-harness', testSupport: true },
      { directory: 'packages/vitest-plugin', testSupport: false },
    ])
  })

  it('reads a manifest that starts with a byte order mark', async () => {
    const { root, write } = await checkout()
    await write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    await write(
      'packages/harness/package.json',
      `\uFEFF${JSON.stringify({ private: true, dependencies: { vitest: '4.0.0' } })}`,
    )

    expect(await workspacePackages(root)).toEqual([
      { directory: 'packages/harness', testSupport: true },
    ])
  })

  it('names the manifest that is not valid JSON', async () => {
    const { root, write } = await checkout()
    await write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    await write('packages/app/package.json', '{ "name": ')

    await expect(workspacePackages(root)).rejects.toThrow(
      `${join(root, 'packages/app/package.json')} is not valid JSON`,
    )
  })

  it('refuses a package manifest that is not a JSON object', async () => {
    const { root, write } = await checkout()
    await write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    await write('packages/app/package.json', '[]')

    await expect(workspacePackages(root)).rejects.toThrow(
      `${join(root, 'packages/app/package.json')} does not hold a JSON object`,
    )
  })
})

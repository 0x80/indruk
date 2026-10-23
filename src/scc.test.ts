import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScc } from './scc.ts'
import { temporaryDirectory } from './test-support.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runScc', () => {
  it('names where to get scc when it is not on PATH', async () => {
    const directory = await temporaryDirectory('indruk-scc-')
    vi.stubEnv('PATH', directory)
    await expect(runScc(directory, undefined)).rejects.toThrow(
      'scc is not installed. Install it from https://github.com/boyter/scc#install',
    )
  })
})

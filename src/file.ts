import { readFile } from 'node:fs/promises'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The file's text, or `undefined` when nothing is at `path`; any other failure throws. */
export async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ENOENT') return undefined
    throw error
  }
}

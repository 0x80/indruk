#!/usr/bin/env node
import process from 'node:process'
import { createCliOutput, exitAfterOutput } from '@emberengineering/cli-output'
import { main } from './main.ts'

const output = createCliOutput('linecount')
await exitAfterOutput(output, await main(process.argv.slice(2), { ...output, cwd: process.cwd() }))

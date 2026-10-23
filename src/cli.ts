#!/usr/bin/env node
import process from 'node:process'
import { main } from './main.ts'

process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
})

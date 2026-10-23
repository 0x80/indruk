# indruk

Lines of code in any checkout, split into production code and test code per
workspace package, with comments, complexity and a word count of the docs.

```sh
npx indruk
```

or install it once with `npm i -g indruk`.

## Requirements

- Node 24 or later.
- [scc](https://github.com/boyter/scc#install) on PATH, which does the
  counting: `brew install scc` on macOS. Without it, indruk stops and says
  where to get it.

## What it counts

indruk runs from anywhere inside a git checkout and counts the whole checkout,
skipping what `.gitignore` leaves out. Outside a repository it counts the
current directory.

- **Packages.** It reads the workspace globs from `pnpm-workspace.yaml`, or from
  `workspaces` in the root `package.json`, and reports each package apart.
- **Test code.** Test files, test directories, test helpers
  (`*-test-support`, `*-test-utils`), test runner config and setup, and every
  file of a private package that lists a test runner as a dependency.
- **Comments** are counted apart from code.
- **Docs.** Markdown and MDX under `docs/` are counted in words of prose per
  subdirectory, leaving out front matter, code blocks, HTML and link targets.

Only programming languages count by default.

## Options

| Option                | What it does                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `--full`              | every package, with test share, comments and complexity           |
| `--json`              | the whole count as JSON                                           |
| `--extensions <list>` | only these file extensions, as in `ts,tsx`; skips the docs count |
| `--all-languages`     | also count Markdown, JSON, YAML and other non-code files          |
| `-h`, `--help`        | print the help                                                    |

## Releasing

Run the **Publish** workflow from the Actions tab on `main`. Pick a bump, or
type an exact version. The workflow runs the checks, bumps the version,
publishes to npm, pushes the version commit and tag, and creates a GitHub
release. A prerelease version publishes under the `next` dist-tag. Set
`dry_run` to stop before anything is published or pushed.

It publishes through npm trusted publishing, so no npm token is stored in the
repository.

## License

MIT

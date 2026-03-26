import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { OutputFormat } from '../core/check-options.js'
import { resetProjectCache } from '../core/project.js'
import { resolveConfig } from './resolve-config.js'
import { runCheck } from './commands/check.js'
import { runBaseline } from './commands/baseline.js'
import { watchAndRerun } from './watch.js'

function getVersion(): string {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }
  return pkg.version
}

const HELP_TEXT = `
ts-archunit — Architecture testing for TypeScript

Usage:
  ts-archunit check [files...]          Run architecture rules
  ts-archunit baseline [files...]       Generate baseline file

Options:
  --baseline <path>     Baseline file for filtering known violations
  --output <path>       Output path for baseline file (default: arch-baseline.json)
  --changed             Only report violations in changed files (git diff)
  --base <branch>       Base branch for diff (default: main)
  --format <format>     Output format: terminal, json, github, auto (default: auto)
  -w, --watch           Watch for changes and re-run (check command only)
  --config <path>       Path to config file
  -v, --version         Show version number
  -h, --help            Show this help message
`

interface ParsedArgs {
  values: {
    baseline?: string
    output?: string
    changed?: boolean
    base?: string
    format?: string
    config?: string
    help?: boolean
    version?: boolean
    watch?: boolean
  }
  positionals: string[]
}

export function parseCliArgs(args: string[]): ParsedArgs {
  return parseArgs({
    args,
    options: {
      baseline: { type: 'string' },
      output: { type: 'string' },
      changed: { type: 'boolean', default: false },
      base: { type: 'string', default: 'main' },
      format: { type: 'string' },
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      watch: { type: 'boolean', short: 'w', default: false },
    },
    allowPositionals: true,
    strict: true,
  })
}

export async function run(args: string[]): Promise<void> {
  const parsed = parseCliArgs(args)
  const { values, positionals } = parsed

  if (values.version === true) {
    process.stdout.write(getVersion() + '\n')
    return
  }

  if (values.help === true) {
    process.stdout.write(HELP_TEXT + '\n')
    return
  }

  const command = positionals[0]

  if (command === undefined) {
    console.error('Error: No command specified. Use --help for usage.')
    process.exitCode = 1
    return
  }

  // --watch is only supported with check
  if (values.watch === true && command !== 'check') {
    console.error('Error: --watch is only supported with the check command.')
    process.exitCode = 1
    return
  }

  // Load config file (if any)
  const config = await resolveConfig(values.config)

  // Merge: CLI flags > config file > defaults
  const ruleFiles = positionals.slice(1).length > 0 ? positionals.slice(1) : (config.rules ?? [])
  const format = (values.format ?? config.format ?? 'auto') as OutputFormat | 'auto'
  const baseline = values.baseline ?? config.baseline
  const base = values.base ?? 'main'
  const changed = values.changed ?? false

  if (command === 'check') {
    if (ruleFiles.length === 0) {
      console.error(
        'Error: No rule files specified. Pass rule files as arguments or set them in config.',
      )
      process.exitCode = 1
      return
    }

    if (values.watch === true) {
      const watchDirs = config.watchDirs ?? ['src']
      const checkArgs = { ruleFiles, baseline, changed, base, format, fresh: true }

      // Initial run
      process.stdout.write('ts-archunit — watching for changes\n\n')
      resetProjectCache()
      await runCheck(checkArgs).catch(() => {
        // Initial violations are printed by runCheck — don't exit
      })
      process.stdout.write('\nWatching for changes...\n')

      // Watch and re-run (non-blocking — watchers run in background)
      watchAndRerun({
        watchDirs,
        watchFiles: ruleFiles,
        onChangeDetected: async () => {
          resetProjectCache()
          await runCheck(checkArgs)
        },
      })
    } else {
      const failures = await runCheck({
        ruleFiles,
        baseline,
        changed,
        base,
        format,
      })

      if (failures > 0) {
        process.exitCode = 1
      }
    }
  } else if (command === 'baseline') {
    if (ruleFiles.length === 0) {
      console.error(
        'Error: No rule files specified. Pass rule files as arguments or set them in config.',
      )
      process.exitCode = 1
      return
    }

    const output = values.output ?? 'arch-baseline.json'
    await runBaseline({ ruleFiles, output })
  } else {
    console.error(`Error: Unknown command "${command}". Use --help for usage.`)
    process.exitCode = 1
  }
}

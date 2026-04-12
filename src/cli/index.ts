import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { OutputFormat } from '../core/check-options.js'
import { resetProjectCache } from '../core/project.js'
import { resolveConfig } from './resolve-config.js'
import { runCheck } from './commands/check.js'
import { runBaseline } from './commands/baseline.js'
import { runExplain } from './commands/explain.js'
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
  ts-archunit explain [files...]        Dump all active rules as JSON

Options:
  --baseline <path>     Baseline file for filtering known violations
  --output <path>       Output path for baseline file (default: arch-baseline.json)
  --changed             Only report violations in changed files (git diff)
  --base <branch>       Base branch for diff (default: main)
  --format <format>     Output format: terminal, json, github, auto (default: auto)
  --markdown            Output explain results as markdown table
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
    markdown?: boolean
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
      markdown: { type: 'boolean', default: false },
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

/** Require rule files to be specified, printing an error and setting exit code if missing. */
function requireRuleFiles(ruleFiles: string[]): boolean {
  if (ruleFiles.length > 0) return true
  console.error(
    'Error: No rule files specified. Pass rule files as arguments or set them in config.',
  )
  process.exitCode = 1
  return false
}

/** Handle the `check` subcommand. */
async function handleCheck(
  ruleFiles: string[],
  values: ParsedArgs['values'],
  config: Awaited<ReturnType<typeof resolveConfig>>,
  format: OutputFormat | 'auto',
  baseline: string | undefined,
  changed: boolean,
  base: string,
): Promise<void> {
  if (!requireRuleFiles(ruleFiles)) return

  if (values.watch === true) {
    const watchDirs = config.watchDirs ?? ['src']
    const checkArgs = { ruleFiles, baseline, changed, base, format, fresh: true }

    process.stdout.write('ts-archunit — watching for changes\n\n')
    resetProjectCache()
    await runCheck(checkArgs).catch(() => {
      // Initial violations are printed by runCheck — don't exit
    })
    process.stdout.write('\nWatching for changes...\n')

    watchAndRerun({
      watchDirs,
      watchFiles: ruleFiles,
      onChangeDetected: async () => {
        resetProjectCache()
        await runCheck(checkArgs)
      },
    })
  } else {
    const failures = await runCheck({ ruleFiles, baseline, changed, base, format })
    if (failures > 0) {
      process.exitCode = 1
    }
  }
}

/** Handle the `baseline` subcommand. */
async function handleBaseline(ruleFiles: string[], output: string): Promise<void> {
  if (!requireRuleFiles(ruleFiles)) return
  await runBaseline({ ruleFiles, output })
}

/** Handle the `explain` subcommand. */
async function handleExplain(ruleFiles: string[], markdown: boolean | undefined): Promise<void> {
  if (!requireRuleFiles(ruleFiles)) return
  await runExplain({ ruleFiles, markdown })
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

  if (values.watch === true && command !== 'check') {
    console.error('Error: --watch is only supported with the check command.')
    process.exitCode = 1
    return
  }

  const config = await resolveConfig(values.config)
  const ruleFiles = positionals.slice(1).length > 0 ? positionals.slice(1) : (config.rules ?? [])
  const format = (values.format ?? config.format ?? 'auto') as OutputFormat | 'auto'
  const baseline = values.baseline ?? config.baseline
  const base = values.base ?? 'main'
  const changed = values.changed ?? false

  if (command === 'check') {
    await handleCheck(ruleFiles, values, config, format, baseline, changed, base)
  } else if (command === 'baseline') {
    await handleBaseline(ruleFiles, values.output ?? 'arch-baseline.json')
  } else if (command === 'explain') {
    await handleExplain(ruleFiles, values.markdown)
  } else {
    console.error(`Error: Unknown command "${command}". Use --help for usage.`)
    process.exitCode = 1
  }
}

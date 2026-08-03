import { parseArgs } from 'node:util'
import { isRecord } from '../core/type-guards.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { OutputFormat } from '../core/check-options.js'
import { resetProjectCache } from '../core/project.js'
import { resolveConfig } from './resolve-config.js'
import { runCheck } from './commands/check.js'
import { runBaseline } from './commands/baseline.js'
import { runExplain } from './commands/explain.js'
import { runInit } from './commands/init.js'
import { runDoctor } from './commands/doctor.js'
import { watchAndRerun } from './watch.js'

function getVersion(): string {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json')
  // `JSON.parse` returns `any`, so the shape has to be established rather than
  // asserted — and this runs for `--version`, where a malformed package.json
  // should not crash the CLI with a TypeError about reading a property of a
  // string (ADR-005, bug 0049).
  const pkg: unknown = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  if (isRecord(pkg) && typeof pkg.version === 'string') return pkg.version
  return '0.0.0-unknown'
}

const HELP_TEXT = `
ts-archunit — Architecture testing for TypeScript

Usage:
  ts-archunit init                      Scaffold config + rules for a new project
  ts-archunit check [files...]          Run architecture rules
  ts-archunit baseline [files...]       Generate baseline file
  ts-archunit explain [files...]        Dump all active rules as JSON
  ts-archunit doctor [files...]         Report rules that cannot enforce anything

Options:
  --preset <name>       init: starter preset — recommended (default) | agent-guardrails
                        | layered | strict-boundaries | data-layer
  --tsconfig <path>     init: tsconfig path to wire in (default: tsconfig.json)
  --no-baseline         init: skip arch-baseline.json
  --force               init: overwrite existing files
  --dry-run             init: print what would be created; write nothing
  --baseline <path>     Baseline file for filtering known violations
  --output <path>       Output path for baseline file (default: arch-baseline.json)
  --changed             Only report violations in changed files (git diff)
  --base <branch>       Base branch for diff (default: main)
  --format <format>     check: terminal, json, github, auto (default: auto)
                        explain: json (default), markdown, agent
                        doctor: terminal (default), json
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
    preset?: string
    tsconfig?: string
    force?: boolean
    'dry-run'?: boolean
    'no-baseline'?: boolean
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
      preset: { type: 'string' },
      tsconfig: { type: 'string' },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'no-baseline': { type: 'boolean', default: false },
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
  const code = await runBaseline({ ruleFiles, output })
  if (code !== 0) process.exitCode = code
}

/** Reject a `--format` value that isn't valid for the given subcommand. */
const FORMATS: Record<'check' | 'explain' | 'doctor', readonly string[]> = {
  check: ['terminal', 'json', 'github', 'auto'],
  explain: ['json', 'markdown', 'agent'],
  // `doctor` has only these two. It was unvalidated while the command was
  // hidden, so `--format github` ran silently as terminal — tolerable for an
  // undocumented command, not for one listed in `--help` (plan 0077 review).
  doctor: ['terminal', 'json'],
}

function isValidFormat(
  command: 'check' | 'explain' | 'doctor',
  format: string | undefined,
): boolean {
  if (format === undefined) return true
  const allowed = FORMATS[command]
  if (!allowed.includes(format)) {
    console.error(
      `Error: --format '${format}' is not valid for '${command}'. Valid values: ${allowed.join(', ')}.`,
    )
    process.exitCode = 1
    return false
  }
  return true
}

/** Handle the `explain` subcommand. */
async function handleExplain(
  ruleFiles: string[],
  markdown: boolean | undefined,
  format: string | undefined,
): Promise<void> {
  if (!requireRuleFiles(ruleFiles)) return
  await runExplain({ ruleFiles, markdown, format })
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

  // `init` scaffolds the config, so it runs before config resolution.
  if (command === 'init') {
    const code = runInit({
      preset: values.preset,
      tsconfig: values.tsconfig,
      force: values.force,
      dryRun: values['dry-run'],
      noBaseline: values['no-baseline'],
    })
    if (code !== 0) process.exitCode = code
    return
  }

  const config = await resolveConfig(values.config)
  const ruleFiles = positionals.slice(1).length > 0 ? positionals.slice(1) : (config.rules ?? [])
  // A guard over the union, not a cast onto it: `values.format` comes from the
  // command line and `config.format` from a file, so neither is typed by anything
  // the compiler can see (bug 0049).
  const requested = values.format ?? config.format ?? 'auto'
  const isOutputFormat = (v: string): v is OutputFormat | 'auto' =>
    (['terminal', 'json', 'github', 'auto'] as const).some((f) => f === v)
  const format = isOutputFormat(requested) ? requested : 'auto'
  const baseline = values.baseline ?? config.baseline
  const base = values.base ?? 'main'
  const changed = values.changed ?? false

  if (
    (command === 'check' && !isValidFormat('check', values.format)) ||
    (command === 'explain' && !isValidFormat('explain', values.format)) ||
    (command === 'doctor' && !isValidFormat('doctor', values.format))
  ) {
    return
  }

  if (command === 'check') {
    await handleCheck(ruleFiles, values, config, format, baseline, changed, base)
  } else if (command === 'baseline') {
    await handleBaseline(ruleFiles, values.output ?? 'arch-baseline.json')
  } else if (command === 'explain') {
    await handleExplain(ruleFiles, values.markdown, values.format)
  } else if (command === 'doctor') {
    // Supported since plan 0077, which settled the keep-or-retire question 0069
    // left open. It is scoped, not experimental: it diagnoses rule files the CLI
    // can LOAD — the `arch.rules.ts` shape `init` scaffolds, which
    // `getting-started.md` calls the default path. Rules hosted in a vitest or
    // jest file cannot be imported outside their runner; `diagnose()` is the
    // answer there and reports the same findings.
    //
    // Still not a build gate (0069): it is invoked deliberately, and `check` is
    // the gate.
    //
    // What it uniquely catches is a **dead glob** — a rule whose selector can
    // never match, so it certifies nothing. `check` does not call `diagnose()`
    // at all, and measured, it exits **0 with no output** on such a rule while
    // `doctor` names the site and exits 1. That is the ADR-008 false green this
    // whole area exists for, and until 0069's R3b flips it into a check-time
    // failure, `doctor` and `diagnose()` are the only surfaces that see it.
    //
    // NOT load failures, which an earlier version of this comment claimed:
    // `check` already reports an unloadable rule file as an error-severity
    // configuration finding with a remedy (`cli/rule-file-findings.ts`), and
    // does it better than this command's bare stderr line.
    const code = await runDoctor({
      ruleFiles,
      format: values.format === 'json' ? 'json' : 'terminal',
    })
    if (code !== 0) process.exitCode = code
  } else {
    console.error(`Error: Unknown command "${command}". Use --help for usage.`)
    process.exitCode = 1
  }
}

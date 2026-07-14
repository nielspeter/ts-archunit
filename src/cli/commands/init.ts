import fs from 'node:fs'
import path from 'node:path'

/** "Floor" presets — a universal rule set scoped to your source glob. */
const FLOOR_PRESETS = ['recommended', 'agent-guardrails'] as const
/** "Shape" presets — architecture patterns; scaffolded with fill-in folder globs. */
const SHAPE_PRESETS = ['layered', 'strict-boundaries', 'data-layer'] as const
/** Every preset `init` can scaffold — all are returning-form (spreadable). */
const VALID_PRESETS = [...FLOOR_PRESETS, ...SHAPE_PRESETS] as const
type FloorPreset = (typeof FLOOR_PRESETS)[number]
type ShapePreset = (typeof SHAPE_PRESETS)[number]
type InitPreset = (typeof VALID_PRESETS)[number]

const VALID_PRESET_SET: ReadonlySet<string> = new Set(VALID_PRESETS)

export interface InitArgs {
  /** Directory to scaffold into. Defaults to `process.cwd()`. */
  cwd?: string
  /**
   * Starter preset. Floor: `recommended` (default) | `agent-guardrails`.
   * Shape: `layered` | `strict-boundaries` | `data-layer` (scaffolded with
   * fill-in folder globs, alongside the `recommended` floor).
   */
  preset?: string
  /** tsconfig path written into the generated files. Default `tsconfig.json`. */
  tsconfig?: string
  /** Overwrite existing files instead of refusing. */
  force?: boolean
  /** Print the plan; write nothing. */
  dryRun?: boolean
  /** Skip `arch-baseline.json` (and omit the `baseline` config field). */
  noBaseline?: boolean
}

interface StagedFile {
  /** Absolute path. */
  path: string
  /** Display name (relative to cwd). */
  name: string
  content: string
}

/**
 * Scaffold a working ts-archunit setup in `cwd`. Returns the process exit code
 * (0 success, 1 on a recoverable error — bad `--preset`, missing tsconfig, a
 * file conflict without `--force`, or a write failure). All reads, parses, and
 * conflict checks run before any file is written, so a validation failure never
 * leaves a partial scaffold; a raw I/O failure mid-write is caught and reported
 * (writes are ordered, not transactional).
 */
export function runInit(args: InitArgs): number {
  const cwd = args.cwd ?? process.cwd()
  const tsconfig = args.tsconfig ?? 'tsconfig.json'

  const preset = args.preset ?? 'recommended'
  if (!isValidPreset(preset)) {
    console.error(
      `Error: unknown --preset '${preset}'. Valid presets: ${VALID_PRESETS.join(', ')}.`,
    )
    return 1
  }

  // tsconfig must exist — the generated project() call points at it.
  if (!fs.existsSync(path.join(cwd, tsconfig))) {
    console.error(
      `Error: ts-archunit needs a ${tsconfig} — run \`tsc --init\` first or pass --tsconfig <path>.`,
    )
    return 1
  }

  const sourceRoot = detectSourceRoot(cwd, tsconfig)
  const writeBaseline = args.noBaseline !== true

  // Stage the generated files in memory (no writes yet).
  const staged: StagedFile[] = [
    stage(cwd, 'ts-archunit.config.ts', configTemplate(tsconfig, writeBaseline)),
    stage(cwd, 'arch.rules.ts', rulesTemplate(preset, tsconfig, sourceRoot)),
  ]
  if (writeBaseline) {
    staged.push(stage(cwd, 'arch-baseline.json', baselineTemplate()))
  }

  // Read + parse package.json up front so a parse failure never crashes mid-write.
  const pkgPlan = planPackageJson(cwd)

  // A dry run writes nothing, so it previews regardless of existing files.
  if (args.dryRun === true) {
    printDryRun(staged, pkgPlan, cwd, sourceRoot)
    return 0
  }

  // Conflict detection (before any write).
  if (args.force !== true) {
    const conflicts = staged.filter((f) => fs.existsSync(f.path)).map((f) => f.name)
    if (conflicts.length > 0) {
      console.error(
        `Error: refusing to overwrite existing file(s): ${conflicts.join(', ')}.\n` +
          `Re-run with --force to overwrite or --dry-run to preview.`,
      )
      return 1
    }
  }

  // Flush. Every read/parse/validate is already done, so a validation failure
  // can't leave a partial scaffold; the `wx` flag (unless --force) also fails
  // fast if a file appeared after the conflict check rather than clobbering it.
  const writeFlag = args.force === true ? 'w' : 'wx'
  try {
    for (const file of staged) {
      fs.writeFileSync(file.path, file.content, { flag: writeFlag })
    }
    if (pkgPlan.action === 'write') {
      fs.writeFileSync(pkgPlan.path, pkgPlan.content)
    }
  } catch (err) {
    console.error(
      `Error: could not write files — ${err instanceof Error ? err.message : String(err)}`,
    )
    return 1
  }

  printClosing(staged, pkgPlan, cwd, sourceRoot)
  return 0
}

function isValidPreset(value: string): value is InitPreset {
  return VALID_PRESET_SET.has(value)
}

function isFloorPreset(preset: InitPreset): preset is FloorPreset {
  return preset === 'recommended' || preset === 'agent-guardrails'
}

function stage(cwd: string, name: string, content: string): StagedFile {
  return { path: path.join(cwd, name), name, content }
}

// --- Templates ---------------------------------------------------------------

function configTemplate(tsconfig: string, writeBaseline: boolean): string {
  const baselineLine = writeBaseline ? `\n  baseline: 'arch-baseline.json',` : ''
  return `import { defineConfig } from '@nielspeter/ts-archunit'

export default defineConfig({
  // The active tsconfig is set in arch.rules.ts via project('${tsconfig}').
  rules: ['arch.rules.ts'],${baselineLine}
  format: 'auto',
})
`
}

function rulesTemplate(preset: InitPreset, tsconfig: string, sourceRoot: string): string {
  return isFloorPreset(preset)
    ? floorRulesTemplate(preset, tsconfig, sourceRoot)
    : shapeRulesTemplate(preset, tsconfig, sourceRoot)
}

/** The `recommended` include option, sourceRoot-aware (bare when root is `src`). */
function recommendedCallFor(sourceRoot: string): string {
  return sourceRoot === 'src'
    ? 'recommended(p)'
    : `recommended(p, { include: '**/${sourceRoot}/**' })`
}

function floorRulesTemplate(preset: FloorPreset, tsconfig: string, sourceRoot: string): string {
  const recommendedCall = recommendedCallFor(sourceRoot)
  const agentCall = `agentGuardrails(p, {
    src: '${sourceRoot}/**',
    noGenericErrors: true,
    noStubs: true,
    noEmptyBodies: true,
    noCopyPaste: true,
  })`

  const presetImport = preset === 'recommended' ? 'recommended' : 'agentGuardrails'

  // Lead with the chosen preset; the other is offered in a comment block.
  const leadBlock =
    preset === 'recommended'
      ? `  // Thin universal safety floor.
  ...${recommendedCall},`
      : `  // Guardrails for the mistakes AI coding agents make most.
  ...${agentCall},`

  const alternateBlock =
    preset === 'recommended'
      ? `  // Using an AI coding agent? Add agentGuardrails — it targets the mistakes
  // agents make most (inline logic, generic errors, stubs, empty bodies,
  // copy-paste), and \`npx ts-archunit explain --format agent\` emits an
  // imperative rules block for the agent's system prompt.
  // See https://nielspeter.github.io/ts-archunit/ai-agents. Then, with
  // { agentGuardrails } imported from '@nielspeter/ts-archunit/presets':
  //   ...agentGuardrails(p, { src: '${sourceRoot}/**', noGenericErrors: true })`
      : `  // Thin universal safety floor (eval, Function constructor, silent catches,
  // empty bodies). Import { recommended } from '@nielspeter/ts-archunit/presets':
  //   ...${recommendedCall},`

  return `import { project } from '@nielspeter/ts-archunit'
import { ${presetImport} } from '@nielspeter/ts-archunit/presets'
// Uncomment the imports you need for the examples below:
// import { classes, slices, call } from '@nielspeter/ts-archunit'

const p = project('${tsconfig}')

// Rules are collected into the default export; \`ts-archunit check\` runs them.
export default [
${leadBlock}

${alternateBlock}

  // Add project-specific rules below — builders, no .check().
  // (Builders default to error; append .asSeverity('warn') to warn, not fail.)
  //   classes(p).that().resideInFolder('${sourceRoot}/services/**')
  //     .should().notContain(call('parseInt')),
  //   slices(p).matching('${sourceRoot}/features/*/').should().beFreeOfCycles(),
]
`
}

/** import name, one-line description, and the fill-in call for a shape preset. */
function shapePresetSpec(
  preset: ShapePreset,
  root: string,
): {
  importName: string
  describe: string
  call: string
} {
  if (preset === 'layered') {
    return {
      importName: 'layeredArchitecture',
      describe: 'Layered architecture: dependencies flow downward, layers stay cycle-free.',
      call: `layeredArchitecture(p, {
    // Adjust these globs to your layer folders (top to bottom).
    layers: {
      routes: '${root}/routes/**',
      services: '${root}/services/**',
      repositories: '${root}/repositories/**',
    },
    shared: ['${root}/shared/**'],
  })`,
    }
  }
  if (preset === 'strict-boundaries') {
    return {
      importName: 'strictBoundaries',
      describe: 'Feature boundaries: each folder imports only from itself and shared.',
      call: `strictBoundaries(p, {
    // Each folder matching this glob is an isolated boundary.
    folders: '${root}/features/*',
    shared: ['${root}/shared/**'],
  })`,
    }
  }
  return {
    importName: 'dataLayerIsolation',
    describe: 'Repository pattern: repositories extend a base class and throw typed errors.',
    call: `dataLayerIsolation(p, {
    repositories: '${root}/repositories/**',
    baseClass: 'BaseRepository',
    requireTypedErrors: true,
  })`,
  }
}

function shapeRulesTemplate(preset: ShapePreset, tsconfig: string, sourceRoot: string): string {
  const { importName, describe, call } = shapePresetSpec(preset, sourceRoot)
  const recommendedCall = recommendedCallFor(sourceRoot)

  return `import { project } from '@nielspeter/ts-archunit'
import { recommended, ${importName} } from '@nielspeter/ts-archunit/presets'
// Uncomment the imports you need for the examples below:
// import { classes, slices, call } from '@nielspeter/ts-archunit'

const p = project('${tsconfig}')

// Rules are collected into the default export; \`ts-archunit check\` runs them.
export default [
  // Thin universal safety floor.
  ...${recommendedCall},

  // ${describe}
  // Edit the globs below to match your project, then \`npm run arch\`.
  ...${call},

  // Add project-specific rules below — builders, no .check().
  // (Builders default to error; append .asSeverity('warn') to warn, not fail.)
  //   classes(p).that().resideInFolder('${sourceRoot}/services/**')
  //     .should().notContain(call('parseInt')),
]
`
}

function baselineTemplate(): string {
  // Inert seed — an empty baseline filters nothing. Timestamp is fixed so the
  // seed is deterministic; `ts-archunit baseline` restamps it when populated.
  return JSON.stringify({ generatedAt: null, count: 0, violations: [] }, null, 2) + '\n'
}

// --- Source-root detection ---------------------------------------------------

/**
 * Best-effort project source root from the tsconfig `include` globs or
 * `compilerOptions.rootDir`. Falls back to `src`. tsconfig files are often JSONC
 * (comments / trailing commas), so parse failures fall back rather than throw.
 */
function detectSourceRoot(cwd: string, tsconfig: string): string {
  const parsed = readJsonc(path.join(cwd, tsconfig))
  if (!isRecord(parsed)) return 'src'

  const include = parsed['include']
  if (Array.isArray(include)) {
    for (const entry of include) {
      if (typeof entry !== 'string') continue
      const root = leadingDir(entry)
      if (root !== undefined) return root
    }
  }

  const compilerOptions = parsed['compilerOptions']
  if (isRecord(compilerOptions) && typeof compilerOptions['rootDir'] === 'string') {
    const root = leadingDir(compilerOptions['rootDir'])
    if (root !== undefined) return root
  }

  return 'src'
}

/** The first path segment of a glob, if it is a literal directory (no wildcard). */
function leadingDir(glob: string): string | undefined {
  const first = glob.replace(/^\.\//, '').split('/')[0]
  if (first === undefined || first === '' || first === '.' || first.includes('*')) {
    return undefined
  }
  return first
}

function readJsonc(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined
  const raw = fs.readFileSync(filePath, 'utf-8')
  // Strip block and line comments and trailing commas, then parse best-effort.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(stripped)
  } catch {
    return undefined
  }
}

// --- package.json script merge -----------------------------------------------

type PackageJsonPlan =
  | { action: 'write'; path: string; content: string }
  | { action: 'skip'; reason: string }

/**
 * Plan the `package.json` script merge without writing. Reads and parses up
 * front; any problem (missing / unparseable / scripts already present) resolves
 * to a graceful skip rather than a mid-run crash. Preserves the file's indent,
 * EOL, and trailing-newline state so the diff stays to the two added scripts.
 */
function planPackageJson(cwd: string): PackageJsonPlan {
  const pkgPath = path.join(cwd, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return { action: 'skip', reason: 'no package.json (run `npx ts-archunit check` directly)' }
  }

  const raw = fs.readFileSync(pkgPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { action: 'skip', reason: 'package.json is not valid JSON — skipped script entry' }
  }
  if (!isRecord(parsed)) {
    return { action: 'skip', reason: 'package.json is not an object — skipped script entry' }
  }

  const existingScripts = parsed['scripts']
  const scripts: Record<string, unknown> = isRecord(existingScripts) ? { ...existingScripts } : {}
  if (scripts['arch'] !== undefined || scripts['arch:baseline'] !== undefined) {
    return { action: 'skip', reason: 'an `arch` or `arch:baseline` script already exists' }
  }

  scripts['arch'] = 'ts-archunit check'
  scripts['arch:baseline'] = 'ts-archunit baseline'
  parsed['scripts'] = scripts

  const indent = detectIndent(raw)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = /\n$/.test(raw)
  let content = JSON.stringify(parsed, null, indent)
  if (eol === '\r\n') content = content.replace(/\n/g, '\r\n')
  if (trailingNewline) content += eol

  return { action: 'write', path: pkgPath, content }
}

/** Detect the indentation (a tab or N spaces) of an existing JSON file; default 2 spaces. */
function detectIndent(raw: string): string {
  const match = raw.match(/\n(\t+|[ ]+)"/)
  return match?.[1] ?? '  '
}

// --- Messaging ---------------------------------------------------------------

function printDryRun(
  staged: StagedFile[],
  pkg: PackageJsonPlan,
  cwd: string,
  sourceRoot: string,
): void {
  process.stdout.write('Dry run — would create:\n')
  for (const file of staged) {
    const exists = fs.existsSync(file.path) ? ' (exists — needs --force)' : ''
    process.stdout.write(`  ${file.name}${exists}\n`)
  }
  if (pkg.action === 'write') {
    process.stdout.write('  package.json (add `arch` + `arch:baseline` scripts)\n')
  } else {
    process.stdout.write(`  (package.json script entry skipped — ${pkg.reason})\n`)
  }
  if (hasSource(cwd, sourceRoot)) {
    process.stdout.write(
      `\nNote: this codebase already has source under ${sourceRoot}/ — errors fail the ` +
        `build, warnings don't. Run \`ts-archunit baseline\` before gating CI on \`arch\`.\n`,
    )
  }
}

function printClosing(
  staged: StagedFile[],
  pkg: PackageJsonPlan,
  cwd: string,
  sourceRoot: string,
): void {
  const scriptsAdded = pkg.action === 'write'
  const runCmd = scriptsAdded ? 'npm run arch' : 'npx ts-archunit check'
  const baselineCmd = scriptsAdded ? 'npm run arch:baseline' : 'npx ts-archunit baseline'

  process.stdout.write(`Created ${String(staged.length)} file(s).\n`)
  if (!scriptsAdded && pkg.action === 'skip') {
    process.stdout.write(`Note: package.json script entry skipped — ${pkg.reason}.\n`)
  }

  if (hasSource(cwd, sourceRoot)) {
    process.stdout.write(
      `\nThis codebase already has source under ${sourceRoot}/. Errors fail the build; ` +
        `warnings are advisory and never fail CI.\n` +
        `To accept current violations as tracked legacy debt before gating CI, run ` +
        `\`${baselineCmd}\` and commit the result, then: \`${runCmd}\`.\n`,
    )
  } else {
    process.stdout.write(`\nNext: \`${runCmd}\`.\n`)
  }
}

/** Does the source root directory exist and contain at least one entry? */
function hasSource(cwd: string, sourceRoot: string): boolean {
  const dir = path.join(cwd, sourceRoot)
  try {
    return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

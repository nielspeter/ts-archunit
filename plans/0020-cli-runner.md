# Plan 0020: CLI Standalone Runner & Watch Mode

## Status

- **State:** Not Started
- **Priority:** P3 — Nice-to-have, most users run rules via vitest/jest
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0005 (Rule Builder), 0016 (Baseline), 0019 (Output Formats)

## Purpose

Run architecture rules without a test runner. The CLI wraps the existing programmatic API (`withBaseline`, `generateBaseline`, `diffAware`, `detectFormat`, `collectViolations`) behind `npx ts-archunit` commands. This serves two use cases:

1. **CI pipelines** that don't use vitest/jest (e.g., standalone lint steps, pre-commit hooks)
2. **Watch mode** for rapid feedback during development

The spec (Section 11.2-11.3) defines the CLI surface. This plan implements it.

## CLI Surface

```bash
# Run rules from a file
npx ts-archunit check arch.rules.ts

# Watch mode — re-run on file changes
npx ts-archunit check --watch

# Generate baseline
npx ts-archunit baseline --output arch-baseline.json

# Check with baseline (only new violations fail)
npx ts-archunit check --baseline arch-baseline.json

# Diff-aware (only report violations in changed files)
npx ts-archunit check --changed --base main

# Output format
npx ts-archunit check --format github
```

## Phase 1: Config File & Rule File Contracts

### `ts-archunit.config.ts` (optional)

Per spec Section 11.3, an optional config file using `defineConfig()`:

```typescript
// ts-archunit.config.ts
import { defineConfig } from 'ts-archunit'

export default defineConfig({
  project: 'tsconfig.json',
  rules: ['arch.rules.ts'],           // rule files to load
  baseline: 'arch-baseline.json',      // default baseline path
  format: 'auto',                      // 'auto' | 'terminal' | 'json' | 'github'
})
```

### `src/cli/config.ts`

```typescript
import type { OutputFormat } from '../core/check-options.js'

export interface CliConfig {
  /** Path to tsconfig.json. Default: 'tsconfig.json' */
  project?: string
  /** Rule files to load. Default: discovered via glob */
  rules?: string[]
  /** Baseline file path */
  baseline?: string
  /** Output format. 'auto' uses detectFormat() */
  format?: OutputFormat | 'auto'
}

/**
 * Define a CLI configuration with type safety.
 */
export function defineConfig(config: CliConfig): CliConfig {
  return config
}
```

Config resolution order:
1. CLI flags (highest priority)
2. `ts-archunit.config.ts` in project root
3. Defaults (`project: 'tsconfig.json'`, `format: 'auto'`)

### Rule file contract

A rule file exports an array of rule builders or a function that returns them:

```typescript
// arch.rules.ts
import { project, classes, modules, call } from 'ts-archunit'

const p = project('tsconfig.json')

export default [
  classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')),
  modules(p).that().resideInFolder('src/domain/**').should().notImportFrom('src/repositories/**'),
]
```

The CLI calls `.check()` on each builder. This reuses the existing `RuleBuilder` — no new rule representation needed.

## Phase 2: CLI Entry Point

### `src/cli/index.ts`

Use Node.js `parseArgs` (no dependencies — ADR-001 toolchain). The CLI is a thin wrapper:

```typescript
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  options: {
    watch:    { type: 'boolean', default: false },
    baseline: { type: 'string' },
    output:   { type: 'string' },
    changed:  { type: 'boolean', default: false },
    base:     { type: 'string', default: 'main' },
    format:   { type: 'string' },
    config:   { type: 'string' },
    help:     { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
  strict: true,
})

const command = positionals[0] // 'check' or 'baseline'
```

### `src/cli/bin.ts`

The bin entry point — a thin shim that imports and runs the CLI:

```typescript
#!/usr/bin/env node
import './index.js'
```

### `package.json` additions

```json
{
  "bin": {
    "ts-archunit": "./dist/cli/bin.js"
  }
}
```

## Phase 3: `check` Command

### `src/cli/commands/check.ts`

```typescript
import { detectFormat } from '../../core/environment.js'
import { withBaseline } from '../../helpers/baseline.js'
import { diffAware } from '../../helpers/diff-aware.js'
import type { CheckOptions, OutputFormat } from '../../core/check-options.js'

interface CheckArgs {
  ruleFiles: string[]
  baseline?: string
  changed: boolean
  base: string
  format: OutputFormat | 'auto'
}

export async function runCheck(args: CheckArgs): Promise<void> {
  const format = args.format === 'auto' ? detectFormat() : args.format

  const options: CheckOptions = { format }

  if (args.baseline) {
    options.baseline = withBaseline(args.baseline)
  }
  if (args.changed) {
    options.diff = diffAware(args.base)
  }

  // Load rule files via dynamic import (ESM — ADR-004)
  const builders = await loadRuleFiles(args.ruleFiles)

  let failures = 0
  for (const builder of builders) {
    try {
      builder.check(options)
    } catch {
      failures++
    }
  }

  if (failures > 0) {
    process.exitCode = 1
  }
}
```

### Rule file loading

Rule files are loaded via `import()`. They must export a default array of rule builders (or a function returning one). The CLI uses `tsx` or Node.js `--import tsx` for TypeScript support — the user's project already has TypeScript installed (ADR-001).

```typescript
import path from 'node:path'

async function loadRuleFiles(files: string[]): Promise<Array<{ check: (opts?: CheckOptions) => void }>> {
  const builders: Array<{ check: (opts?: CheckOptions) => void }> = []

  for (const file of files) {
    const resolved = path.resolve(file)
    const mod: unknown = await import(resolved)

    // Support: export default [...] or export default function() { return [...] }
    const exports = extractDefault(mod)
    if (Array.isArray(exports)) {
      builders.push(...exports)
    }
  }

  return builders
}
```

**Design decision:** Rule files are standard TypeScript/ESM modules. The CLI does not invent a DSL or config language — it imports `.ts` files that use the same API as test files. This means zero new concepts for users who already write rules in vitest.

## Phase 4: `baseline` Command

### `src/cli/commands/baseline.ts`

Wraps the existing `collectViolations` + `generateBaseline` from plan 0016:

```typescript
import { collectViolations } from '../../helpers/baseline-generator.js'
import { generateBaseline } from '../../helpers/baseline.js'

interface BaselineArgs {
  ruleFiles: string[]
  output: string
}

export async function runBaseline(args: BaselineArgs): Promise<void> {
  const builders = await loadRuleFiles(args.ruleFiles)
  const violations = collectViolations(...builders)

  generateBaseline(violations, args.output)

  console.log(`Baseline generated: ${String(violations.length)} violations recorded`)
  console.log(`Written to: ${args.output}`)
}
```

## Phase 5: Watch Mode

### `src/cli/watch.ts`

Use `node:fs/promises` watch API (Node 24 — ADR-001, no chokidar dependency):

```typescript
import { watch } from 'node:fs/promises'
import path from 'node:path'

export async function watchAndRun(
  projectDir: string,
  runFn: () => Promise<void>,
): Promise<void> {
  console.log('Watching for changes...')

  // Initial run
  await runFn()

  const watcher = watch(path.resolve(projectDir, 'src'), { recursive: true })

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  for await (const event of watcher) {
    if (!event.filename?.endsWith('.ts')) continue

    // Debounce — wait 200ms after last change before re-running
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      console.clear()
      console.log(`Change detected: ${event.filename}`)
      void runFn()
    }, 200)
  }
}
```

**Key consideration:** ts-morph `Project` caches source files. On re-run, the project must be refreshed. The simplest approach: re-import the rule file (clearing the module cache) so `project()` creates a fresh instance. If performance is a concern, a future optimization can add incremental refresh to the `project()` loader.

The `--watch` flag triggers:

```typescript
if (args.watch) {
  await watchAndRun(process.cwd(), () => runCheck({ ...args, format }))
} else {
  await runCheck(args)
}
```

## Phase 6: Config File Resolution

### `src/cli/resolve-config.ts`

```typescript
import path from 'node:path'
import fs from 'node:fs'
import type { CliConfig } from './config.js'

const CONFIG_FILENAMES = ['ts-archunit.config.ts', 'ts-archunit.config.js']

export async function resolveConfig(explicitPath?: string): Promise<CliConfig> {
  const configPath = explicitPath ?? findConfigFile()

  if (!configPath) return {}

  const mod: unknown = await import(path.resolve(configPath))
  return extractDefault(mod) as CliConfig
}

function findConfigFile(): string | undefined {
  const cwd = process.cwd()
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(cwd, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}
```

### Rule file discovery

When no rule files are specified on the command line:

1. Check `config.rules` from config file
2. Glob for `**/*.rules.ts` and `**/*.arch.ts` in the project
3. Error if none found

## Phase 7: Tests

### `tests/cli/parse-args.test.ts`

1. **Parses `check` command with rule file** — positional extracted correctly
2. **Parses `--baseline` flag** — string value captured
3. **Parses `--changed --base develop`** — both flags captured
4. **Parses `--format json`** — format string captured
5. **Parses `--watch` flag** — boolean true
6. **Defaults `--base` to 'main'** — when `--changed` but no `--base`

### `tests/cli/config.test.ts`

7. **defineConfig returns the config object** — passthrough with type safety
8. **resolveConfig loads ts-archunit.config.ts** — dynamic import works
9. **resolveConfig returns empty when no config file** — graceful fallback
10. **CLI flags override config file values** — merge precedence

### `tests/cli/check.test.ts`

11. **runCheck loads rule file and calls .check()** — end-to-end with fixture
12. **runCheck applies baseline filter** — violations in baseline are skipped
13. **runCheck applies diff filter** — only changed file violations reported
14. **runCheck sets process.exitCode=1 on failures** — exit code for CI
15. **runCheck with --format github prints annotations** — format passed through

### `tests/cli/baseline-cmd.test.ts`

16. **runBaseline generates baseline file** — file written with correct structure
17. **runBaseline reports violation count** — stdout message

### `tests/cli/watch.test.ts`

18. **watchAndRun calls runFn on initial run** — immediate execution
19. **watchAndRun debounces rapid changes** — only one re-run per burst

## Files Changed

| File                             | Change                                        |
| -------------------------------- | --------------------------------------------- |
| `src/cli/bin.ts`                 | New — `#!/usr/bin/env node` shim              |
| `src/cli/index.ts`              | New — CLI entry point, arg parsing            |
| `src/cli/config.ts`             | New — `CliConfig` interface, `defineConfig()` |
| `src/cli/resolve-config.ts`     | New — config file discovery and loading       |
| `src/cli/commands/check.ts`     | New — `check` command implementation          |
| `src/cli/commands/baseline.ts`  | New — `baseline` command implementation       |
| `src/cli/watch.ts`              | New — watch mode with `node:fs/promises`      |
| `src/index.ts`                  | Modified — export `defineConfig`              |
| `package.json`                  | Modified — add `bin` field                    |
| `tests/cli/parse-args.test.ts`  | New — 6 tests                                 |
| `tests/cli/config.test.ts`      | New — 4 tests                                 |
| `tests/cli/check.test.ts`       | New — 5 tests                                 |
| `tests/cli/baseline-cmd.test.ts`| New — 2 tests                                 |
| `tests/cli/watch.test.ts`       | New — 2 tests                                 |

## Out of Scope

- **`init` command** — scaffolding a rule file. Users copy from docs.
- **Plugin system** — CLI loads rule files directly, no plugin registry.
- **Parallel rule execution** — rules run sequentially. Parallelism is a future optimization.
- **SARIF output** — deferred per plan 0019 out-of-scope notes.
- **Incremental watch** — first version re-imports everything. Incremental ts-morph refresh is a future optimization.
- **`tsx` bundling** — the CLI assumes the user has TypeScript loader support (Node 24 `--experimental-strip-types` or `tsx` in PATH). Documenting this in the user guide (plan 0023).

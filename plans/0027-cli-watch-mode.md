# Plan 0027: CLI Watch Mode

## Status

- **State:** Not Started
- **Priority:** P2 — Core DX improvement, the only unshipped spec feature
- **Effort:** 0.5 day
- **Created:** 2026-03-26
- **Depends on:** 0020 (CLI Runner)

## Problem

Developers writing or debugging architecture rules must run `npx ts-archunit check` manually after every change. This breaks flow — the feedback loop should be: save file, see result instantly.

The spec (Section 11.2) defines `--watch`. Plan 0020 designed it but didn't implement it. The CLI shipped without watch mode.

## Design Decisions

### Node.js `fs.watch` — no chokidar

Node 24 `fs.watch` with `recursive: true` works on macOS (FSEvents) and Windows. No third-party dependency needed. This follows ADR-001's toolchain principle.

**Linux caveat:** `recursive: true` uses inotify watches per-directory internally. Large projects may hit the `fs.inotify.max_user_watches` sysctl limit (commonly 8192 or 65536). On CI or Docker environments, this limit can be lower. Document that `--watch` is intended for local development. If inotify limits are hit, the watcher silently misses events — log a startup note on Linux suggesting users check `sysctl fs.inotify.max_user_watches`.

### Project reload strategy

ts-morph `Project` caches parsed source files. On file change, we need fresh AST. Two options:

1. **Full reload** — clear the module cache entry for the rule file, re-import it, `project()` creates a fresh instance
2. **Incremental refresh** — call `project.getSourceFile(path)?.refreshFromFileSystem()` for changed files only

**Decision: Full reload for v1.** Simpler, correct, and fast enough for the watch use case (developer is editing one file at a time). The spec's performance budget targets <3s for <500 files — acceptable for watch iteration. Incremental refresh is a future optimization if users report latency on large projects.

**Known limitation: `importFresh` memory leak.** Each re-run uses `import(`file://...?t=${Date.now()}`)` to bypass the ESM module cache. Node's ESM loader has no eviction API, so each reload creates a permanent cache entry. Over a long watch session (hours), memory grows linearly. Mitigations: (a) log a warning after 200 reloads suggesting a restart, (b) document this as a known limitation. A child-process approach (spawn per check, let it exit) is the proper fix but is a 0.5-day scope increase — defer to a future optimization.

### Debounce

Editors often trigger multiple rapid filesystem events for a single save (write temp file, rename, update metadata). Debounce with 250ms window — long enough to coalesce, short enough to feel instant.

### Watch scope

Watch directories from `defineConfig({ watchDirs })` if set, falling back to `src/` if the config field is absent. Also watch the rule files themselves — if the user edits the rule, re-run immediately.

## Phase 1: Watch Module

### `src/cli/watch.ts`

```typescript
import { watch } from 'node:fs/promises'
import path from 'node:path'
import { ArchRuleError } from '../core/errors.js'

interface WatchOptions {
  /** Directories to watch for changes */
  watchDirs: string[]
  /** Additional files to watch (e.g., rule files) */
  watchFiles: string[]
  /** Callback to run on detected changes */
  onChangeDetected: () => Promise<void>
  /** Debounce window in ms. Default: 250 */
  debounceMs?: number
}

export async function watchAndRerun(options: WatchOptions): Promise<void> {
  const { watchDirs, watchFiles, onChangeDetected, debounceMs = 250 } = options
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let pendingRerun = false

  const scheduleRun = (trigger: string): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (running) {
        // A run is in progress — flag for re-run after it completes
        pendingRerun = true
        return
      }
      executeRun(trigger)
    }, debounceMs)
  }

  const executeRun = (trigger: string): void => {
    running = true
    pendingRerun = false
    process.stdout.write(`\x1B[2J\x1B[H`) // clear screen, preserve scrollback
    process.stdout.write(`Change detected: ${trigger}\n\n`)
    onChangeDetected()
      .catch((err: unknown) => {
        // Rule failures are expected — swallow ArchRuleError, print others
        if (!(err instanceof ArchRuleError)) {
          if (err instanceof Error) {
            console.error(err.message)
          }
        }
      })
      .finally(() => {
        running = false
        if (pendingRerun) {
          // Changes arrived during the run — re-run immediately
          executeRun('(queued change)')
        } else {
          process.stdout.write('\nWatching for changes...\n')
        }
      })
  }

  const watchers: Array<{ close(): void }> = []

  // Watch directories recursively
  for (const dir of watchDirs) {
    const resolved = path.resolve(dir)
    const watcher = watch(resolved, { recursive: true })
    watchers.push({ close: () => watcher.return?.() })
    void (async () => {
      try {
        for await (const event of watcher) {
          if (event.filename && /\.[cm]?tsx?$/.test(event.filename)) {
            scheduleRun(event.filename)
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          console.error(`Watcher error on ${dir}: ${err.message}`)
        }
      }
    })()
  }

  // Watch individual rule files
  for (const file of watchFiles) {
    const resolved = path.resolve(file)
    const watcher = watch(resolved)
    watchers.push({ close: () => watcher.return?.() })
    void (async () => {
      try {
        for await (const _event of watcher) {
          scheduleRun(path.basename(file))
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          console.error(`Watcher error on ${file}: ${err.message}`)
        }
      }
    })()
  }

  // Graceful shutdown — close all watchers on SIGINT
  process.on('SIGINT', () => {
    for (const w of watchers) w.close()
    process.exit(0)
  })
}
```

### Module cache clearing

To get fresh rule evaluation on each run, we must invalidate the import cache. Node ESM doesn't support direct cache clearing, but we can use a query-string cache-buster:

```typescript
/** Import a module with cache-busting for watch mode */
export async function importFresh(filePath: string): Promise<unknown> {
  const resolved = path.resolve(filePath)
  const url = `file://${resolved}?t=${Date.now()}`
  return import(url)
}
```

The project loader singleton cache (`project()`) also needs clearing between runs. The existing `_resetProjectCache()` in `src/core/project.ts` (line 72) does this — rename it to `resetProjectCache` and export it publicly:

```typescript
import { resetProjectCache } from '../core/project.js'
```

## Phase 2: Integrate into CLI

### Modify `src/cli/index.ts`

Add `--watch` flag to `parseCliArgs`:

```typescript
// In parseArgs options:
watch: { type: 'boolean', short: 'w', default: false },
```

Update the `ParsedArgs` interface:

```typescript
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
    watch?: boolean  // NEW
  }
  positionals: string[]
}
```

Add to the help text:

```
  -w, --watch           Watch for changes and re-run (check command only)
```

In the command handler, add error for `--watch` on non-check commands:

```typescript
if (values.watch && command !== 'check') {
  console.error('Error: --watch is only supported with the check command.')
  process.exitCode = 1
  return
}

if (command === 'check') {
  if (values.watch) {
    const watchDirs = config.watchDirs ?? ['src']

    // Initial run
    process.stdout.write('ts-archunit — watching for changes\n\n')
    await runCheckFresh(checkArgs)
    process.stdout.write('\nWatching for changes...\n')

    // Watch and re-run
    await watchAndRerun({
      watchDirs,
      watchFiles: ruleFiles,
      onChangeDetected: () => runCheckFresh(checkArgs),
    })
  } else {
    const failures = await runCheck(checkArgs)
    if (failures > 0) process.exitCode = 1
  }
}
```

### `runCheckFresh` — watch-mode variant of `runCheck`

```typescript
async function runCheckFresh(args: CheckArgs): Promise<number> {
  resetProjectCache()
  return runCheck(args, { fresh: true })
}
```

The `fresh: true` flag tells `loadRuleFiles` to use `importFresh` instead of `import`.

## Phase 3: Project Cache Rename

### Modify `src/core/project.ts`

Rename `_resetProjectCache` to `resetProjectCache` and remove the `@internal` annotation:

```typescript
/**
 * Clear the project singleton cache. Used by watch mode to force
 * fresh ts-morph Project creation on re-runs.
 */
export function resetProjectCache(): void {
  cache.clear()
}
```

Update `src/index.ts` to export it:

```typescript
export { project, resetProjectCache } from './core/project.js'
```

Update all existing test files that reference `_resetProjectCache` to use `resetProjectCache`.

### Add `watchDirs` to `CliConfig`

In `src/cli/config.ts`:

```typescript
export interface CliConfig {
  project?: string
  rules?: string[]
  baseline?: string
  format?: OutputFormat | 'auto'
  /** Directories to watch in --watch mode. Default: ['src'] */
  watchDirs?: string[]
}
```

## Phase 4: CLI Documentation Page

The CLI is currently undocumented — there's a brief section in getting-started and a table entry in api-reference, but no dedicated page. Add `docs/cli.md` covering all CLI features (not just watch mode).

### `docs/cli.md`

```markdown
# CLI

Run architecture rules without a test runner. The CLI wraps the same API you use in vitest/jest behind `npx ts-archunit` commands.

## Commands

### `check` — Run Rules

```bash
# Run rules from a file
npx ts-archunit check arch.rules.ts

# Multiple rule files
npx ts-archunit check layers.rules.ts naming.rules.ts body.rules.ts

# With baseline (only new violations fail)
npx ts-archunit check arch.rules.ts --baseline arch-baseline.json

# Diff-aware (only report violations in changed files)
npx ts-archunit check arch.rules.ts --changed --base main

# Watch mode — re-run on file changes
npx ts-archunit check arch.rules.ts --watch

# Output format
npx ts-archunit check arch.rules.ts --format github
```

### `baseline` — Generate Baseline

```bash
# Generate baseline from current violations
npx ts-archunit baseline arch.rules.ts --output arch-baseline.json
```

Records all existing violations so that `check --baseline` only fails on new ones.

## Options

| Flag | Short | Description |
| --- | --- | --- |
| `--baseline <path>` | | Baseline file for filtering known violations |
| `--output <path>` | | Output path for baseline file (default: `arch-baseline.json`) |
| `--changed` | | Only report violations in files changed since base branch |
| `--base <branch>` | | Base branch for `--changed` (default: `main`) |
| `--format <format>` | | Output format: `terminal`, `json`, `github`, `auto` (default: `auto`) |
| `--watch` | `-w` | Watch for file changes and re-run (check command only) |
| `--config <path>` | | Path to config file |
| `--version` | `-v` | Show version number |
| `--help` | `-h` | Show help message |

## Config File

Optional `ts-archunit.config.ts` in your project root:

```typescript
import { defineConfig } from 'ts-archunit'

export default defineConfig({
  project: 'tsconfig.json',
  rules: ['arch.rules.ts'],
  baseline: 'arch-baseline.json',
  format: 'auto',
  watchDirs: ['src'],  // directories to watch in --watch mode
})
```

CLI flags override config file values. Config file overrides defaults.

## Rule Files

A rule file exports an array of rule builders:

```typescript
// arch.rules.ts
import { project, classes, modules, call } from 'ts-archunit'

const p = project('tsconfig.json')

export default [
  classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')),
  modules(p).that().resideInFolder('src/domain/**').should().notImportFromCondition('src/repositories/**'),
]
```

The CLI calls `.check()` on each builder. Rule files use the same API as test files — no new concepts.

## Watch Mode

`--watch` re-runs all rules when source files change:

```bash
npx ts-archunit check arch.rules.ts --watch
```

- Watches `src/` by default (configurable via `watchDirs` in config)
- Also watches the rule files themselves
- Debounces rapid saves (250ms window)
- Clears screen between runs, preserving scrollback
- Only triggers on `.ts` / `.tsx` / `.mts` / `.cts` file changes

**Note:** Watch mode does a full project reload on each change. For projects under 500 files, this is under 3 seconds. For larger projects, consider using `vitest --watch` with rules in test files instead.

**Linux users:** `fs.watch` with recursive watching may require increasing the inotify limit: `sudo sysctl fs.inotify.max_user_watches=524288`.
```

### Update `docs/.vitepress/config.ts`

Add CLI page to the sidebar under Reference:

```typescript
{
  text: 'Reference',
  items: [
    { text: 'CLI', link: '/cli' },
    { text: 'API Reference', link: '/api-reference' },
  ],
},
```

### Update `docs/getting-started.md`

Replace the brief CLI section with a link:

```markdown
## CLI

ts-archunit also runs standalone without a test runner. See the [CLI documentation](/cli) for all commands and options.
```

## Phase 5: Tests

### `tests/cli/watch.test.ts`

Watch mode is inherently async and filesystem-dependent. Test the components, not the full loop. Use `vi.useFakeTimers()` for deterministic debounce control:

1. **scheduleRun debounces rapid calls** — call trigger 5 times in 50ms, advance timers by 250ms, assert callback runs once
2. **scheduleRun ignores non-TS files** — `.json`, `.md` changes don't trigger
3. **pendingRerun triggers re-run after active run completes** — start a slow callback, trigger second change during it, assert callback runs twice total
4. **importFresh bypasses module cache** — write to temp file between imports, get different module content
5. **resetProjectCache resets singleton** — `project()` returns new instance after reset
6. **--watch flag parsed correctly** — `parseCliArgs(['check', '--watch', 'rules.ts'])` → `values.watch === true`
7. **-w shorthand works** — `parseCliArgs(['check', '-w', 'rules.ts'])` → same result
8. **watch with baseline command errors** — `run(['baseline', '--watch', 'rules.ts'])` → prints error, exitCode 1

### `tests/cli/watch-integration.test.ts`

One integration test with a real filesystem (skip on CI if flaky):

9. **Full loop: write file, detect change, re-run** — create a temp dir with a flat `.ts` file, start watch, modify it, assert `onChangeDetected` fires within 2 seconds

## Files Changed

| File | Change |
| --- | --- |
| `src/cli/watch.ts` | New — `watchAndRerun`, `importFresh`, SIGINT handler |
| `src/cli/index.ts` | Modified — add `--watch` / `-w` flag, `ParsedArgs.watch`, watch mode integration, `baseline --watch` error |
| `src/cli/config.ts` | Modified — add `watchDirs` to `CliConfig` |
| `src/cli/commands/check.ts` | Modified — accept `fresh` option for cache-busting imports |
| `src/cli/load-rules.ts` | Modified — add `importFresh` variant |
| `src/core/project.ts` | Modified — rename `_resetProjectCache` → `resetProjectCache` |
| `src/index.ts` | Modified — export `resetProjectCache` |
| `docs/cli.md` | New — full CLI documentation page |
| `docs/.vitepress/config.ts` | Modified — add CLI to sidebar |
| `docs/getting-started.md` | Modified — replace inline CLI section with link |
| `tests/cli/watch.test.ts` | New — 8 unit tests |
| `tests/cli/watch-integration.test.ts` | New — 1 integration test |

## Out of Scope

- **Incremental ts-morph refresh** — v1 does full reload. Optimize later if users report latency on large projects.
- **Deriving watch dirs from tsconfig `include`** — v1 reads `config.watchDirs` with `['src']` fallback. Smarter inference deferred.
- **File filtering (ignore patterns)** — `node_modules` is outside `src/`, so not an issue. Add `--ignore` later if needed.
- **Terminal UI (spinner, colors)** — keep it simple. Plain text output. Polish later.
- **`vitest --watch` integration** — users running rules via vitest already have watch via vitest. This is for CLI-only users.
- **Child-process isolation per run** — the proper fix for `importFresh` memory leak, but adds complexity. Defer unless users report memory issues.

# CLI

Run architecture rules without a test runner. The CLI wraps the same API you use in vitest/jest behind `npx ts-archunit` commands.

Most teams should put rules in test files and run them with vitest. The CLI is for teams that need standalone rule execution — pre-commit hooks, CI pipelines without a JS test runner, or one-off audits against unfamiliar codebases.

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

Records all existing violations so that `check --baseline` only fails on new ones. See [Gradual Adoption](/core-concepts#baseline-mode) for details.

### `explain` — Dump Rule Metadata

```bash
# JSON output (default)
npx ts-archunit explain arch.rules.ts

# Markdown table
npx ts-archunit explain arch.rules.ts --markdown

# Agent format — imperative markdown for a system prompt / project instructions
npx ts-archunit explain arch.rules.ts --format agent >> CLAUDE.md
```

Outputs a structured description of every rule — id, description, because, suggestion — without executing them. `--format agent` emits an imperative "Do NOT … / MUST …" block (with a check-in-loop preamble and sentinel markers) for AI coding agents — see [AI Agents](/ai-agents). See [Explain Command](/explain) for use cases.

## Options

| Flag                | Short | Description                                                           |
| ------------------- | ----- | --------------------------------------------------------------------- |
| `--baseline <path>` |       | Baseline file for filtering known violations                          |
| `--output <path>`   |       | Output path for baseline file (default: `arch-baseline.json`)         |
| `--changed`         |       | Only report violations in files changed since base branch             |
| `--base <branch>`   |       | Base branch for `--changed` (default: `main`)                         |
| `--format <format>` |       | Output format: `terminal`, `json`, `github`, `auto` (default: `auto`) |
| `--watch`           | `-w`  | Watch for file changes and re-run (check command only)                |
| `--config <path>`   |       | Path to config file                                                   |
| `--version`         | `-v`  | Show version number                                                   |
| `--help`            | `-h`  | Show help message                                                     |

## Config File

Optional `ts-archunit.config.ts` in your project root:

```typescript
import { defineConfig } from '@nielspeter/ts-archunit'

export default defineConfig({
  project: 'tsconfig.json',
  rules: ['arch.rules.ts'],
  baseline: 'arch-baseline.json',
  format: 'auto',
  watchDirs: ['src'], // directories to watch in --watch mode
})
```

CLI flags override config file values. Config file overrides defaults.

## Rule Files

A rule file **default-exports an array of rule builders**. `check` collects each
builder's violations, applies baseline/diff filtering, and reports them together:

```typescript
// arch.rules.ts
import { project, classes, modules, call } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

export default [
  classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')),
  modules(p)
    .that()
    .resideInFolder('src/domain/**')
    .should()
    .notImportFromCondition('src/repositories/**'),
]
```

Rule files use the same API as test files.

### Severity

Every rule is an **error** by default — a violation fails the run. Mark a rule as
a non-failing **warning** with the non-terminal `.asSeverity('warn')`; it is still
reported, but does not fail:

```typescript
export default [
  classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')), // error
  modules(p).that().resideInFolder('src/**').should().satisfy(noEmptyBodies()).asSeverity('warn'),
]
```

A preset that returns an array of builders spreads straight in:

```typescript
export default [...myPreset(p)]
```

`check` exits non-zero only when there are **error**-severity violations; warnings
are reported but never fail the run.

::: warning Leave rule-file builders un-terminated
In a rule file, entries in the `export default [...]` array must be **builders**,
not terminal calls. Do **not** end them with `.check()` / `.warn()` / `.severity()` —
those execute the rule immediately and return `undefined`, which the CLI silently
skips (the rule never runs in the aggregated report). Use the non-terminal
`.asSeverity('warn')` to mark a rule as a warning. (Test files are the opposite:
there you _do_ call `.check()`.)
:::

## JSON output (`--format json`)

`check --format json` emits a **single JSON document** for the whole run
(all rule files and builders aggregated — not one blob per rule), suitable for
CI dashboards, custom tooling, and AI coding agents that self-correct against
the rules. Each violation carries its `severity`, and the summary breaks the
count down into errors vs warnings:

```jsonc
{
  "summary": { "total": 2, "errors": 1, "warnings": 1, "reason": null },
  "violations": [
    {
      "rule": "…",
      "ruleId": "domain/no-parse-int",
      "severity": "error",
      "element": "OrderService.getTotal",
      "file": "src/domain/order.ts",
      "line": 42,
      "message": "…",
      "because": "…",
      "suggestion": "use this.extractCount()",
      "docs": "…",
    },
  ],
}
```

`because` / `suggestion` / `docs` come from the rule's `.because()` / `.rule({ … })`
metadata when the condition does not set its own — so consumers always get the
rule author's rationale and fix.

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
- Queues re-runs if a change arrives during an active check

For projects under 500 files, each re-run takes under 3 seconds. For larger projects, consider using `vitest --watch` with rules in test files instead.

**Linux users:** `fs.watch` with recursive watching may need a higher inotify limit:

```bash
sudo sysctl fs.inotify.max_user_watches=524288
```

## CI Integration

Architecture rules are tests. If your CI already runs `npm test`, it already runs architecture rules.

For standalone CI steps:

```yaml
# .github/workflows/ci.yml
- run: npx ts-archunit check arch.rules.ts --format github
```

The `--format github` flag emits violations as GitHub Actions annotations — they appear inline on PR diffs.

Use `--format auto` (the default) to auto-detect the environment.

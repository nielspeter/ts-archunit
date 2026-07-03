# Plan 0050: `ts-archunit init` CLI Scaffolder

## Status

- **State:** DRAFT — captured for decision, not yet scheduled
- **Priority:** TBD (likely P2 once approved)
- **Effort:** 0.5–1 day
- **Created:** 2026-05-05
- **Depends on:** Plan 0049 (`recommended()` preset) — the generated
  `arch.rules.ts` calls `recommended(p)` as its starter line. Plan 0020
  (existing CLI runner) already established the CLI infrastructure
  (`src/cli/`); this plan adds an `init` subcommand.

## Problem

Adopting ts-archunit currently requires a developer to:

1. Install the package.
2. Read the docs to learn the config shape.
3. Hand-author `arch.config.ts` with the right `defineConfig` call.
4. Hand-author `arch.rules.ts` with imports and rule chains.
5. Decide on baseline strategy and run `npx ts-archunit baseline` if
   adopting on an existing codebase.
6. Wire a `package.json` script entry.

That's six steps before the first violation report. Comparable tools
(`eslint --init`, `tsc --init`, `vitest`) handle 1–6 with a single
command. ts-archunit doesn't.

## Goal

```bash
npx ts-archunit init
```

Produces a working ts-archunit setup in the current directory in
under five seconds. Subsequent runs of `npx ts-archunit check` work
with zero further configuration.

## What `init` does

Generated files (defaults can be overridden by flags — see "API"):

### `arch.config.ts`

```typescript
import { defineConfig } from '@nielspeter/ts-archunit'

export default defineConfig({
  project: 'tsconfig.json',
  rules: ['arch.rules.ts'],
  baseline: 'arch-baseline.json',
  format: 'auto',
  watchDirs: ['src'],
})
```

### `arch.rules.ts`

```typescript
import { project, recommended } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// Sensible defaults for any TypeScript project.
// See https://nielspeter.github.io/ts-archunit/presets#recommended
recommended(p)

// Add project-specific rules below.
// Examples:
//   classes(p).that().resideInFolder('src/services/**')
//     .should().notContain(call('parseInt'))
//     .check()
//
//   modules(p).should().beFreeOfCycles().check()
```

### `arch-baseline.json`

Empty baseline (`{ "generatedAt": "...", "count": 0, "violations": [] }`)
so the first CI run doesn't fail on legacy violations. The user runs
`npx ts-archunit baseline` themselves to populate it from current
state when they're ready.

### `package.json` script entry

Adds (or reports if it already exists):

```json
{
  "scripts": {
    "arch": "ts-archunit check",
    "arch:baseline": "ts-archunit baseline"
  }
}
```

Does **not** modify other package.json fields. If the user has
existing `arch` or `arch:baseline` scripts, the command warns and
skips the script-modification step (writes a one-line note to stdout,
does not fail).

### Optional: vitest test wrapper

With `--with-vitest` flag, also generates
`tests/architecture.test.ts`:

```typescript
import { describe, it } from 'vitest'
import './arch.rules'

describe('architecture', () => {
  it('rules pass', () => {
    // arch.rules.ts runs at import time and throws on violation
  })
})
```

This integrates ts-archunit into existing vitest test runs without
the user needing a separate CI step.

## API

```bash
npx ts-archunit init [options]

Options:
  --preset <name>        Starter preset to wire into arch.rules.ts.
                         Default: 'recommended'. Other values:
                         'layered', 'data-layer', 'strict-boundaries'.
  --no-baseline          Skip arch-baseline.json creation.
  --with-vitest          Also generate tests/architecture.test.ts.
  --tsconfig <path>      Override tsconfig path. Default: 'tsconfig.json'.
  --force                Overwrite existing files. Default: refuse and exit
                         non-zero with a list of conflicts.
  --dry-run              Print what would be created; don't write.
```

No interactive prompts in v1. Flags cover every decision; users who
want to script the init or run it in CI get deterministic behavior.

## Behavior — existing files

`init` without `--force` is **non-destructive**:

- If any of the four files already exists, the command lists the
  conflicts and exits with code 1.
- `--force` overwrites without confirmation.
- `--dry-run` always succeeds and shows what would happen.

Rationale: `init` is run once per project. Overwriting existing user
config silently is the worst thing the command could do.

## Detection

The command does **not** auto-detect the project shape. No reading
`package.json` for `express`/`react`/etc. dependencies. ADR-006 places
framework rules in separate packages; baking framework detection into
the core scaffolder would either be incomplete or overstep.

What `init` _does_ detect:

- Presence of `tsconfig.json` in cwd. If missing, fail with a clear
  message ("ts-archunit needs a tsconfig.json — run `tsc --init` first
  or pass `--tsconfig <path>`").
- Presence of `package.json`. If missing, the script-entry step is
  skipped silently.
- Presence of vitest in `package.json` `dependencies` /
  `devDependencies`. If found and `--with-vitest` not specified,
  print a one-line tip: "Detected vitest — pass `--with-vitest` to
  generate a test wrapper."

## Implementation phases

### Phase 1 — Subcommand skeleton (~1 hour)

Add `init` to the CLI entry point in `src/cli/`. Wire flag parsing.
Implement file-conflict detection (no-write for now).

### Phase 2 — File generators (~2–3 hours)

- `arch.config.ts` template with simple substitution for `--tsconfig`.
- `arch.rules.ts` template with preset switch (`recommended`,
  `layered`, etc.).
- `arch-baseline.json` empty seed.
- `package.json` script-entry merge (read, parse, conditionally add,
  write back with original formatting preserved as much as possible —
  use the existing JSON the user has, don't normalize whitespace).
- `tests/architecture.test.ts` template (when `--with-vitest`).

### Phase 3 — Tests (~2 hours)

`tests/cli/init.test.ts`:

- Empty cwd — generates all four files, exits 0.
- Conflicting file present — exits 1, lists conflicts, writes nothing.
- `--force` overwrites cleanly.
- `--dry-run` writes nothing, prints plan.
- `--with-vitest` adds the test wrapper.
- Each `--preset` value generates the expected `arch.rules.ts` line.
- No `tsconfig.json` — exits 1 with helpful message.
- No `package.json` — generates the three .ts/.json files but skips
  script-entry (with a one-line stdout note).

### Phase 4 — Docs (~30 min)

- `docs/getting-started.md` opening section becomes "Run `npx ts-archunit
init`" with the command output.
- `docs/cli.md` adds the `init` subcommand.
- README "Install" section is updated to point at `init`.
- CHANGELOG entry.

## Files changed

| File                                   | Change                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| `src/cli/init.ts`                      | New — subcommand implementation                                       |
| `src/cli/index.ts` (or main entry)     | Wire `init` subcommand                                                |
| `src/cli/templates/arch.config.ts.tpl` | Template (string literal in code; not a separate file shipped to npm) |
| `src/cli/templates/arch.rules.ts.tpl`  | Template per preset                                                   |
| `tests/cli/init.test.ts`               | New                                                                   |
| `docs/getting-started.md`              | Lead with `init`                                                      |
| `docs/cli.md`                          | Document `init` subcommand                                            |
| `README.md`                            | Update Install section                                                |
| `CHANGELOG.md`                         | `### Added`                                                           |

No new runtime dependencies. Templates are inline TS strings in the
init implementation; no separate template files in the published package.

## Out of scope

- **Interactive prompts.** Inquirer-style menus add a dependency and
  a maintenance surface. Flags cover every decision today; if user
  research shows people want prompts later, add them additively.
- **Framework presets.** ADR-006 puts those in separate packages.
  `init` ships generic presets only.
- **Editing existing config.** `init` is creation-time, not migration.
  A separate `migrate` subcommand can come later for users upgrading
  from an old config shape.
- **Auto-running `npx ts-archunit baseline`.** Empty baseline is
  generated; the user runs the populate step when ready. This avoids
  surprising them with a baseline file full of violations they
  haven't reviewed.
- **Monorepo-aware initialization.** Users with multiple tsconfigs
  pass `--tsconfig` explicitly; full monorepo support is a separate
  plan.

## Strategic note

This plan turns the new-project onboarding from "read docs, write
six files, set up CI" to "two commands": `npx ts-archunit init`
and `npm run arch`. That's the bar `eslint --init` and `vitest`
established. Without it, ts-archunit's adoption story stalls at the
config-authoring step regardless of how good the rule library is.

The dependency on plan 0049 (`recommended()`) is real: without that
preset, the generated `arch.rules.ts` either calls nothing (worthless)
or is much longer (more brittle template, harder to keep current as
the rule library grows). Land 0049 first.

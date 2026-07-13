# Plan 0050: `ts-archunit init` CLI Scaffolder

## Status

- **State:** DRAFT — captured for decision, not yet scheduled
- **Review (2026-07-13):** Ship (after deps). **Decisions applied 2026-07-13:** (1) execution model — the generated `arch.rules.ts` uses the **returning form** (`export default [...recommended(p)]`), run by plan 0060's severity-aware unified pipeline (Option 2), so warns are baseline-filtered not lost; (2) generate the discoverable `ts-archunit.config.ts`, not `arch.config.ts`; (3) defer `--with-vitest` to a later version; (4) mechanical fixes (commands/init.ts, shared parseArgs + explicit `--no-baseline`, zero-dep package.json write, constrained `--preset`, write atomicity, specified closing message). Plan text ready; build scheduled last (after 0055/0047/0048/0049 + the `check` fix). See "Review findings" below.
- **Priority:** TBD (likely P2 once approved)
- **Effort:** 0.5–1 day
- **Created:** 2026-05-05
- **Depends on:** Plan 0049 (thin `recommended()` preset) — the generated
  `ts-archunit.config.ts` + `arch.rules.ts` call `recommended(p)` as the
  starter line via the **returning form** (`export default [...recommended(p)]`).
  **Plus plan 0060** (severity-aware unified `check` pipeline — Option 2, see
  "Execution model"). Plan 0020 (existing CLI runner) established the CLI
  infrastructure (`src/cli/`); this plan adds an `init` subcommand.

## Problem

Adopting ts-archunit currently requires a developer to:

1. Install the package.
2. Read the docs to learn the config shape.
3. Hand-author `ts-archunit.config.ts` with the right `defineConfig` call.
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

### `ts-archunit.config.ts`

Generated with the **discoverable** name `resolveConfig` looks for
(`ts-archunit.config.ts`/`.js`) — not `arch.config.ts`, which `check`
would never find, leaving `ts-archunit check` with no rules.

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

A builder-export rule file — `recommended(p)` returns severity-carrying
builders (plan 0049 / 0060 Option 2), spread into the default export alongside
any custom rules. `check` runs them through its unified pipeline, applying
baseline, format, and warn/error severity.

```typescript
import { project, recommended } from '@nielspeter/ts-archunit'
// Uncomment the imports you need for the examples below:
// import { classes, slices, call } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// Rules are collected into the default export; `ts-archunit check` runs them.
export default [
  // Thin universal safety floor (see plan 0049).
  ...recommended(p),

  // Add project-specific rules below — builders, no .check().
  // (Builders default to error; append .asSeverity('warn') to warn, not fail.)
  //   classes(p).that().resideInFolder('src/services/**')
  //     .should().notContain(call('parseInt')),
  //   slices(p).matching('src/feature-').should().beFreeOfCycles(),
]
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

### Deferred to a later version: `--with-vitest` wrapper

The `--with-vitest` flag (generate `tests/architecture.test.ts`) is
**deferred out of v1.** The obvious wrapper is subtly broken — importing
`./arch.rules` at the top of the test file throws during _test collection_
(a "failed to load test file" error, not a readable failing test), and it
bypasses `ts-archunit.config.ts`'s baseline. Doing it right means asserting
inside `it()` through the same config/baseline path as `check`, which is
more than v1 needs. Ship `init` without it; add a correct wrapper in a
follow-up if demand appears.

## Execution model — how the generated files run under `check`

`loadRuleFiles` (`src/cli/load-rules.ts`) accepts a rule file that
`export default`s an array of builders. The generated `arch.rules.ts` uses the
**returning form** (plan 0049 / 0060, Option 2): `recommended(p)` returns
severity-carrying builders, spread into the default export:

```typescript
export default [...recommended(p) /* custom builders */]
```

This flows through the standard builder-export path — no self-executing preset
call, no `ArchRuleError` to catch. Plan **0060** makes `runCheck` severity-aware
and baseline/format-uniform (collect `.violations()` + per-builder severity →
one pipeline), so the two `warn` rules in `recommended` are baseline-filtered
and formatted rather than lost — which is what makes the brownfield baseline
story (below) actually hold.

**Dependencies:** the returning form of `recommended` (plan 0049) and the
severity-aware unified pipeline (plan 0060). Verify with a **Phase 0 spike**
that `export default [...recommended(p)]` runs through `check` with warns
baseline-filtered and exit 0, error rules → exit 1, before writing templates.

(An earlier draft had the generated file call bare `recommended(p)`
self-executing, requiring `check` to catch import-time throws — plan 0060's
rejected catch-the-throw model. The returning form is cleaner and carries warn
severity, which the throwing model can't. **Shape-specific presets**
(`--preset layered|data-layer|strict-boundaries`) are throwing presets without
a returning form yet, so their generated file is a self-executing call handled
by 0060's best-effort fallback catch — error-severity only; noted in `--preset`
below.)

## API

```bash
npx ts-archunit init [options]

Options:
  --preset <name>        Starter preset wired into arch.rules.ts. Default:
                         'recommended'. Only presets the package actually
                         exports are accepted; shape-specific values
                         ('layered', 'data-layer', 'strict-boundaries')
                         generate the call with placeholder folder globs and
                         a fill-me-in comment (a bare call would instant-fail
                         on a mismatched layout).
  --no-baseline          Skip arch-baseline.json creation.
  --tsconfig <path>      Override tsconfig path. Default: 'tsconfig.json'.
  --force                Overwrite existing files. Default: refuse and exit
                         non-zero with a list of conflicts.
  --dry-run              Print what would be created; don't write.

(`--with-vitest` deferred — see "Deferred to a later version".)
```

No interactive prompts in v1. Flags cover every decision; users who
want to script the init or run it in CI get deterministic behavior.

## Behavior — existing files

`init` without `--force` is **non-destructive**:

- If any of the generated files already exists, the command lists the
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
- (vitest detection tip removed — `--with-vitest` is deferred out of v1;
  see "Deferred to a later version".)

## Implementation phases

### Phase 0 — `check` preset-style support spike (~30 min)

Prerequisite (see "Execution model"), specified as **plan 0060**. Confirm that
`export default [...recommended(p)]` runs through `check`'s severity-aware
unified pipeline: **error** rules → exit 1; the **warn** rules → formatted,
exit 0, and **baseline-filtered on re-run** (the brownfield story). Land plans
0049 (returning-form `recommended`) and 0060 before `init` proceeds.

### Phase 1 — Subcommand skeleton (~1 hour)

Add `src/cli/commands/init.ts` + a `handleInit` wrapper + an
`else if (command === 'init')` branch in `src/cli/index.ts` (the established
pattern — check/baseline/explain all live in `commands/*.ts`). **Extend the
single shared `parseArgs` options table** in `index.ts` (it runs `strict:true`,
so unknown flags throw). Node's `parseArgs` has no `--no-x` negation —
register `--no-baseline` as a distinct boolean and handle it explicitly.
Implement file-conflict detection (no-write for now).

### Phase 2 — File generators (~2–3 hours)

- `ts-archunit.config.ts` template (discoverable name) with `--tsconfig`
  substitution.
- `arch.rules.ts` template with a preset switch constrained to exported presets.
  Two subtleties the generator MUST handle: (a) **import specifier** — `recommended`
  is root-exported (`@nielspeter/ts-archunit`), but the shape presets export only
  from the `./presets` subpath, so `--preset layered|data-layer|strict-boundaries`
  must emit `import { ... } from '@nielspeter/ts-archunit/presets'` or the file
  crashes on load; (b) **name mapping** — kebab flag → export name
  (`layered`→`layeredArchitecture`, `data-layer`→`dataLayerIsolation`,
  `strict-boundaries`→`strictBoundaries`). Shape presets also get placeholder
  globs + a fill-me-in comment. `--tsconfig` substitution applies to BOTH
  `ts-archunit.config.ts` and the `project('tsconfig.json')` line in
  `arch.rules.ts` (the self-executing file is the sole tsconfig source under
  Option A) — otherwise the two diverge.
- `arch-baseline.json` empty seed.
- `package.json` script-entry merge: read, parse, conditionally add the
  scripts, write back with `JSON.stringify(pkg, null, detectedIndent) + '\n'`
  (detect the indent; **no new dependency** — drop the "preserve formatting
  exactly" promise a JSON round-trip can't keep).
- **Write atomicity:** stage all files and flush on success (temp + rename, or
  buffer then write), so a mid-run failure never leaves a half-scaffolded project.
- **Closing message (required):** after writing, print a next-steps block,
  branched on whether `src` is non-empty:
  - greenfield → "Created N files. Next: `npm run arch`."
  - existing code → also "Adopting on an existing codebase? Run
    `npm run arch:baseline` first to accept current violations as tracked
    legacy debt." The single most important UX artifact — how a brownfield
    user understands the first run's `warn`s.
  - **Warn-path (resolved via 0060 Option 2):** because `recommended()` returns
    severity-carrying builders and the CLI pipeline baseline-filters warns, the
    two `warn` rules ARE silenced by `arch:baseline` — so the brownfield message
    is accurate. (This is why 0060 is a hard dependency.)
  - Source-root detection for the greenfield/brownfield branch (and the
    generated `watchDirs`) should derive from the tsconfig `include`/`rootDir`,
    not a hardcoded `src` — projects using `lib/`, `app/`, or `packages/*/src`
    would otherwise be misclassified as greenfield.

### Phase 3 — Tests (~2 hours)

`tests/cli/init.test.ts`:

- Empty cwd — generates the three files (`ts-archunit.config.ts`,
  `arch.rules.ts`, `arch-baseline.json`), exits 0.
- Generated project runs: `ts-archunit check` discovers the config and loads
  the preset-style `arch.rules.ts` cleanly (depends on Phase 0).
- Conflicting file present — exits 1, lists conflicts, writes nothing.
- Mid-run write failure leaves nothing (atomicity).
- `--force` overwrites cleanly.
- `--dry-run` writes nothing, prints plan.
- Each accepted `--preset` value generates the expected `arch.rules.ts` line.
- Closing message: brownfield (non-empty `src`) includes the baseline step;
  greenfield does not.
- No `tsconfig.json` — exits 1 with helpful message.
- No `package.json` — generates the .ts/.json files but skips script-entry
  (one-line stdout note).
- **Generated examples typecheck** — extract the commented example lines from
  the `arch.rules.ts` template, uncomment, and `tsc` them, so template drift
  (wrong API / missing imports) is caught. (The examples use `classes`/`call`
  and `slices().matching().beFreeOfCycles()`, with matching import hints.)

### Phase 4 — Docs (~30 min)

- `docs/getting-started.md` opening section becomes "Run `npx ts-archunit
init`" with the command output.
- `docs/cli.md` adds the `init` subcommand.
- README "Install" section is updated to point at `init`.
- CHANGELOG entry.

## Files changed

| File                       | Change                                                                 |
| -------------------------- | ---------------------------------------------------------------------- |
| `src/cli/commands/init.ts` | New — subcommand implementation (inline string templates)              |
| `src/cli/index.ts`         | Wire `init` branch + extend shared `parseArgs` (incl. `--no-baseline`) |
| `tests/cli/init.test.ts`   | New                                                                    |

(The `check` runner / `loadRuleFiles` / severity-primitive changes that make the generated `export default [...recommended(p)]` run are in **plan 0060**, not here.)
| `docs/getting-started.md` | Lead with `init` |
| `docs/cli.md` | Document `init` subcommand |
| `README.md` | Update Install section |
| `CHANGELOG.md` | `### Added` |

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

The dependencies are real: **plan 0049** (thin `recommended()`) gives the
generated file its one-line anchor, and **plan 0060** (the `check`
preset-style fix) is what lets that file run at all under `ts-archunit check`.
Land both before `init`.

## Review findings — 2026-07-13

Reviewed via the `review-proposal` skill (architect + product lenses), grounded against `resolve-config.ts`, `load-rules.ts`, `cli/index.ts`, `cli/config.ts`. Existing-code survey: **no duplication** — `init` is new and the CLI infra it extends (commands dispatch, `defineConfig`/`CliConfig`, `runBaseline`) all exist.

**Verdict: Rewrite the plan.** Right idea and right scope instincts, but as drafted it generates a project that fails — or silently false-passes — on the first run.

### Blocking (fix before implementation)

- **RESOLVED 2026-07-13 — generate `ts-archunit.config.ts`.** The discoverable name `resolveConfig` (`src/cli/resolve-config.ts:5`) actually searches for. `arch.config.ts` (undiscoverable) is gone; "zero further configuration" now holds.
- **RESOLVED 2026-07-13 — Option A.** Confirmed against `load-rules.ts`: `loadRuleFiles` only accepts a default-export of builders, so a bare `recommended(p)` file silently passes on zero rules or crashes on import-throw. Fix: teach `check`/`loadRuleFiles` to support preset-style self-executing files (wrap import, catch `ArchRuleError`, extract violations) — mirrors 0044's MCP execution model, independently valuable. The generated file stays a simple `recommended(p)` call. Gated by a Phase 0 spike. `--with-vitest` (the contradicting consumer) is deferred out of v1. See "Execution model."

### Should-fix

All RESOLVED 2026-07-13 in the plan body:

- File placement → `src/cli/commands/init.ts` + dispatch branch (Phase 1).
- Flags → extend the shared `parseArgs` table; `--no-baseline` handled explicitly (Phase 1).
- package.json write → zero-dep detect-indent path; fidelity promise dropped (Phase 2).
- `--preset` → constrained to exported presets; shape-specific presets get placeholder globs + a comment (API + Phase 2).
- Write atomicity → temp+rename / stage-then-flush (Phase 2).
- Closing message → specified, branched on brownfield vs greenfield (Phase 2).
- `--with-vitest` → deferred out of v1 (see "Deferred to a later version").

### Praise

- No-interactive-prompts, non-destructive-unless-`--force` + `--dry-run`, inline templates (not shipped `.tpl` files), and no framework auto-detection (ADR-006) are all correct calls.

**Next step:** gate behind a fixed 0049; fix the two blocking bugs (config name + execution model) in the plan first; then it's a real 0.5–1 day.

# Plan 0050: `ts-archunit init` CLI Scaffolder

## Status

- **State:** READY TO BUILD — dependencies shipped in v0.13.0 (2026-07-13); a 0.5-day build.
- **Review round 2 (2026-07-13):** full-panel review (architect + product + customer + devops) against shipped v0.13.0 code. Verdict: buildable after five fixes, all folded into the body below —
  1. **Shape presets gated out of v1.** `--preset layered|data-layer|strict-boundaries` are throwing/self-executing (no returning form), so they'd (a) crash the generated `arch:baseline` (`runBaseline` doesn't catch `ArchRuleError` the way `runCheck` does) and (b) produce a file that can't compose with spread presets. `init` v1 offers only the two returning-form presets.
  2. **`agent-guardrails` added as a `--preset`** + signposting in the scaffold + closing message — the library's flagship use case must be reachable from its front door.
  3. **Dead config fields removed.** `config.project` is read nowhere in the CLI, and `watchDirs` isn't even loaded by `resolveConfig`'s `extractDefault`. Both dropped from the generated `ts-archunit.config.ts`; the live tsconfig source is the `project(...)` call in `arch.rules.ts`.
  4. **Source-root threaded into `recommended(p, { include })`** so a `lib/`-rooted project doesn't get a floor matching zero files.
  5. **Baseline/CI story corrected.** The empty baseline is an inert placeholder, not CI protection — `recommended` ships two `error` rules (`no-eval`, `no-function-constructor`) that hard-fail on legacy code, so brownfield teams must run `arch:baseline` **before** gating CI. Message fixes: no-`package.json` → `npx` (not `npm run`), conflict output names `--force`/`--dry-run`, brownfield message states "errors fail CI, warnings don't."
- **Review round 1 / rebase on v0.13.0 (2026-07-13):** both hard dependencies shipped — plan 0049 (`recommended()` returning form) and plan 0060 (severity-aware unified `check` pipeline). Phase 0 (the execution-model spike) is **satisfied by the release** (see `tests/integration/recommended-check.test.ts`), not a prerequisite. All presets are exported only from the `./presets` subpath, not the package root — only `project` comes from `@nielspeter/ts-archunit`; the generated `arch.rules.ts` splits its imports accordingly.
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

Only the fields the CLI actually consumes are emitted: `rules`, `baseline`,
`format`. **`project` and `watchDirs` are deliberately omitted** — `config.project`
is read nowhere in the CLI (the live tsconfig source is the `project(...)` call
in `arch.rules.ts`), and `watchDirs` isn't loaded by `resolveConfig`'s
`extractDefault` at all. Emitting either would be a trust trap: a declared field
that silently does nothing.

```typescript
import { defineConfig } from '@nielspeter/ts-archunit'

export default defineConfig({
  // The active tsconfig is set in arch.rules.ts via project('tsconfig.json').
  rules: ['arch.rules.ts'],
  baseline: 'arch-baseline.json',
  format: 'auto',
})
```

If `--no-baseline` is passed, the `baseline` field is omitted too (no point
referencing a file that was never created).

### `arch.rules.ts`

A builder-export rule file — the chosen preset returns severity-carrying
builders (plan 0049 / 0060 Option 2), spread into the default export alongside
any custom rules. `check` runs them through its unified pipeline, applying
baseline, format, and warn/error severity.

Default (`--preset recommended`). When the detected source root is not `src`,
the generator passes it through as `recommended(p, { include: '**/<root>/**' })`
so the floor actually matches your files (the preset's own default is
`'**/src/**'`):

```typescript
import { project } from '@nielspeter/ts-archunit'
import { recommended } from '@nielspeter/ts-archunit/presets'
// Uncomment the imports you need for the examples below:
// import { classes, slices, call } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// Rules are collected into the default export; `ts-archunit check` runs them.
export default [
  // Thin universal safety floor (see plan 0049).
  ...recommended(p),

  // Using an AI coding agent? Swap in agentGuardrails — it targets the
  // mistakes agents make most (inline logic, generic errors, stubs,
  // empty bodies, copy-paste), and `npx ts-archunit explain --format agent`
  // emits an imperative rules block for the agent's system prompt.
  // See docs/ai-agents.md. Import from '@nielspeter/ts-archunit/presets'.
  //   ...agentGuardrails(p, { src: 'src/**' }),

  // Add project-specific rules below — builders, no .check().
  // (Builders default to error; append .asSeverity('warn') to warn, not fail.)
  //   classes(p).that().resideInFolder('src/services/**')
  //     .should().notContain(call('parseInt')),
  //   slices(p).matching('src/feature-').should().beFreeOfCycles(),
]
```

For `--preset agent-guardrails`, the generator leads with
`...agentGuardrails(p, { src: '<root>/**' })` (same returning form, same
`./presets` import) and moves the `recommended` line into the commented block.

### `arch-baseline.json`

Empty baseline (`{ "generatedAt": "...", "count": 0, "violations": [] }`) — an
**inert placeholder** so `check` finds the file the config points at. It does
**not** protect the first CI run: an empty baseline filters nothing
(`baseline.filterNew` against an empty known-set is a no-op). `recommended`
happens to be mostly `warn` (which never fails the build), but it ships two
`error` rules — `no-eval` and `no-function-constructor` — that **will** hard-fail
on any legacy `eval` / `new Function`. So on a brownfield codebase the safe order
is: run `npx ts-archunit baseline` to snapshot current violations as tracked
legacy debt, commit it, **then** wire `arch` into CI. Do not gate CI on `arch`
before the baseline is populated. (The empty seed is auto-generated; populating
it is a deliberate user step so they never rubber-stamp unreviewed debt.)

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

**Dependencies (both shipped in v0.13.0):** the returning form of `recommended`
(plan 0049) and the severity-aware unified pipeline (plan 0060). The contract
`init` relies on — `export default [...recommended(p)]` running through `check`
with warns baseline-filtered / exit 0 and error rules → non-zero exit — is
already proven by `tests/integration/recommended-check.test.ts`, so no spike is
needed before writing templates (see Phase 0).

Both v1 presets — `recommended` and `agentGuardrails` — use this returning form,
so **every file `init` emits is a spreadable `export default [...]` array**: a
user can add the other preset or custom builders by dropping another line in.

**Why shape presets are excluded from `init` v1** (review round 2): the shape
presets (`layeredArchitecture`/`dataLayerIsolation`/`strictBoundaries`) are
throwing/self-executing — they call `throwIfViolations` at import and have no
returning form. Two concrete failures if `init` generated them: (a) the generated
`arch:baseline` script crashes, because `runBaseline` calls `loadRuleFiles` bare
(no `try/catch` around `ArchRuleError`, unlike `runCheck`), and a void
self-executing preset exports no builders for `collectViolations` to see anyway;
(b) the resulting file is a self-executing statement, not a spreadable array, so
it can't compose with `recommended`/`agentGuardrails`. `init` v1 therefore offers
only the returning-form presets. Add shape presets to `init` once they gain a
returning form (tracked separately).

## API

```bash
npx ts-archunit init [options]

Options:
  --preset <name>        Starter preset wired into arch.rules.ts. One of:
                         'recommended' (default) | 'agent-guardrails'. Both are
                         returning-form presets, so the generated file is a
                         spreadable `export default [...]`. Shape presets
                         (layered/data-layer/strict-boundaries) are NOT accepted
                         in v1 — they're throwing/self-executing and would crash
                         the generated `arch:baseline`; add them by hand for now.
                         An unrecognized value exits 1 listing the valid names.
  --no-baseline          Skip arch-baseline.json creation (and omit the
                         `baseline` field from the generated config).
  --tsconfig <path>      Override tsconfig path. Default: 'tsconfig.json'.
  --force                Overwrite existing files. Default: refuse and exit
                         non-zero with a list of conflicts and the hint to
                         re-run with --force (overwrite) or --dry-run (preview).
  --dry-run              Print what would be created; don't write.

(`--with-vitest` deferred — see "Deferred to a later version".)
```

No interactive prompts in v1. Flags cover every decision; users who
want to script the init or run it in CI get deterministic behavior.

## Behavior — existing files

`init` without `--force` is **non-destructive**:

- If any of the generated files already exists, the command lists the
  conflicts **and names the escape hatch** — "re-run with `--force` to
  overwrite or `--dry-run` to preview" — then exits with code 1. Listing
  conflicts without the way out is half a message.
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
- Presence of `package.json`. If missing (or unparseable — see Phase 2), the
  script-entry step is skipped with a **one-line note**, and the closing
  message points at `npx ts-archunit check` instead of `npm run arch` (which
  wouldn't exist). Not silent: silence plus a "Next: `npm run arch`" line that
  can't work is worse than saying what was skipped.
- (vitest detection tip removed — `--with-vitest` is deferred out of v1;
  see "Deferred to a later version".)

## Implementation phases

### Phase 0 — execution-model spike (SATISFIED by v0.13.0)

This spike is **already proven** by the shipped release. Plans 0049
(returning-form `recommended`) and 0060 (severity-aware unified `check`
pipeline) landed in v0.13.0, and `tests/integration/recommended-check.test.ts`
demonstrates the exact contract `init` relies on: `export default
[...recommended(p)]` runs through `check` with **error** rules → non-zero exit
and the **warn** rules formatted, exit 0, and baseline-filterable (the
brownfield story). No spike needed before Phase 1 — build straight through.

### Phase 1 — Subcommand skeleton (~1 hour)

Add `src/cli/commands/init.ts` + a `handleInit` wrapper + an
`else if (command === 'init')` branch in `src/cli/index.ts` (the established
pattern — check/baseline/explain all live in `commands/*.ts`). Three integration
points in `index.ts`, not one:

1. **Extend the shared `parseArgs` options table** (it runs `strict:true`, so
   unknown flags throw). Node's `parseArgs` has no `--no-x` negation — register
   `--no-baseline` as a distinct boolean and handle it explicitly.
2. **Extend the `ParsedArgs.values` interface** with the new fields (`preset`,
   `tsconfig`, `force`, `dry-run`, `no-baseline`) — it's hand-maintained, and
   under ADR-005 (no `any`) `handleInit` won't typecheck otherwise.
3. **Update `HELP_TEXT`** to list the `init` subcommand and its flags — else
   `ts-archunit --help` never mentions it.

`handleInit` returns/sets the exit code (0 success, 1 on conflict / bad
`--preset` / missing tsconfig), mirroring how `handleCheck` maps its result.
Implement file-conflict detection (no-write for now).

### Phase 2 — File generators (~2–3 hours)

- **Source-root detection first** — derive the project's source root from the
  tsconfig `include`/`rootDir` (fall back to `src`). This one value feeds three
  places and they must agree: the preset `include`/`src` option, the
  greenfield-vs-brownfield closing-message branch (is the root dir non-empty?),
  and any path the message prints. A `lib/`-rooted project misclassified as `src`
  gets a floor matching zero files — a false green.
- `ts-archunit.config.ts` template — emit only `rules`/`baseline`/`format` (no
  `project`/`watchDirs`; see the config section). `--tsconfig` substitution
  applies to the `project('<tsconfig>')` line in `arch.rules.ts` (the sole live
  tsconfig source). Omit the `baseline` field when `--no-baseline`.
- `arch.rules.ts` template with a preset switch over the **two returning-form
  presets only** (`recommended` default, `agent-guardrails`). Import rule: the
  preset comes from `@nielspeter/ts-archunit/presets`, `project` from
  `@nielspeter/ts-archunit` — a bare `import { recommended } from
'@nielspeter/ts-archunit'` crashes on load (verified against `src/index.ts` /
  the package `exports` map, v0.13.0). Thread the detected source root into the
  preset call: `recommended(p, { include: '**/<root>/**' })` (omit the option
  when root is `src`, since that's the preset default) / `agentGuardrails(p, {
src: '<root>/**' })`. Include the agent-signposting comment block (see the
  template above) so the AI-agent path is discoverable from the default scaffold.
- `arch-baseline.json` empty seed (omitted under `--no-baseline`).
- `package.json` script-entry merge — **read-and-validate everything before any
  write** (see atomicity): read the file, `JSON.parse` it inside a try, and on
  parse failure (JSON5/comments/BOM/malformed) skip the script step with a
  one-line note — the same graceful path as "no package.json", never a mid-run
  crash. Extract `scripts` via a type-guard, not `as`/`any` (ADR-005; do NOT copy
  the existing `index.ts:15` `as` cast). Conditionally add `arch`/`arch:baseline`
  (skip + note if either exists). Write back with `JSON.stringify(pkg, null,
detectedIndent)`, preserving the file's existing **EOL and trailing-newline**
  state (detect `\r\n` vs `\n` and whether a final newline was present) so a
  two-line scripts change doesn't reformat the whole file / flip line endings on
  Windows and dirty git. **No new dependency.**
- **Write atomicity:** do all reads + parses + conflict checks up front (fail
  before writing anything), then stage every file and flush last (temp + rename,
  or buffer then write), so a mid-run failure never leaves a half-scaffolded
  project.
- **Closing message (required):** after writing, print a next-steps block. The
  run-the-check line branches on whether a `package.json` script was added:
  `npm run arch` if so, else `npx ts-archunit check`. Then, branched on whether
  the detected source root is non-empty:
  - greenfield (empty/absent source root) → "Created N files. Next: `<run cmd>`."
  - existing code → also: "This codebase already has source — errors fail the
    build, warnings are advisory and never fail CI. To accept current violations
    as tracked legacy debt before gating CI, run `npm run arch:baseline` (or
    `npx ts-archunit baseline`) and commit the result." This is the single most
    important UX artifact — it must state (a) that warnings don't fail CI and
    (b) that baseline precedes CI gating (the empty baseline does NOT protect the
    first run; `recommended`'s two `error` rules can fail on legacy `eval`/`new
Function`).

### Phase 3 — Tests (~2 hours)

`tests/cli/init.test.ts`:

- Empty cwd — generates the three files (`ts-archunit.config.ts`,
  `arch.rules.ts`, `arch-baseline.json`), exits 0.
- Generated project runs: `ts-archunit check` discovers the config and loads
  the preset-style `arch.rules.ts` cleanly (proven end-to-end, per Phase 0).
- `--preset recommended` (default) and `--preset agent-guardrails` each generate
  the expected import + spread line, both importing the preset from `./presets`.
- An invalid `--preset` (e.g. `layered`, `nope`) exits 1 and lists the valid
  names — shape presets are rejected in v1.
- Config omits `project` and `watchDirs`; contains `rules`/`baseline`/`format`.
- Source root ≠ `src` (e.g. tsconfig `include: ['lib']`): the generated preset
  call carries `include: '**/lib/**'` (recommended) / `src: 'lib/**'` (agent), and
  the brownfield/greenfield branch keys off `lib`, not `src`.
- Conflicting file present — exits 1, lists conflicts, **names `--force`/`--dry-run`**, writes nothing.
- Mid-run/failed write leaves nothing (atomicity: reads+parses precede writes).
- `--force` overwrites cleanly.
- `--dry-run` writes nothing, prints plan.
- `--no-baseline` — no `arch-baseline.json`, and the config omits the `baseline` field.
- Closing message: brownfield (non-empty source root) states "warnings never fail
  CI" **and** the baseline-before-CI step; greenfield does neither.
- No `tsconfig.json` — exits 1 with helpful message.
- No `package.json` — generates the .ts/.json files, skips script-entry with a
  one-line note, and the closing message says `npx ts-archunit check` (not `npm run arch`).
- **Unparseable `package.json`** (comments / trailing comma) — skips script-entry
  gracefully (no crash), still writes the other files.
- **package.json merge preserves formatting** — a fixture with 4-space indent and
  no trailing newline keeps its indent and newline state; only `scripts` changed,
  other fields and key order intact.
- **Generated examples typecheck** — extract the commented example lines from
  the `arch.rules.ts` template (including the `agentGuardrails` line), uncomment,
  and `tsc` them, so template drift (wrong API / missing imports) is caught. (The
  examples use `agentGuardrails`, `classes`/`call`, and
  `slices().matching().beFreeOfCycles()`, with matching import hints.)

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
| `docs/getting-started.md`  | Lead with `init`                                                       |
| `docs/cli.md`              | Document `init` subcommand                                             |
| `README.md`                | Update Install section                                                 |
| `CHANGELOG.md`             | `### Added`                                                            |

The `check` runner / `loadRuleFiles` / severity-primitive changes that make the
generated `export default [...recommended(p)]` run shipped in **plan 0060**
(v0.13.0) — this plan adds only the `init` subcommand on top.

No new runtime dependencies. Templates are inline TS strings in the
init implementation; no separate template files in the published package.

## Out of scope

- **Interactive prompts.** Inquirer-style menus add a dependency and
  a maintenance surface. Flags cover every decision today; if user
  research shows people want prompts later, add them additively.
- **Framework presets.** ADR-006 puts those in separate packages.
  `init` ships generic presets only.
- **Shape presets in `init`** (`layered`/`data-layer`/`strict-boundaries`).
  Deferred until they gain a returning form — as throwing/self-executing presets
  they'd crash the generated `arch:baseline` and can't compose with spread
  presets (see "Execution model"). Users wanting a layered scaffold add the call
  by hand today; `init` will offer them once the returning form exists.
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

**Verdict: Ready to build.** Original review said "rewrite" because the draft generated a project that failed (undiscoverable config name) or silently false-passed (execution model). Both are now resolved in the plan body, and both dependencies shipped in v0.13.0 — see the two blocking items below, both closed.

### Blocking (both resolved)

- **RESOLVED 2026-07-13 — generate `ts-archunit.config.ts`.** The discoverable name `resolveConfig` (`src/cli/resolve-config.ts:5`) actually searches for. `arch.config.ts` (undiscoverable) is gone; "zero further configuration" now holds.
- **RESOLVED / SUPERSEDED (v0.13.0) — returning form, not catch-the-throw.** The original resolution proposed teaching `check` to catch import-time throws from a self-executing `recommended(p)` file. That model was **rejected** in favour of plan 0060's **returning form**: the generated file is `export default [...recommended(p)]` (severity-carrying builders), which flows through `loadRuleFiles`' standard builder-export path — no throw to catch, and warns carry real severity (which the throwing model couldn't). This shipped in v0.13.0; the authoritative description is under "Execution model" above. (The shape presets, which still lack a returning form, are the one case handled by 0060's best-effort fallback catch — error-severity only.)

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

## Review findings — 2026-07-13 (round 2, full panel)

Architect + product + customer + devops, grounded against shipped v0.13.0 code. Verdict: **buildable after five fixes, all folded into the body above.**

- **RESOLVED — shape presets gated out of v1.** Architect confirmed `runBaseline` (`src/cli/commands/baseline.ts`) calls `loadRuleFiles` bare (no `ArchRuleError` catch), so a generated shape-preset `arch:baseline` crashes; and a void self-executing preset exports no builders anyway. Product added the composition-cliff angle (a self-executing file can't spread other presets). `--preset` now offers only the returning-form presets (API + Execution model + Out of scope).
- **RESOLVED — `agent-guardrails` surfaced.** Product: the flagship use case was invisible in the front-door command. Added as a `--preset`, in the default scaffold's comment block (with an `explain --format agent` pointer), and in the docs step (API + `arch.rules.ts` template + Phase 4).
- **RESOLVED — dead config fields removed.** Architect + customer: `config.project` is read nowhere and `watchDirs` isn't loaded by `extractDefault`. Both dropped from the generated config; the `project(...)` call in `arch.rules.ts` is the sole live tsconfig source (config section + Phase 2). Stale "self-executing file is the sole tsconfig source" line corrected.
- **RESOLVED — source root threaded into the preset.** Architect + devops: bare `recommended(p)` defaults `include` to `**/src/**`, so a `lib/` project got a floor matching zero files while `watchDirs` said `lib`. The detected root now feeds the preset `include`/`src` option, the closing-message branch, and printed paths (Phase 2, first bullet).
- **RESOLVED — baseline/CI story corrected.** DevOps: the empty baseline filters nothing; `recommended`'s two `error` rules can hard-fail on legacy `eval`/`new Function`, so brownfield teams must baseline before gating CI. Rewrote the `arch-baseline.json` rationale and the closing message (states warnings don't fail CI + baseline-before-CI). Customer message fixes folded in: no-`package.json` → `npx`, conflict output names `--force`/`--dry-run`.
- Additional folded fixes: `HELP_TEXT` + `ParsedArgs` interface added to Phase 1 scope; package.json merge now reads-and-parses before any write, handles unparseable manifests gracefully, preserves EOL/trailing-newline, and uses an ADR-005 type-guard (not `as`).

**Next step:** build straight through — dependencies shipped, all blocking items resolved in the plan body. A real 0.5–1 day.

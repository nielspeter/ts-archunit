# Plan 0055: `tsconfig()` Config-Assertion Rule

## Status

- **State:** DRAFT — captured for decision, not yet scheduled
- **Review (2026-07-13):** Ship with changes — cleanest of the open plans. **API locked: flat `tsconfig(p)` (no namespace).** Remaining: 4 mechanical fixes (createViolation, STRICT_FAMILY, `as` cast, array/object compare). Plan text ready; build scheduled later. See "Review findings" below.
- **Priority:** TBD (likely P2 once approved)
- **Effort:** 0.5–1 day
- **Created:** 2026-05-12
- **Revised:** 2026-05-12 — after review + framework-mindset re-read. Plan rewritten to fit existing `TerminalBuilder` architecture; `recommended()` integration dropped.
- **Depends on:** Nothing. Stands alone. Complements plans 0047 (TS escape hatches) and 0048 (`@deprecated`) by closing the upstream config-drift hole they assume is already closed by tsc.

## Problem

ts-archunit's code-level rules — `noTypeAssertions`, `noNonNullAssertions`, `noAnyProperties`, and the matcher set in plan 0047 — all assume the project's TypeScript strict flags are turned on. None of them detect what tsc would have flagged itself.

The flags are upstream of everything:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Today nothing in the toolchain prevents a teammate from silently flipping `strict: false` during a refactor to make tsc green. The build passes. The code-level rules in ts-archunit keep passing — they're inspecting code that tsc already let slide. Drift goes undetected.

This is exactly the failure mode EESS is built to prevent: a configuration claim ("we are a strict TypeScript project") not enforced by the system that ships the claim.

ts-archunit is a generic framework — vitest, ESLint, jest. It should not pick a side on the user's intended strictness. It should provide a **primitive** that lets any project assert any compiler-options shape it cares about, and let users compose those assertions into their own rules and presets.

## Goal

Ship one primitive that asserts the project's resolved TypeScript compiler options match a user-supplied spec. Same fluent terminal methods as every other rule, same baseline/exclusion/format integration, no new top-level architecture.

```typescript
import { project, tsconfig } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

tsconfig(p)
  .requires({ strict: true, noUncheckedIndexedAccess: true })
  .because('ADR-001 requires strict mode')
  .check()
```

That's the whole API surface. No `recommended()` change. No curated flag list. No invented matcher abstraction.

## Architecture fit

This rule slots into the **existing** non-iterating builder pattern. It is not a new category.

### How it joins what's already there

| Existing concept                                                                                     | Where it lives                   | This plan reuses it via                                                                       |
| ---------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `TerminalBuilder` (abstract base)                                                                    | `src/core/terminal-builder.ts`   | `TsconfigBuilder extends TerminalBuilder`                                                     |
| Non-iterating builder precedent                                                                      | `SmellBuilder` (`src/smells/`)   | Same pattern — concrete subclass implements `collectViolations()`                             |
| Top-level entry-point precedent                                                                           | `project(p)`, `smells.duplicateBodies(p)` | New flat `tsconfig(p)` entry point                                                   |
| `.because()` / `.rule()` / `.excluding()` / `.check()` / `.warn()` / `.severity()` / `.violations()` | Inherited from `TerminalBuilder` | Inherited the same way                                                                        |
| Baseline / diff / format pipeline                                                                    | `executeCheck`, `executeWarn`    | Inherited via `TerminalBuilder.check()`                                                       |
| `ArchProject.getSourceFiles()` pattern (public, not `_project`)                                      | `src/core/project.ts`            | Add `getCompilerOptions()` to `ArchProject` interface; builder reads via the public interface |
| `createViolation()`                                                                                  | `src/core/violation.ts`          | Used as-is; tsconfig path becomes the violation's `file`, line `1`                            |

No new top-level architecture. One new `TerminalBuilder` subclass; one new top-level entry point; one new public method on `ArchProject`. Everything else is reuse.

### Why not the fluent element-builder DSL

The element-builder DSL (`entry(p).that().<predicate>.should().<condition>.check()`) iterates over a set of elements. A project has one resolved compiler-options object. The smell detectors hit the same situation — they don't iterate per-element either — and the codebase already answered the question: extend `TerminalBuilder`, expose as a top-level entry point (like `project` / `smells`). Follow the same answer.

### Lego bricks

Two bricks:

1. **`TsconfigBuilder`** — generic shape: "for this project, the resolved compiler options must satisfy the requirements set by `.requires(...)`." Reusable. Composable with `.because()`, `.rule()`, `.excluding()`, `.check()`, `.warn()`. Same surface as every other terminal builder.
2. **`Partial<CompilerOptions>` as the spec input** — the user's data, not an invented matcher language. Whatever ts-morph hands you, you can require. No hand-curated allowlist of flags.

Future bricks (out of scope; no namespace reserved now — `tsconfig` is the
only foreseen config assertion):

- If `packageJson(p)` / `nodeVersion(p)` assertions ever emerge, add them as
  their own flat entry points, or introduce a (non-`config`-named) namespace
  at that point. Don't pre-commit the grouping on speculation.

The brick that does _not_ exist in this plan is "a generic project-config matcher abstraction." That would be premature. tsconfig assertions are flat key-value comparisons; package.json assertions will want semver, dep allowlists, script keys — a different shape. Solve each when its real shape is known.

## API

### Public surface

```typescript
// In src/index.ts — new exports alongside existing `project` / `smells` exports.
export { tsconfig } from './tsconfig/index.js'
export { TsconfigBuilder } from './tsconfig/tsconfig-builder.js'
```

### Entry point + builder

```typescript
// src/tsconfig/index.ts
import type { ArchProject } from '../core/project.js'
import { TsconfigBuilder } from './tsconfig-builder.js'

/**
 * Assert facts about the resolved TypeScript compiler options.
 *
 * Returns a builder extending TerminalBuilder, with the same
 * .because() / .rule() / .excluding() / .check() / .warn() surface as the
 * rest of the library. A flat top-level entry point like `project` / `smells`
 * — deliberately not a `config` namespace, which would collide with the
 * existing `defineConfig` / `CliConfig` ("configure the tool") surface.
 */
export function tsconfig(project: ArchProject): TsconfigBuilder {
  return new TsconfigBuilder(project)
}
```

### `.requires()`

```typescript
// src/tsconfig/tsconfig-builder.ts (signature only)

import type { CompilerOptions } from 'ts-morph'
import { TerminalBuilder } from '../core/terminal-builder.js'

export class TsconfigBuilder extends TerminalBuilder {
  /**
   * Additively merge a partial compiler-options spec into the requirements
   * for this rule. Each present key must equal the project's resolved value
   * (or be implied by `strict: true` for the strict-family flags).
   *
   * Multiple .requires() calls are merged; later keys win on conflict.
   */
  requires(spec: Partial<CompilerOptions>): this {
    /* ... */
  }
}
```

**`Partial<CompilerOptions>` is ts-morph's own type alias** (re-exported from the TypeScript compiler). Users get full type safety, full IDE autocompletion, and zero hand-curated flag lists in this library. New flags from future TS versions land automatically.

### Strict-family resolution

`getCompilerOptions()` returns the resolved options after `extends` resolution, but **does not insert the implicit defaults** that the strict family receives from `strict: true`. tsc computes those via `getStrictOptionValue(options, flag)`; the rule mirrors that.

```typescript
// src/tsconfig/strict-family.ts

import type { CompilerOptions } from 'ts-morph'

const STRICT_FAMILY = [
  'alwaysStrict',
  'noImplicitAny',
  'noImplicitThis',
  'strictBindCallApply',
  'strictFunctionTypes',
  'strictNullChecks',
  'strictPropertyInitialization',
  'useUnknownInCatchVariables',
] as const satisfies ReadonlyArray<keyof CompilerOptions>

export type StrictFamilyFlag = (typeof STRICT_FAMILY)[number]

/**
 * Mirror of tsc's `getStrictOptionValue`.
 *
 * For each strict-family flag, the effective value is:
 *   1. The explicit option if set (true or false).
 *   2. Otherwise `strict` (if set).
 *   3. Otherwise `false` (TS default before `strict`).
 *
 * Reference: TypeScript compiler source — `getStrictOptionValue`.
 */
export function resolveFlag(opts: CompilerOptions, flag: StrictFamilyFlag): boolean {
  if (opts[flag] !== undefined) return Boolean(opts[flag])
  return Boolean(opts.strict)
}

export function isStrictFamily(key: string): key is StrictFamilyFlag {
  return (STRICT_FAMILY as readonly string[]).includes(key)
}
```

Used inside `collectViolations()` when comparing required against actual.

### `ArchProject` interface addition

```typescript
// src/core/project.ts — additive change to the existing interface

import type { CompilerOptions } from 'ts-morph'

export interface ArchProject {
  readonly tsConfigPath: string
  getSourceFiles(): SourceFile[]

  /** Resolved compiler options as parsed from tsconfig.json (after `extends`). */
  getCompilerOptions(): CompilerOptions

  /** @internal */
  readonly _project: Project
}
```

Both `project()` and `workspace()` implement it by delegating to `tsMorphProject.getCompilerOptions()`. One-line implementation each. `workspace()` uses the alphabetically-first tsconfig's options (already documented in the existing implementation) — a `tsconfig()` rule against a workspace asserts against that primary config. The plan documents this; users with per-package strictness call `tsconfig(project('./packages/x/tsconfig.json'))` for that package.

## Violation shape

One violation per mismatched flag. Reuses `createViolation()` minimally — file is the resolved tsconfig path, line is `1` (the existing `ArchViolation.line` is `number`, so we satisfy the contract).

Message format (one per violation):

```
tsconfig.json — compiler option mismatch:
  expected: strict = true
  actual:   strict = false

  Fix: set "strict": true in compilerOptions.
```

When the required value is unset:

```
tsconfig.json — required compiler option missing:
  expected: noUncheckedIndexedAccess = true
  actual:   noUncheckedIndexedAccess = (unset)

  Fix: add "noUncheckedIndexedAccess": true to compilerOptions.
```

The `because:` field (when set by user) appears in formatted output via the existing pipeline — no special handling.

## Implementation phases

### Phase 0 — Verification spike (~30 min)

**Before writing the rule, verify two unknowns**:

1. **`getCompilerOptions()` semantics.** Write a tiny throwaway script: load a project with an `extends` chain (parent strict, child unset; parent strict, child overrides), call `getCompilerOptions()`, log the result. Confirm `extends` is resolved. Confirm strict-family sub-flags are _not_ auto-inserted. Pin findings into the plan as comments before Phase 1.

2. **Baseline behaviour with file-only violation key.** Run the existing pipeline on a synthetic violation where `file: 'tsconfig.json'`, `line: 1`. Verify:
   - Baseline file format accepts the key.
   - Re-running produces a "matched baseline → no failure" outcome.
   - Removing the violation invalidates the baseline entry as expected (stale-baseline warning fires).

   If the baseline format does not handle file-only keys cleanly, **stop** and raise the issue — file-level baseline may need a separate plan first.

This spike is the same pattern used to verify plan 0048's `getAliasedSymbol` semantics before locking it in.

### Phase 1 — Core implementation (~2 hours)

1. Add `getCompilerOptions()` to `ArchProject` interface and both `project()` / `workspace()` implementations (`src/core/project.ts`).
2. Create `src/tsconfig/strict-family.ts` with `resolveFlag` + `isStrictFamily`.
3. Create `src/tsconfig/tsconfig-builder.ts`:
   - `class TsconfigBuilder extends TerminalBuilder`.
   - Constructor: `constructor(private readonly project: ArchProject) { super() }`.
   - `_requirements: Partial<CompilerOptions> = {}` accumulator.
   - `.requires(spec)` — merges into `_requirements`, returns `this`.
   - `protected collectViolations(): ArchViolation[]` — iterates `_requirements`, applies strict-family resolution for the strict family, emits one violation per mismatch.
4. Create `src/tsconfig/index.ts` with the flat `tsconfig()` entry-point export.
5. Wire exports into `src/index.ts`.

### Phase 2 — Tests (~2 hours)

Fixture pattern: in-memory ts-morph project (`tests/rules/typescript.test.ts:77-80` is the precedent — no disk-fixture explosion for config variants).

Required cases:

- `strict: true` required, project has `strict: true` → no violations.
- `strict: true` required, project has `strict: false` → one violation, correct expected/actual.
- `strict: true` required, project unset → one violation, "(unset)" actual.
- `strict: true` required + project has `strict: true, strictNullChecks: false` → no violation (only `strict` was required).
- `strictNullChecks: true` required + project has `strict: true` only → no violation (strict-family implied).
- `strictNullChecks: true` required + project has `strict: true, strictNullChecks: false` → violation (explicit override wins).
- `strictNullChecks: true` required + project has all eight sub-flags but no `strict` → no violation.
- `noUncheckedIndexedAccess: true` required + project has `strict: true` only → violation (not in strict family, must be explicit).
- `target: ScriptTarget.ES2022` required + project has `ES2020` → violation, shows both values.
- Multiple mismatches: required `{ strict: true, target: ES2022 }`, project has `strict: false, target: ES2020` → exactly two violations, each names its flag.
- `extends` chain: parent sets `strict: true`, child unset → required `strict: true` passes.
- `extends` chain: parent sets `strict: true`, child overrides `strict: false` → required `strict: true` fails.
- Multiple `.requires()` calls merge additively.
- `.excluding(...)` filters violations by element (the element is the flag name; document this in the rule's behavior).
- `.because('...')` appears in output.
- Baseline round-trip: violation captured in baseline → re-run passes; removed flag → stale-baseline warning.
- `workspace()`: rule reads the primary tsconfig's options (documented behavior — one assertion per workspace).

Cache hygiene: each test calls `resetProjectCache()` or uses a unique tsconfig path.

### Phase 3 — Docs (~1 hour)

- New section in `docs/rules.md` (or wherever smells are documented): "Project-config rules — `tsconfig()`." **Lead with strict-family resolution** — why `strict: true` implies the eight (nine, once `strictBuiltinIteratorReturn` is added) sub-flags, the thing a plain JSON-schema check can't do — then show one example, then link `CompilerOptions`.
- README — add the `tsconfig(p).requires({ strict: true }).check()` line near the smell-detector example, not at the top. It's a tool in the box, not the headline.
- CHANGELOG `### Added` entry.

### Phase 4 — EESS walkthrough alignment (~15 min)

The calculator walkthrough's ADR-0002 (`eess-walkthrough-calculator.md`) currently says _"all .ts files use strict mode (tsconfig.json)"_. Update the generated `arch.rules.ts` snippet in Stage 4 to compile that to:

```typescript
tsconfig(p).requires({ strict: true }).check()
```

That's the only doc-asset coupling.

## Files changed

| File                                      | Change                                                               |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `src/core/project.ts`                     | Add `getCompilerOptions()` to interface; implement in both factories |
| `src/tsconfig/tsconfig-builder.ts`          | New — `TsconfigBuilder extends TerminalBuilder`                      |
| `src/tsconfig/strict-family.ts`             | New — `resolveFlag`, `isStrictFamily`, `STRICT_FAMILY` constant      |
| `src/tsconfig/index.ts`                     | New — flat `tsconfig()` entry-point export                           |
| `src/index.ts`                            | Export `tsconfig` and `TsconfigBuilder`                              |
| `tests/config/tsconfig.test.ts`           | New — full Phase 2 inventory                                         |
| `docs/rules.md` (or appropriate doc page) | New section                                                          |
| `README.md`                               | One example line near non-element-builder examples                   |
| `CHANGELOG.md`                            | `### Added`                                                          |
| `eess-walkthrough-calculator.md`          | Stage 4 snippet update                                               |

No changes to `recommended()`. No new sibling rules. No new top-level concept.

## ADR alignment

- **ADR-002 (ts-morph AST engine):** Compiler options come from `tsMorphProject.getCompilerOptions()`. Pure ts-morph; no raw TS API.
- **ADR-003 (fluent builder DSL):** The element-builder DSL handles element sets; `TerminalBuilder` already covers non-iterating rules. This plan extends the existing `TerminalBuilder` branch — no DSL fracture.
- **ADR-005 (no `any`, no `as`):** All values are typed via `CompilerOptions`. Strict-family resolution uses `Boolean()` wrapping rather than `as boolean`. No `any` anywhere. The only mildly tricky case is comparing enum-backed string fields (`target`, `module`) — handled by reading and comparing typed property values directly, no string-to-enum coercion needed since `CompilerOptions[K]` is already the resolved type.

## Out of scope

- **`recommended()` integration.** Deliberately omitted — see "Goal" and framework-mindset re-read above.
- **`packageJson()`, `nodeVersion()`, etc.** Land when there's real demand, as their own flat entry points. `tsconfig` is the only foreseen config assertion — no namespace reserved now (a non-`config`-named namespace can be introduced later if a real cluster ever emerges).
- **`.forbids(spec)` (assert flags are NOT set to certain values).** Future plan if demand emerges. `.requires()` covers the immediate need.
- **`.satisfies(predicate)` for custom logic.** Future plan. The library doesn't need a tsconfig-matcher abstraction yet — flat key-value is enough.
- **Per-file overrides** (`tsconfig.test.json`). User constructs a second `project()` and calls `tsconfig()` on it separately.
- **Reading raw tsconfig.json** (line numbers for the failing option, AST of the JSON, etc.). Out of scope — tsc and ts-morph resolve to a flat `CompilerOptions` object; the rule operates on that.
- **Validating the structure of tsconfig.json** (typos, etc.). tsc does that at load time; `project()` already fails with a clear error before any rule runs.
- **Suggesting fixes by editing tsconfig.json.** The rule reports; it does not mutate.
- **Reserved npm/GitHub footprint, EESS consolidation, brand renames.** Plan 0051 territory; independent.

## Strategic note

Three reasons this lands cleanly:

1. **It closes the obvious gap.** Plans 0047 and 0048 strengthen the code-level checks against escape hatches; this rule closes the upstream config-level hole that lets users bypass tsc itself. Together they form a coherent type-safety story.
2. **It joins the existing architecture instead of inventing.** `TerminalBuilder` is already the home for non-iterating rules; `SmellBuilder` is the existing precedent. One more subclass, one more top-level entry point, one more `ArchProject` method — that's the whole footprint.
3. **It respects the framework-mindset.** `tsconfig(p).requires({ strict: true })` is the user declaring their own intent. The library does not opine on whether `strict: true` is good. Anyone — strict-greenfield, partial-migration, JS-mostly, monorepo-mixed — can use the same primitive to assert whatever shape they actually want.

EESS-wise, this is the rule that ADR-0002 in the calculator walkthrough already implicitly demands. The walkthrough's `## Enforcement` section says _"all .ts files use strict mode (tsconfig.json)"_ — that line now has a concrete compile target, and it's a target every kind of TypeScript project can use, not just the ones that match the library's defaults.

## Review findings — 2026-07-13

Reviewed via the `review-proposal` skill (architect + product lenses), grounded against `violation.ts`, `baseline.ts`, `project.ts`, `terminal-builder.ts`, and ts-morph. Existing-code survey: **no duplication** — the flat `tsconfig` entry point, `TsconfigBuilder`, `getCompilerOptions()`, `src/tsconfig/` are all new; the `TerminalBuilder`/`SmellBuilder`/`smells`-namespace precedent it reuses exists.

**Verdict: Ship with changes** — the cleanest of the open plans. The primitive is textbook framework-mindset; the fixes are naming + a few factual corrections.

### Blocking (fix before implementation)

- **Namespace collision (product) — RESOLVED 2026-07-13: going flat `tsconfig(p)`; `tsconfig` is the only foreseen config assertion, so no namespace.** `config` clashed with the existing `defineConfig`/`CliConfig` (`src/index.ts`, `src/cli/config.ts`, "configure the tool"). The plan body now uses the flat entry point throughout; a non-`config`-named namespace can be introduced later only if a real cluster (`packageJson`, `nodeVersion`) emerges.
- **`createViolation()` can't be reused as claimed** (lines 66, 213). It takes a ts-morph `Node` (`violation.ts:153`) and derives file/line/codeFrame from it; tsconfig isn't a `SourceFile` in the project. Construct the `ArchViolation` literal directly (set `element` = flag name, omit `codeFrame`). The architecture-fit table is factually wrong.
- **`STRICT_FAMILY` is incomplete and self-undermining.** Missing `strictBuiltinIteratorReturn` (TS 5.6, governed by `strict`) → `.requires({ strictBuiltinIteratorReturn: true })` falsely fails on a `strict:true` project. And the hardcoded list contradicts the "new TS flags land automatically" claim (line 144) — the *input* auto-updates; the resolution list is a manual allowlist to chase each TS release. State the tension; pin to a TS version with a guard test.
- **ADR-005:** the plan's own sample uses `as` (line 184, `(STRICT_FAMILY as readonly string[])`) — use `.some((f) => f === key)`. And array/object-valued options (`lib`, `paths`, `types`) break flat `===` → false positives; restrict to primitive/enum keys, deep-compare, or document as unsupported.

### Should-fix

- Drop the "stale-baseline warning" assertions (Phase 0 item 2, test line 288) — no such warning exists in the pipeline. But the file-only baseline key **round-trips fine** (identity is `rule::element::message` per `baseline.ts:52-54`; file/line aren't matched), so Phase 0's biggest fear is unfounded — downgrade it to a 10-min confirmation.
- Enum-backed options print numeric (`target=9`, not `ES2022`) — add a reverse-map for messages.
- `workspace()` asserts only the alphabetically-first tsconfig → false confidence in mixed-strictness monorepos; make the docs loud and the pass-case traceable.
- `.excluding()` repurposed to filter by flag name is a semantic stretch — document as such or no-op it.

### Praise

- Refusing to curate/opine (`Partial<CompilerOptions>` as the user's own data) is textbook framework-mindset. Strict-family resolution mirroring tsc's `getStrictOptionValue` is the real value a JSON-schema check can't replicate — **lead the docs with it.** `TerminalBuilder`/`SmellBuilder` is the right home (ADR-003 intact); Phase 0 spike is disciplined.

**Next step:** rename to flat `tsconfig(p)`, fix the `createViolation` reuse + `STRICT_FAMILY` completeness/framing + the `as` cast + array/object comparison, drop the stale-baseline assertion. Then it's a clean 0.5–1 day.

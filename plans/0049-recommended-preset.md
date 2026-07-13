# Plan 0049: `recommended()` Sensible-Defaults Preset

## Status

- **State:** DRAFT — captured for decision, not yet scheduled
- **Review (2026-07-13):** Ship (thin). **Decisions applied 2026-07-13:** trimmed to a genuinely-universal floor — `functionNoEval` + `functionNoFunctionConstructor` (error), `functionNoSilentCatch` + `noEmptyBodies` (warn); dropped `noDeadModules` + all house-style/opinion rules; opt-in-ladder stability policy; `extends PresetBaseOptions`; `preset/recommended/*` ids; no `strict()`. **Round-2 (2026-07-13):** `recommended()` returns severity-carrying builders (the returning form) per plan 0060's Option 2 — this resolves the warn-tier baseline/format gap. Plan text ready; build scheduled later (after 0055/0047/0048 + 0060, before 0050). See "Review findings" below.
- **Priority:** TBD (likely P2 once approved)
- **Effort:** 0.5 day
- **Created:** 2026-05-05
- **Depends on:** Existing standard rules — `functionNoEval` / `functionNoFunctionConstructor` (`rules/security`), `functionNoSilentCatch` (`rules/errors`), `noEmptyBodies` (`rules/hygiene`). Compatible with future plans 0047 (TS escape hatches) and 0048 (deprecation matcher); the preset can pick up new rules from those plans non-breakingly when they land, judged against the universal-floor bar. **Cross-cutting (resolved):** the two `warn` rules deliver baseline + `--format json` via the returning-form / unified-pipeline design decided in plan 0060 (Option 2) — `recommended()` returns severity-carrying builders and the CLI owns filtering/formatting.

## Problem

A new project adopting ts-archunit faces a discovery problem: the
library ships 25+ standard rules across 8 categories, plus the fluent
DSL for custom rules. Authoring a useful `arch.rules.ts` from scratch
requires reading the docs, understanding which rules apply
project-wide vs shape-specific, and assembling a sensible starter set.

This is the same friction `eslint:recommended`, `tsc --init`, and
`vitest`'s sensible defaults solve in their domains. ts-archunit
currently has shape-specific presets (`layeredArchitecture`,
`dataLayerIsolation`, `strictBoundaries`) but no
**shape-independent** preset that any TypeScript project benefits from.

## Goal

Ship one function — a deliberately **thin, universal safety floor**, not a
full architecture:

```typescript
import { project, recommended } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')
recommended(p)
```

That single line bans the handful of things dangerous in **any** TypeScript
project — backend, frontend, library, CLI — that fire ~never on healthy
code. It is the floor, not the architecture: shape-specific rules (layer
order, `mustCall(/Repository/)`, cycles) are the user's to add. Kept thin on
purpose — a padded "recommended" set becomes noise and drifts into one
team's house style (see "What's deliberately excluded").

## What `recommended()` enables

The genuinely-universal floor — four rules dangerous on any TS codebase
regardless of shape. Tiered by false-positive risk: the two **error** rules
fire ~never on healthy code (safe to fail CI); the two **warn** rules are
high-signal but have known, suppressible false positives (empty no-op
callbacks / DI constructors; intentional best-effort catches) — hence warn,
not error:

| Rule                            | Severity | Why it's universal                                                                |
| ------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `functionNoEval`                | error    | `eval` is ~never legitimate in production code                                     |
| `functionNoFunctionConstructor` | error    | The `Function` constructor is `eval` in disguise                                  |
| `functionNoSilentCatch`         | warn     | Catch-and-swallow is usually a bug — but intentional empty catches exist, so warn |
| `noEmptyBodies`                 | warn     | Empty bodies are usually stubs — but no-op callbacks / DI constructors exist      |

Two `error`, two `warn`. That's the whole set. A floor this thin also
largely dissolves the "first run floods an existing codebase" problem — but
`withBaseline()` stays documented as the on-ramp for the `warn` rules on
legacy code.

### What's deliberately excluded

In the original draft and now **out** — each is either shape-dependent or
one team's house style, not a universal default:

- `noDeadModules` — shape-dependent: it flags library public-API modules and
  CLI entry points as "dead" unless it knows your entry points. Threading an
  `entryPoints` option into `recommended()` to make one rule behave pulls the
  whole preset toward config-heaviness. Users add it explicitly with their
  own entry points excluded.
- `moduleNoTypeAssertions` / `moduleNoNonNullAssertions` — this library's own
  ADR-005 house style. `eslint:recommended` bans neither `as` nor `!`; real
  projects use both at interop boundaries. Opt-in standalone rules.
- `noStubComments` — a workflow opinion (banning TODO/FIXME). `eslint`'s
  equivalent is off-by-default for the same reason.
- Anything project-shape-dependent — `mustCall(/Repository/)`, layered
  ordering, slice cycles, framework patterns. Shape-specific / framework
  presets, or the user's own rules.

No `strict()` sibling either (see "Why not a `strict()` preset"). The excluded
strict-tier rules stay available as standalone rules users opt into
explicitly — never bundled.

## API shape

```typescript
import type { PresetBaseOptions } from './shared.js'

export interface RecommendedOptions extends PresetBaseOptions {
  /**
   * Source-file glob the recommendations apply to.
   * Default: `'src/**'` — keeps node_modules `.d.ts`, generated files,
   * and test fixtures out of scope. Libraries/CLIs using `lib/` or
   * `packages/*/src` override this.
   */
  readonly include?: string
}

export function recommended(p: ArchProject, options?: RecommendedOptions): RuleBuilderLike[]
```

**Returning form (plan 0060, Option 2).** `recommended()` returns an **array of
severity-carrying builders** (each configured with the non-terminal
`.asSeverity('error'|'warn')`), not `void` — so it composes with the CLI's
unified pipeline: the generated
`arch.rules.ts` does `export default [...recommended(p)]`, and `check` applies
baseline/format and sets the exit code from the error-severity count. This is
what lets the two `warn` rules be baseline-filtered and formatted instead of
lost to `console.warn`. (A vitest user who wants throwing behavior spreads the
array through a `.check()` helper.)

`RecommendedOptions` **extends `PresetBaseOptions`** — it inherits the shared
`overrides?: Record<string, RuleSeverity>` mechanism (same as
`layeredArchitecture` / `dataLayerIsolation`) rather than re-declaring it.
Rule ids are namespaced `preset/recommended/<rule>` to match every other
preset (`preset/layered/*`, `preset/data/*`):

```typescript
recommended(p, {
  overrides: {
    'preset/recommended/no-silent-catch': 'off',
    'preset/recommended/no-empty-bodies': 'error', // promote a warn to error
  },
})
```

## Naming and stability policy

- Each rule gets an id under the `preset/recommended/<rule-name>`
  namespace (e.g. `preset/recommended/no-eval`,
  `preset/recommended/no-empty-bodies`) — consistent with every other
  preset.
- **Opt-in ladder (the contract).** A new rule joins `recommended()` at
  `warn` (or `off`) in a **minor** version; it is promoted to `error` only
  in a **major**. This is the only version of the policy that is both
  honest and enforceable: any genuinely useful new rule flags *someone's*
  previously-passing code, so "add at error in a minor" would break CI on a
  minor bump — exactly the `eslint:all` mistake.
- A rule qualifies for `recommended()` only if it meets the
  **universal-floor bar**: dangerous on any project shape, fires ~never on
  healthy code. Future rules (incl. those from plans 0047/0048) are judged
  against that bar, not added for completeness.
- Removing a rule is a **major** version bump; the rule stays available
  standalone.

Document this in `docs/presets.md` and the JSDoc.

## Why not a `strict()` preset

Tempting but a footgun. Strict-everything presets become breaking on
every rule addition, which forces the library to never grow them
again. ESLint's `eslint:all` is the cautionary tale. Users who want
"every rule" can list them explicitly — that's their choice, not the
preset's contract.

## Implementation phases

### Phase 1 — `recommended()` function (~1 hour)

Add `src/presets/recommended.ts`. Under the returning-form model (plan 0060,
Option 2) `recommended()` **returns severity-carrying builders** rather than
aggregating + throwing:

- `validateOverrides(overrides, [...RULE_IDS])` — typo guard (from `shared.ts`).
- For each of the four rules, build
  `functions(p).that().resideInFolder(include).should().satisfy(cond)`, then set
  its id + severity with `.rule({ id })` and the **non-terminal**
  `.asSeverity(effective)` where `effective = overrides[id] ?? defaultSeverity`
  (plan 0060's new primitive — sets state, returns `this`, does not execute).
  Skip any rule overridden to `'off'`.
- Return the `RuleBuilderLike[]`.

The CLI's unified pipeline (plan 0060) applies baseline/format and derives the
exit code from the error-severity count, so the two `warn` rules are properly
baseline-filtered and formatted. (`recommended` no longer uses
`dispatchRule`/`throwIfViolations` — those are the throwing-aggregate model;
the returning form sets severity on each builder instead.)

Note: `dispatchRule` currently forwards only `{ id }` to the builder. If the
agent-readable `because`/`suggestion` metadata is wanted on these violations,
extend the shared `dispatchRule`/`RuleMetadata` plumbing (a shared-infra
change affecting all presets — its own small line item), or drop that promise
for v1.

### Phase 2 — Tests (~1 hour)

Smoke tests in `tests/presets/recommended.test.ts`:

- Empty project — zero violations.
- `recommended(p)` returns 4 severity-carrying builders (2 error, 2 warn) —
  assert array length, ids (`preset/recommended/*`), and per-builder severity
  directly (no thrown error to inspect).
- Via the CLI pipeline (plan 0060): a project tripping the **warn** rules →
  formatted + reported, **exit 0** (warns don't fail); baselined → suppressed on
  re-run. **Error** rules → exit 1.
- `overrides` promotes / demotes / `off` per rule.
- `include` scope respected.

### Phase 3 — Docs (~30 min)

- Add `docs/presets.md` section covering `recommended` + the stability
  policy.
- README "Quick Start" gains a one-line example.
- CHANGELOG `### Added` entry.

## Files changed

| File                                | Change                                      |
| ----------------------------------- | ------------------------------------------- |
| `src/presets/recommended.ts`        | New                                         |
| `src/index.ts`                      | Export `recommended` + `RecommendedOptions` |
| `tests/presets/recommended.test.ts` | New                                         |
| `docs/presets.md`                   | Add `recommended()` section + policy        |
| `README.md`                         | One-line quick start example                |
| `CHANGELOG.md`                      | `### Added` entry                           |

## Out of scope

- **`strict()` preset** — see "Why not."
- **Shape-specific presets** — already covered by
  `layeredArchitecture` etc.
- **Framework-specific presets** — separate packages per ADR-006.
- **Interactive selection** — the CLI scaffolder (plan 0050) handles
  user-facing onboarding.

## Strategic note

`recommended()` is the **prerequisite** for plan 0050 (`ts-archunit init`
CLI). The scaffolder generates an `arch.rules.ts` file containing one
line — the call to `recommended()`. Without this preset, the
scaffolder either generates a long verbose rules file or generates an
empty one and asks the user to populate it. Land 0049 first, then 0050.

## Review findings — 2026-07-13

Reviewed via the `review-proposal` skill (architect + product lenses), grounded against `src/rules/hygiene.ts` and the preset infra. Existing-code survey: **no duplication** — `recommended` is new; all bundled rules exist; the override infra (`dispatchRule`/`validateOverrides`/`PresetBaseOptions`) exists.

**Verdict: Rewrite the curated set.** The pitch and strategic role (seed for 0050) are right, but `eslint:recommended` earns trust by firing ~zero times on healthy code, and this set doesn't clear that bar.

### Blocking (fix before implementation)

- **RESOLVED 2026-07-13 — dropped.** `noDeadModules` is out of `recommended()` (shape-dependent; needs entry points). Users add it explicitly with their own entry points excluded. No `entryPoints` option added to the preset.
- **RESOLVED 2026-07-13 — trimmed to the universal floor.** The set is now `functionNoEval` + `functionNoFunctionConstructor` (error) and `functionNoSilentCatch` + `noEmptyBodies` (warn). The ADR-005 house-style bans (`moduleNoTypeAssertions`/`moduleNoNonNullAssertions`) and the `noStubComments` workflow opinion are excluded — they stay available as standalone opt-in rules, not bundled and not in a `strict()` preset.
- **RESOLVED 2026-07-13 — opt-in ladder.** Stability policy rewritten: new rules enter at `warn`/`off` in a minor, promoted to `error` only in a major.

### Should-fix

- **RESOLVED 2026-07-13** — `RecommendedOptions extends PresetBaseOptions` (inherits `overrides`/`RuleSeverity`); rule ids are `preset/recommended/*`.
- **RESOLVED 2026-07-13 (moot)** — the `dispatchRule` `{ id }`-only limitation no longer applies: under the returning form `recommended()` sets metadata directly on each builder via `.rule({ id, because?, suggestion? })`, so agent-readable metadata is available without touching the shared `dispatchRule` plumbing.
- **RESOLVED 2026-07-13 — largely dissolved.** The thin 2-error/2-warn set no longer floods legacy codebases; `withBaseline()` stays documented as the on-ramp for the two `warn` rules.

### Praise

- Refusing `strict()`/`eslint:all` is the right call, well-argued. Namespaced ids + `overrides` escape hatch is correct. ADR-006 fit (generic bundle in core) is right.

**Next step:** trim + re-tier the set, fix the stability policy to an opt-in ladder, `extends PresetBaseOptions`, `preset/recommended/*` ids, add the baseline story — *then* it can safely seed 0050.

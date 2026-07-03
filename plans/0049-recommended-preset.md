# Plan 0049: `recommended()` Sensible-Defaults Preset

## Status

- **State:** DRAFT — captured for decision, not yet scheduled
- **Priority:** TBD (likely P2 once approved)
- **Effort:** 0.5 day
- **Created:** 2026-05-05
- **Depends on:** Existing standard rules (`rules/security`, `rules/typescript`, `rules/hygiene`). Compatible with future plans 0047 (TS escape hatches) and 0048 (deprecation matcher); the preset can pick up new rules from those plans non-breakingly when they land.

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

Ship one function:

```typescript
import { project, recommended } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')
recommended(p)
```

That single line should give a reasonable architecture-test baseline
for **any** TypeScript project — backend, frontend, library, CLI —
without baking in assumptions about project structure.

## What `recommended()` enables

Curated set of rules from existing standard-rule families that apply
to any TS codebase regardless of shape:

| Category    | Rules included                                                            |
| ----------- | ------------------------------------------------------------------------- |
| Security    | `functionNoEval`, `functionNoFunctionConstructor`                         |
| Type safety | `moduleNoTypeAssertions` (allows `as const`), `moduleNoNonNullAssertions` |
| Hygiene     | `noEmptyBodies`, `noStubComments`, `noDeadModules`                        |
| Errors      | `functionNoSilentCatch`                                                   |

Future-pickup candidates (additive when their plans land):

- `moduleNoAnyAnnotations` (plan 0047)
- `moduleNoTsDirectives` excluding `@ts-expect-error` (plan 0047)
- `moduleNoBroadTypes` (plan 0047)
- `moduleNoUseOfDeprecated({ localOnly: true })` (plan 0048)

**Excluded by design:** anything project-shape-dependent —
`mustCall(/Repository/)`, layered ordering, slice cycles, framework
patterns. Those go in shape-specific or framework presets.

## API shape

```typescript
export interface RecommendedOptions {
  /**
   * Source-file glob the recommendations apply to.
   * Default: `'src/**'` — keeps node_modules `.d.ts`, generated files,
   * and test fixtures out of scope.
   */
  readonly include?: string

  /**
   * Per-rule severity overrides, keyed by rule id.
   * Lets users keep the curated set but downgrade specific rules to
   * warnings (or off) without re-authoring the preset.
   *
   * @example
   * recommended(p, { overrides: { 'recommended/no-empty-bodies': 'warn' } })
   */
  readonly overrides?: Record<string, 'error' | 'warn' | 'off'>
}

export function recommended(p: ArchProject, options?: RecommendedOptions): void
```

The shape mirrors `layeredArchitecture` (plan 0040) — same `overrides`
mechanism so users can opt out of one rule without rewriting the whole
preset call.

## Naming and stability policy

- Each rule emitted by the preset gets an id under the
  `recommended/<rule-name>` namespace (e.g.
  `recommended/no-eval`, `recommended/no-empty-bodies`).
- The library reserves the right to **add** rules to `recommended()`
  in **minor** versions when new rules clearly meet the
  shape-independent bar.
- The library only **removes** rules from `recommended()` in
  **major** versions, with the rule still available standalone.
- Adding a rule that flags previously-passing code is a **major**
  version bump. (Same policy ESLint adopted after the
  `eslint:all` mistake.)

This policy is the contract. Document it in `docs/presets.md` and the
JSDoc.

## Why not a `strict()` preset

Tempting but a footgun. Strict-everything presets become breaking on
every rule addition, which forces the library to never grow them
again. ESLint's `eslint:all` is the cautionary tale. Users who want
"every rule" can list them explicitly — that's their choice, not the
preset's contract.

## Implementation phases

### Phase 1 — `recommended()` function (~1 hour)

Add `src/presets/recommended.ts` that calls the curated rules with
`.rule({ id, because, suggestion })` metadata for each so violations
remain agent-readable.

### Phase 2 — Tests (~1 hour)

Smoke tests in `tests/presets/recommended.test.ts`:

- Empty project — zero violations.
- Project with one violation per rule — correct count, correct ids.
- `overrides` toggles each rule on/off.
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

# Plan 0062: Unify Shape Presets on the Returning Form

## Status

- **State:** Done (v0.16.0, branch `feat/0062-shape-presets`, stacked on `feat/0061-docs-restructure`) — three presets return `RuleBuilderLike[]`; `collectRule` replaces `dispatchRule`; `dispatchRule`/`throwIfViolations` removed from shared + public exports; `checkAll` added + exported; `baseline.ts` symmetric catch; warn rules flow through the pipeline. Tests: `shared.test` migrated, three preset tests rewritten (severity-stamped assertions), `check-all.test` + real-preset integration test (sibling coexistence + baseline round-trip + defense catch). Docs: one preset model across presets/setup/running-in-tests/api-reference; rung-2 caveat deleted; CHANGELOG breaking entry. **Codemod deferred** (see Compatibility). Full validate green (2038 tests). Version bump to 0.16.0 happens at release.
- **Priority:** P1 — the gap breaks rung 2 of the documented adoption ladder (plan 0061 routes around it with a caveat; this plan removes the cause).
- **Effort:** ~1.5 days (revised after review — the migration is NOT mechanical: `checkAll` helper (in scope) makes the break ergonomic, `shared.test.ts` migration and a real-loader fixture added, the `baseline.ts` symmetric catch, tightened assertions; the codemod was right-sized OUT — deferred until adoption warrants it).
- **Created:** 2026-07-13
- **Depends on:** Nothing new — the returning-form infrastructure (`RuleBuilderLike`, `.asSeverity()`, the severity-aware `check` pipeline) shipped in v0.13.0 (plans 0060/0049/0044). This plan applies it to the three presets that predate it.
- **Breaking:** Yes — see "Compatibility & versioning". Recommended: ship as **v0.16.0** with a prominent `### Changed (breaking)` CHANGELOG entry and a one-line migration (pre-1.0 semver; a 1.0.0 bump is the alternative if we want to pin the preset contract as stable).

## Problem

ts-archunit has two preset execution models, and they are opposites:

| Preset                                                                      | Returns             | On violation                            | CLI rule file (`export default [...]`) |
| --------------------------------------------------------------------------- | ------------------- | --------------------------------------- | -------------------------------------- |
| `recommended`, `agentGuardrails` (v0.13, plans 0049/0044)                   | `RuleBuilderLike[]` | returns builders; runner decides        | ✅ spread in                           |
| `layeredArchitecture`, `strictBoundaries`, `dataLayerIsolation` (plan 0040) | `void`              | **throws** `ArchRuleError` at call time | ❌ incompatible                        |

The shape presets self-execute: they accumulate violations across their rules and end with `throwIfViolations()` (`src/presets/layered.ts:176`, `boundaries.ts`, `data-layer.ts`). That conflates rule **definition** (what a preset is for — ADR-006: presets are functions that produce rules) with rule **execution** (severity, baseline, format, exit code — the runner's job). Concrete failures on the golden path (all verified, surfaced by the 0061 docs review):

1. **Spread form crashes:** `export default [...layeredArchitecture(p, {...})]` spreads `void` → `TypeError: undefined is not iterable` at rule-file load.
2. **Statement form silently drops siblings:** a bare `layeredArchitecture(p, {...})` statement throws during `await import()` — before `export default` is established — so `check`'s fallback catch reports the layered violations but **every returning-form rule in the same file vanishes from the run** (a report that looks complete and isn't).
3. **`arch:baseline` crashes:** `runBaseline` calls `loadRuleFiles` with no catch (`src/cli/commands/baseline.ts:16`), so on any codebase that trips a shape preset, the baseline the adoption ladder requires **cannot be generated**.
4. **Warn severity is lost:** `dispatchRule`'s `'warn'` path (`shared.ts:39-44`) prints to `console.warn` and returns `[]` — warn violations never reach the severity-aware pipeline, baseline, or JSON output. (This is the exact pre-0060 warn-path bug, still alive inside the shape presets.)

The docs (0061) currently route around this with a caveat ("run shape presets in a test file; a returning form is planned"). This plan makes that caveat deletable.

## Goal

**One preset contract.** Every preset returns `RuleBuilderLike[]`; the caller decides execution. The throwing form is removed, not deprecated-alongside — two names for one concept would permanently re-create the two-model confusion 0061 just eliminated at the docs layer.

```typescript
// arch.rules.ts — the whole preset family, uniform
export default [
  ...recommended(p),
  ...layeredArchitecture(p, {
    layers: {
      routes: 'src/routes/**',
      services: 'src/services/**',
      repositories: 'src/repositories/**',
    },
    shared: ['src/shared/**'],
    strict: true,
  }),
]
```

```typescript
// test file — one hard-to-misuse terminal (see checkAll below)
checkAll(layeredArchitecture(p, opts))
```

## Design

### `collectRule` replaces `dispatchRule`

`dispatchRule` executes; `collectRule` configures and returns. Same override/severity resolution, no execution:

```typescript
// src/presets/shared.ts

/** A builder a preset can configure and hand back: .rule() and .asSeverity() chain, .violations() runs. */
interface PresetRule {
  rule(m: RuleMetadata): this
  asSeverity(level: 'error' | 'warn'): this
  violations(): ArchViolation[]
}

/**
 * Resolve a preset rule's effective severity and return it as a configured,
 * UN-executed builder. 'off' → empty array (spread-friendly). Non-generic —
 * the return type is always `RuleBuilderLike[]`; `PresetRule` is structurally
 * assignable to `RuleBuilderLike` so no cast is needed (ADR-005).
 */
export function collectRule(
  builder: PresetRule,
  ruleId: string,
  defaultSeverity: RuleSeverity,
  overrides: Record<string, RuleSeverity> | undefined,
): RuleBuilderLike[] {
  const effective = overrides?.[ruleId] ?? defaultSeverity
  if (effective === 'off') return []
  return [builder.rule({ id: ruleId }).asSeverity(effective)]
}
```

(Review note: the earlier `collectRule<T extends PresetRule>` generic bought nothing — `T` was never surfaced to callers, who always push into a `RuleBuilderLike[]`. Plain `PresetRule` is simpler and equally type-safe. Verified: `RuleBuilder.rule/.asSeverity` (`rule-builder.ts:105,235`) and `TerminalBuilder.rule/.asSeverity` (`terminal-builder.ts:43,151`) both return `this`, and every builder used inside the shape presets — `SliceRuleBuilder`, `RuleBuilder`, `DuplicateBodiesBuilder extends SmellBuilder extends TerminalBuilder` — satisfies `PresetRule`.)

Both builder hierarchies already satisfy `PresetRule`, so all 12 `dispatchRule` call sites across the three presets convert mechanically:

```typescript
// before                                            // after
violations.push(...dispatchRule(b, id, sev, ov))     builders.push(...collectRule(b, id, sev, ov))
...
throwIfViolations(violations)                        return builders
```

Signatures change to `(...): RuleBuilderLike[]`; option interfaces are untouched (same `overrides`, same rule IDs, same defaults).

### Warn rules get _better_, not just equivalent

`preset/layered/type-imports-only` and `preset/boundaries/no-duplicate-bodies` default to `'warn'`. Today their violations go to `console.warn` and vanish. After migration they carry `severity: 'warn'` through the pipeline: reported in terminal/JSON/github output, baseline-filterable, never failing the run — identical semantics to `recommended`'s warn rules.

### `checkAll()` — the test-file helper (pulled INTO scope after review)

The returning form is spread-friendly for rule files, but the largest existing audience runs presets in **test files**. Handing them the raw migration incantation — `preset(p, opts).flatMap(r => r.violations()).filter(v => (v.severity ?? 'error') === 'error')` + `toEqual([])` — at the moment of a forced break is a DX regression AND a footgun: a slightly-wrong filter passes vacuously (the exact silent-under-enforcement this whole change fights). It also loses the marketed "one aggregated error, full picture" UX (`presets.md:222`).

So this plan ships a single, hard-to-misuse terminal for arrays of rules, exported from the root package:

```typescript
// src/core/check-all.ts (exported from '@nielspeter/ts-archunit')
/**
 * Run an array of rules (e.g. a spread preset) and throw ONE aggregated
 * ArchRuleError if any error-severity violation is found. Warn-severity
 * violations are reported (stderr) but never throw — same severity semantics as
 * the CLI. This is the test-file terminal for the returning form.
 */
export function checkAll(rules: RuleBuilderLike[], options?: CheckOptions): void
```

Migration target becomes a clean one-liner that preserves aggregation and severity:

```typescript
checkAll(layeredArchitecture(p, opts)) // throws one readable error on any error-severity violation
checkAll([...recommended(p), ...layeredArchitecture(p, opts)]) // whole family, one call
```

`checkAll` is a thin wrapper over the same `executeCheck`/severity machinery `check` already uses — not a new mechanism. It is the documented migration target and the primary example in `running-in-tests.md`.

### Crutch removal

- **Delete `throwIfViolations` and `dispatchRule`** from `shared.ts` **and from the public `./presets` exports** (`src/presets/index.ts:2` — they are currently public API; removal is part of the break).
- **`check.ts`'s fallback `ArchRuleError` catch stays** (`check.ts:41-47`) — it still protects against a _user_ rule file that self-executes `.check()` at import — its code comment is updated to "defensive: user file threw at import", not "handles self-executing presets".
- **`baseline.ts` gets the SAME catch** (review correction). The earlier plan said baseline needs none because "the cause is gone" — but that only removes the shape-preset throw vector; the _user-self-executes-`.check()`_ vector `check.ts` is explicitly retained to defend applies identically to `runBaseline`'s bare `loadRuleFiles` call (`baseline.ts:16`). Keeping the guard in `check` but not `baseline` is internally inconsistent. Add the symmetric `ArchRuleError` catch to `runBaseline` so a user's import-time throw degrades gracefully in both commands. (This is _defense_ against user code, not re-legitimizing preset throwing — presets no longer throw.)

### Compatibility & versioning

**The migration must be LOUD — this is the review's central concern.** Today a bare `layeredArchitecture(p, {...})` statement _throws_ on violation. After the change it _returns an array_. A user who upgrades and doesn't touch their test gets code that compiles, runs, and **passes while enforcing nothing** — the exact "manufactured false confidence" this product exists to prevent, and neither TypeScript nor ESLint (`no-unused-expressions` doesn't fire on a call) catches an ignored return. Worse, every shape-preset example in today's `docs/presets.md` is a bare statement, so the _dominant documented pattern_ is the one that silently passes. A CHANGELOG note alone is inadequate mitigation. The migration ships with three things:

1. **`checkAll()`** (above) — the ergonomic, hard-to-misuse target. `layeredArchitecture(p, opts)` → `checkAll(layeredArchitecture(p, opts))`. One token added, aggregation + severity preserved, no incantation.
2. **CHANGELOG leads with ACTION REQUIRED**, not a neutral "returning form": _"⚠️ Breaking: `layeredArchitecture` / `strictBoundaries` / `dataLayerIsolation` now RETURN rules instead of throwing. A bare `layeredArchitecture(p, {...})` call no longer fails your test — wrap it in `checkAll(...)`. Un-migrated calls silently enforce nothing."_

**Codemod — deferred (right-sized 2026-07-14).** The review argued for a `migrate-presets` codemod to make the break mechanical. Sound in principle, but the package shipped v0.15 _this week_ — external adoption is ~zero, and the "existing usage" it would protect is our own docs/tests, which Phase 4 rewrites anyway. Building + testing a codemod for a phantom audience is over-engineering (lego-bricks). `checkAll` (permanent value) + the loud CHANGELOG cover the real risk now; **add `migrate-presets` only if real adoption on ≤0.15 shows up** — it's purely additive. Considered and also rejected: a transitional "created-but-never-consumed" runtime warning (stateful process-exit tracking, not worth it at this adoption).

Manual migration (for anyone not running the codemod):

```typescript
// before (threw)                          // after
layeredArchitecture(p, opts)               checkAll(layeredArchitecture(p, opts))
```

Also breaking: `dispatchRule`/`throwIfViolations` removed from `@nielspeter/ts-archunit/presets`.

**Version: ship as 0.16.0, NOT 1.0.0** (both architect and product agree). 0.x semver permits a breaking minor, and closing one seam is not grounds to declare the _entire_ public surface stable — save 1.0 for a deliberate whole-API stability pass. Flag for the release owner: `0.15 → 0.16` reads as "safe minor" to most users, which is exactly why the loudness has to live in the codemod + `checkAll` + CHANGELOG, not the version number.

## Implementation phases

### Phase 1 — `collectRule` + `checkAll` (~1 hour)

- Add `collectRule` (+ the `PresetRule` interface) to `src/presets/shared.ts`. Keep `validateOverrides` unchanged. `dispatchRule`/`throwIfViolations` stay until Phase 2 flips the last caller, then delete both and their `index.ts` exports in the same commit.
- Add `checkAll(rules, options?)` in `src/core/check-all.ts`, export from `src/index.ts`. It collects every rule's `.violations()`, applies baseline/diff/format via the existing `execute-rule` helpers, and throws one `ArchRuleError` aggregating all **error-severity** violations (warns reported, never thrown) — the same severity contract as `runCheck`. A focused unit test covers: all-pass → no throw; error violation → throws with all error violations aggregated; warn-only → no throw but reported.

### Phase 2 — Migrate the three presets (~2 hours)

For each of `layered.ts`, `boundaries.ts`, `data-layer.ts`:

- Signature → `(p, options): RuleBuilderLike[]`.
- `const violations: ArchViolation[] = []` → `const builders: RuleBuilderLike[] = []`.
- Each `violations.push(...dispatchRule(...))` → `builders.push(...collectRule(...))` (12 sites total).
- `throwIfViolations(violations)` → `return builders`. Note: `throwIfViolations` also wrote `formatViolations()` to stderr before throwing (`shared.ts:74`) — that preset-local formatting moves to the runner (`writeReport` in `runCheck`, or `checkAll` in a test). Net-correct (aggregation broadens to all files/builders), just an acknowledged behavior move.
- JSDoc: document the returning form and the spread usage.

Delete `dispatchRule` + `throwIfViolations` + their public exports. Update `src/presets/index.ts` (types unchanged; `collectRule` stays internal — not exported; it's preset plumbing, not user API).

### Phase 3 — Tests (~3.5 hours — NOT mechanical; two must-fixes from review)

- **`tests/presets/shared.test.ts` MUST be migrated** (review C1 — the plan originally missed it). It imports `dispatchRule` + `throwIfViolations` and has dedicated `describe` blocks for both (~8 tests). Deleting the exports reds the suite. Delete the `throwIfViolations` block; rewrite the `dispatchRule` block as `collectRule` tests — and note the warn case _inverts_: today it asserts `console.warn` was called and result is `[]`; now it asserts the returned builder stamps `severity: 'warn'` and `console.warn` is **not** called. Keep `validateOverrides` tests.
- **Migrate** `layered.test.ts`, `boundaries.test.ts`, `data-layer.test.ts` (~33 assertions). This is a rewrite, not a conversion, for the spy-based warn cases (`layered.test.ts:114-149,168-196`, `boundaries.test.ts:91-105`): `expect(spy).toHaveBeenCalled()` → "a violation with `ruleId: 'preset/layered/type-imports-only'` and `severity: 'warn'` is present"; `spy.not.toHaveBeenCalled()` / skip cases → "no builder produces that ruleId." **Tighten assertions** while migrating: the detect cases (`toThrow`) become `violations.map(v => v.ruleId)` **contains the specific id** (not bare non-emptiness); off cases assert the id is **absent** from the returned builders (strictly stronger than the old `not.toThrow`).
- **Per-rule severity stamping** gets a direct assertion: error-rule violations carry `severity: 'error'`, warn-rule violations carry `severity: 'warn'` — **assert the literal, do not use `?? 'error'`** (that fallback masks an un-stamped builder, the exact regression to catch).
- **Integration test through the REAL loader** (review C2 — a mocked-loader mirror of `recommended-check.test.ts` would pass even if the spread-of-`void` bug were still present, because it bypasses import). Add an on-disk fixture `tests/fixtures/presets/shape-presets/arch.rules.ts` doing the real `export default [...recommended(p), ...layeredArchitecture(p, opts)]`, loaded through the real `loadRuleFiles` in `runCheck`. Assert: single JSON document; layered **error** sets the exit code; `type-imports-only` **warn** surfaced but non-failing; **floor rules present** (sibling-drop regression). The fixture/options must trip a layered error AND a type-imports warn simultaneously (may need a purpose-built fixture — the existing per-config fixtures toggle pass/fail, not both-at-once).
- **Baseline round-trip through the real `runBaseline`** over that same fixture (the flow that crashes today): baseline generated (no crash), second run returns `errorCount === 0`.
- **Baseline defense test:** a user fixture that self-executes `.check()` at import → `runBaseline` catches the `ArchRuleError` (the symmetric-catch fix) instead of crashing.
- Determinism: assert ruleId **sets**, not ordered arrays (smell/file order isn't guaranteed); copy the `afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined })` reset from `recommended-check.test.ts:26-29`.

### Phase 4 — Docs & CHANGELOG (~1.5 hours)

- `docs/presets.md`: delete the "unlike the other presets, X returns builders" asymmetry — the returning form becomes the _only_ documented preset behavior; shape-preset examples become `export default [...]` spreads or `checkAll(...)` in tests. Rewrite the severity framing (`presets.md:219` — "`'error'` (throws)"): error/warn now mean pipeline severity, not throws-at-call-time. Rewrite the "Aggregated errors" section (aggregation happens in the runner / `checkAll`).
- `docs/setup-best-practices.md`: delete the rung-2 caveat (shape presets now sit on the golden path); update the ladder example to spread them.
- `docs/running-in-tests.md`: preset section leads with **`checkAll(preset(p, opts))`** as the test-file terminal (not the raw `.flatMap().filter()` incantation).
- `docs/getting-started.md` / `docs/api-reference.md` (new `checkAll` export) / `docs/cli.md` (the "best-effort catch" note): align.
- `CHANGELOG.md`: `### Changed (breaking)` **leading with the ⚠️ ACTION REQUIRED** framing (Compatibility section) + the `checkAll`/codemod migration + the removed helpers.

### Phase 4b — Codemod (DEFERRED)

Not built now — see "Codemod — deferred" under Compatibility. `checkAll` + the loud CHANGELOG cover the migration at current (≈zero) adoption; ship a `migrate-presets` codemod only if real ≤0.15 usage appears.

### Phase 5 — Release note for `init` (out of scope, unblocked)

Plan 0050 gated `--preset layered|data-layer|strict-boundaries` out of `init` because they lacked a returning form. This plan unblocks that; adding them to `init` (placeholder globs + fill-me-in comments per 0050's Phase 2 notes) is a small **separate** follow-up — not folded in here.

## Files changed

| File                                                                                        | Change                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/presets/shared.ts`                                                                     | Add `collectRule`; delete `dispatchRule`, `throwIfViolations`           |
| `src/presets/{layered,boundaries,data-layer}.ts`                                            | Return `RuleBuilderLike[]`; 12 call sites via `collectRule`; no throw   |
| `src/presets/index.ts`                                                                      | Drop `dispatchRule`/`throwIfViolations` exports                         |
| `src/core/check-all.ts`                                                                     | New — `checkAll(rules, options?)` test-file terminal                    |
| `src/index.ts`                                                                              | Export `checkAll`                                                       |
| `src/cli/commands/check.ts`                                                                 | Comment-only: fallback catch is defensive, not a preset mechanism       |
| `src/cli/commands/baseline.ts`                                                              | Add the symmetric `ArchRuleError` catch (parity with `check`)           |
| `package.json`                                                                              | Version → 0.16.0                                                        |
| `tests/presets/shared.test.ts`                                                              | Migrate `dispatchRule`→`collectRule`; delete `throwIfViolations` tests  |
| `tests/presets/{layered,boundaries,data-layer}.test.ts`                                     | Rewrite throwing/spy assertions → severity-stamped violations           |
| `tests/core/check-all.test.ts`                                                              | New — pass / error-throws-aggregated / warn-non-failing                 |
| `tests/fixtures/presets/shape-presets/arch.rules.ts`                                        | New — real rule file for the loader-driven integration + baseline tests |
| `tests/integration/shape-presets-check.test.ts`                                             | New — real `loadRuleFiles`/`runCheck`/`runBaseline`; sibling-drop guard |
| `docs/{presets,setup-best-practices,running-in-tests,getting-started,api-reference,cli}.md` | One preset model; `checkAll`; severity framing                          |
| `CHANGELOG.md`                                                                              | `### Changed (breaking)` — ⚠️ ACTION REQUIRED + `checkAll`/codemod      |

## Out of scope

- **Adding shape presets to `init`** (Phase 5 note — separate small follow-up).
- **A one-release "created-but-never-consumed" runtime warning.** Considered (see Compatibility); rejected in favor of the codemod + `checkAll` for a days-old pre-1.0 library — the stateful process-exit tracking isn't worth it yet.
- **Deprecation shims / permanent dual API.** Explicitly rejected — see Goal.
- **Richer per-rule metadata** (`because`/`suggestion`/`imperative`) on shape-preset rules. `collectRule` keeps today's `{ id }`; enriching the metadata is valuable but orthogonal (candidate follow-up).
- **graphql/cross-layer builders** — not presets; unaffected.

## Strategic note

This closes the last seam from the v0.13 architecture change. Plan 0060 built the severity-aware pipeline; 0049/0044 built new presets natively on it; 0061 made the docs teach it as the golden path — and in doing so proved the three oldest presets don't fit their own family. After this plan, "preset" means exactly one thing everywhere: a function returning severity-carrying rules that compose in any runner. The docs caveat, the silent sibling-drop, the baseline crash, and the lost warn violations all disappear because their shared cause does.

The breaking cost is real but small and pre-1.0: one migration pattern, loudly documented. The alternative — an additive second API — would freeze today's inconsistency into the public surface permanently, which is the more expensive choice on any horizon longer than one release.

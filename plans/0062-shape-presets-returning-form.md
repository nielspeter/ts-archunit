# Plan 0062: Unify Shape Presets on the Returning Form

## Status

- **State:** DRAFT — ready for review/scheduling.
- **Priority:** P1 — the gap breaks rung 2 of the documented adoption ladder (plan 0061 routes around it with a caveat; this plan removes the cause).
- **Effort:** ~1 day (three preset migrations follow one template; test migration is mechanical; docs shrink).
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
// test file — severity-faithful execution
const violations = layeredArchitecture(p, opts).flatMap((r) => r.violations())
expect(violations.filter((v) => (v.severity ?? 'error') === 'error')).toEqual([])
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
 * UN-executed builder. 'off' → empty array (spread-friendly).
 */
export function collectRule<T extends PresetRule>(
  builder: T,
  ruleId: string,
  defaultSeverity: RuleSeverity,
  overrides: Record<string, RuleSeverity> | undefined,
): RuleBuilderLike[] {
  const effective = overrides?.[ruleId] ?? defaultSeverity
  if (effective === 'off') return []
  return [builder.rule({ id: ruleId }).asSeverity(effective)]
}
```

Both builder hierarchies already satisfy `PresetRule` (`RuleBuilder.rule/.asSeverity` return `this`; same for `TerminalBuilder`), so all 12 `dispatchRule` call sites across the three presets convert mechanically:

```typescript
// before                                            // after
violations.push(...dispatchRule(b, id, sev, ov))     builders.push(...collectRule(b, id, sev, ov))
...
throwIfViolations(violations)                        return builders
```

Signatures change to `(...): RuleBuilderLike[]`; option interfaces are untouched (same `overrides`, same rule IDs, same defaults).

### Warn rules get _better_, not just equivalent

`preset/layered/type-imports-only` and `preset/boundaries/no-duplicate-bodies` default to `'warn'`. Today their violations go to `console.warn` and vanish. After migration they carry `severity: 'warn'` through the pipeline: reported in terminal/JSON/github output, baseline-filterable, never failing the run — identical semantics to `recommended`'s warn rules.

### Crutch removal

- **Delete `throwIfViolations` and `dispatchRule`** from `shared.ts` **and from the public `./presets` exports** (`src/presets/index.ts:2` — they are currently public API; removal is part of the break).
- **`check.ts`'s fallback `ArchRuleError` catch stays** (`check.ts:41-47`) — it still protects against _user_ rule files that self-execute `.check()` at import — but the docs stop describing it as the shape-preset mechanism, and its code comment is updated to say "defensive: user file threw at import", not "handles self-executing presets".
- **`baseline.ts` needs no new catch** — the cause is gone. (Do NOT add one; that would re-legitimize import-time throwing.)

### Compatibility & versioning

Breaking for test-file users who call shape presets as throwing statements. Migration is one pattern:

```typescript
// before (throws on violation)
layeredArchitecture(p, opts)

// after — severity-faithful (warn rules don't fail the test)
const violations = layeredArchitecture(p, opts).flatMap((r) => r.violations())
expect(violations.filter((v) => (v.severity ?? 'error') === 'error')).toEqual([])

// after — strict (every rule must pass, warns included)
for (const rule of layeredArchitecture(p, opts)) rule.check()
```

Also breaking: `dispatchRule`/`throwIfViolations` removed from `@nielspeter/ts-archunit/presets`. CHANGELOG gets a `### Changed (breaking)` section with both, plus the migration snippet. Pre-1.0, ship as **0.16.0** (0.x semver permits breaking minors); if we instead want to declare the preset contract stable, this is the natural 1.0.0 — decision at release time, default 0.16.0.

## Implementation phases

### Phase 1 — `collectRule` in shared.ts (~30 min)

Add `collectRule` (+ the `PresetRule` interface) to `src/presets/shared.ts`. Keep `validateOverrides` unchanged. `dispatchRule`/`throwIfViolations` stay until Phase 2 flips the last caller, then delete both and their `index.ts` exports in the same commit.

### Phase 2 — Migrate the three presets (~2 hours)

For each of `layered.ts`, `boundaries.ts`, `data-layer.ts`:

- Signature → `(p, options): RuleBuilderLike[]`.
- `const violations: ArchViolation[] = []` → `const builders: RuleBuilderLike[] = []`.
- Each `violations.push(...dispatchRule(...))` → `builders.push(...collectRule(...))` (12 sites total).
- `throwIfViolations(violations)` → `return builders`.
- JSDoc: document the returning form and the spread usage.

Delete `dispatchRule` + `throwIfViolations` + their public exports. Update `src/presets/index.ts` (types unchanged; `collectRule` stays internal — not exported; it's preset plumbing, not user API).

### Phase 3 — Tests (~2.5 hours)

- **Migrate** `tests/presets/layered.test.ts`, `boundaries.test.ts`, `data-layer.test.ts` (33 `toThrow`/`ArchRuleError` assertions): throwing assertions become `.violations()` assertions — same fixtures, same rule-ID expectations, now asserting the violation list (and `severity` field for the two warn rules, which today can't be asserted at all).
- **New integration test** `tests/integration/shape-presets-check.test.ts` (mirrors `recommended-check.test.ts`): `export default [...recommended(p), ...layeredArchitecture(p, opts)]` through the real `runCheck` — single JSON document, layered errors set the exit code, `type-imports-only` warn is surfaced but non-failing, and **the floor rules are present** (the sibling-drop regression test).
- **Baseline test:** `generateBaseline` over a rule file containing a shape preset (the exact flow that crashes today) → baseline written, re-run passes.
- Inventory: off-override still omits the builder; unknown-override warning unchanged; per-rule severity stamping; `strict: true` isolation rule present/absent by option.

### Phase 4 — Docs & CHANGELOG (~1.5 hours)

- `docs/presets.md`: delete the "unlike the other presets, X returns builders" asymmetry — the returning form becomes the _only_ documented preset behavior; shape-preset examples become `export default [...]` spreads; the "Aggregated errors" section is rewritten (aggregation now happens in the runner).
- `docs/setup-best-practices.md`: delete the rung-2 caveat (shape presets now sit on the golden path); update the ladder example.
- `docs/running-in-tests.md`: preset section shows the severity-faithful pattern above.
- `docs/getting-started.md` step 5 / `docs/api-reference.md` / `docs/cli.md` (the "best-effort catch" note): align.
- `CHANGELOG.md`: `### Changed (breaking)` — returning form + removed helpers + migration snippet.

### Phase 5 — Release note for `init` (out of scope, unblocked)

Plan 0050 gated `--preset layered|data-layer|strict-boundaries` out of `init` because they lacked a returning form. This plan unblocks that; adding them to `init` (placeholder globs + fill-me-in comments per 0050's Phase 2 notes) is a small **separate** follow-up — not folded in here.

## Files changed

| File                                                                                                                                             | Change                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `src/presets/shared.ts`                                                                                                                          | Add `collectRule`; delete `dispatchRule`, `throwIfViolations`     |
| `src/presets/layered.ts`                                                                                                                         | Return `RuleBuilderLike[]`; 5+ call sites via `collectRule`       |
| `src/presets/boundaries.ts`                                                                                                                      | Same                                                              |
| `src/presets/data-layer.ts`                                                                                                                      | Same                                                              |
| `src/presets/index.ts`                                                                                                                           | Drop `dispatchRule`/`throwIfViolations` exports                   |
| `src/cli/commands/check.ts`                                                                                                                      | Comment-only: fallback catch is defensive, not a preset mechanism |
| `tests/presets/{layered,boundaries,data-layer}.test.ts`                                                                                          | Migrate throwing assertions → violations assertions               |
| `tests/integration/shape-presets-check.test.ts`                                                                                                  | New — full-family rule file through `runCheck` + baseline         |
| `docs/presets.md`, `docs/setup-best-practices.md`, `docs/running-in-tests.md`, `docs/getting-started.md`, `docs/api-reference.md`, `docs/cli.md` | One preset model                                                  |
| `CHANGELOG.md`                                                                                                                                   | `### Changed (breaking)` + migration                              |

## Out of scope

- **Adding shape presets to `init`** (Phase 5 note — separate small follow-up).
- **A `checkAll(rules)` convenience helper** for test files. The two-line severity-faithful snippet covers it; add a helper only if real demand appears (lego-bricks: don't ship a wrapper nobody asked for).
- **Deprecation shims / dual API.** Explicitly rejected — see Goal.
- **Richer per-rule metadata** (`because`/`suggestion`/`imperative`) on shape-preset rules. `collectRule` keeps today's `{ id }`; enriching the metadata is valuable but orthogonal (candidate follow-up).
- **graphql/cross-layer builders** — not presets; unaffected.

## Strategic note

This closes the last seam from the v0.13 architecture change. Plan 0060 built the severity-aware pipeline; 0049/0044 built new presets natively on it; 0061 made the docs teach it as the golden path — and in doing so proved the three oldest presets don't fit their own family. After this plan, "preset" means exactly one thing everywhere: a function returning severity-carrying rules that compose in any runner. The docs caveat, the silent sibling-drop, the baseline crash, and the lost warn violations all disappear because their shared cause does.

The breaking cost is real but small and pre-1.0: one migration pattern, loudly documented. The alternative — an additive second API — would freeze today's inconsistency into the public surface permanently, which is the more expensive choice on any horizon longer than one release.

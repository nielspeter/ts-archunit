# Bug 0040: two of three cross-layer conditions report nothing when a layer resolves nothing

**Reported:** 2026-08-01 · **Verified:** 2026-08-01, reproduced with a non-vacuous control
**Found in:** v0.36.3, while fixing [bug 0036](./fixed/0036-the-relative-glob-audit-is-incomplete.md)
**Severity:** **High** for the API defect below; Medium for the silence this bug is named after.
Two reviewers independently said the headline is the wrong defect, and they are right — see
"The defect an adopter hits first".

## The defect an adopter hits first

`haveMatchingCounterpart(layers: Layer[])` requires a `Layer[]` that **no public API can
produce**: `PairFinalBuilder.layers` is `private readonly` at every stage
(`cross-layer-builder.ts:136`, `:154`, `:178`) and `resolveLayer` is not exported. Every caller
must hand-build the array, duplicating the builder's own resolution.

Three published examples did not compile — two of them JSDoc on the public `crossLayer()` and
the builder class, so every user saw them on IDE hover — and one showed a chain form
(`.should().haveMatchingCounterpart()`) that does not exist. **Fixed in v0.37.0**, independent
of the runtime work.

What remains is the access problem, and it is what makes the rest of this bug hard: the
condition judges the caller's copy, so "Layer X matched 0 files" describes an array the library
never resolved. Measured — builder glob dead, hand-built layers populated → 2 counterpart
violations and no configuration finding at all.

**Fix: have `.should()` pass its own resolved layers to the condition.** That closes this, makes
[bug 0042](./fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md)'s
remedy true (it currently has to caveat that it names the caller's pattern), and is a
prerequisite for the silence fix below being meaningful.

## Description

A layer whose glob resolves to no files makes a pair rule enforce nothing. Measured on a
2-routes / 2-schemas fixture with `mapping: () => true`, comparing an intact configuration
against one where the left layer's glob is dead:

| Condition                 | all layers resolve | left layer resolves nothing |
| ------------------------- | ------------------ | --------------------------- |
| `satisfyPairCondition`    | **4** violations   | **0** — false green         |
| `haveConsistentExports`   | **4** violations   | **0** — false green         |
| `haveMatchingCounterpart` | 1 violation        | 1 — configuration finding   |

The intact column is non-zero, so the comparison is sound.

**`haveMatchingCounterpart` is already guarded** and must not be re-fixed:
`src/conditions/cross-layer.ts:39-53` has emitted an empty-left-layer configuration finding
since 2026-07-24, with the ADR-008 rationale in the comment above it. The first draft of this
bug claimed the fault was universal; it is not.

## The measurement this bug was originally filed on was vacuous

Worth recording, because it is the failure mode this project spends most of its guards on.

The provenance was `tests/core/relative-globs-are-uniform.test.ts:167-174`: _"a `crossLayer`
pair rule produces zero violations whether its layer resolves three files or none."_ That was
measured with `haveMatchingCounterpart([])` (`:181`), and the condition's first statement is:

```ts
// src/conditions/cross-layer.ts:27
if (layers.length < 2) return []
```

The condition was switched off. Both runs return `0` because nothing ran — rule 5's question
asked of the measurement itself (_what would this show if the thing it measures worked
perfectly?_) answers "0 and 0". The bug is real; that measurement did not establish it, and it
pointed at the one condition already fixed.

## Root cause — and it is not where the first draft said

The runtime path **does** consult the dead-glob verdict. `violations()` →
`collectWithAssertionGuard()` (`src/core/terminal-builder.ts:220`, `:164`) →
`deadSelectorFindings()` (`:174`), which computes `isDeadGlobTree`. Measured on a live rule
with a dead layer glob: **tree dead = true, site dead = true.** It is discarded one line later:

```ts
// src/core/terminal-builder.ts:433
if (site.position !== 'selector') continue
```

The filter's stated premise (`:388`) is _"`discovery` already fails (0067-D, and the slice
builders own their own message)"_. **That premise is false for crossLayer**, and it is the
actual root cause.

Two sub-claims from the first draft, corrected:

- **`position: 'discovery'` — correct.** Declared at `src/builders/cross-layer-builder.ts:207`;
  a live rule's `globs()` shows `position: "discovery"`, `base: "absolute"` on both layer sites.
- **"Zero pairs is the normal state of a compliant codebase" — wrong.** Zero _violations_ is
  the compliant state; the compliant control produced **4 pairs**. The pairs **are** the
  subjects, so zero pairs is precisely the ∀-over-∅ shape, and the pair count is the best
  available signal — it also catches a dead `mapping` function, which a per-layer glob check
  cannot. The real reason `rule-builder.ts`'s empty-selection gate never runs is that
  `PairFinalBuilder extends TerminalBuilder` (`cross-layer-builder.ts:170`), not `RuleBuilder`;
  `collectViolations()` (`:213-224`) goes straight to `condition.evaluate(...)`.

## What is already guarded

The declaration half, confirmed: `tests/core/diagnose.test.ts:217-232` (dead layer glob
reported, exact identity), `:315-325` (false-red control with a `selects(glob) > 0` vacuity
guard), `tests/core/relative-globs-are-uniform.test.ts:165-188`,
`tests/core/glob-declaration.test.ts:193-219`.

Two overstatements to retire: **`base`** is covered only by a classification entry in
`tests/core/every-path-glob-surface-is-classified.test.ts:65`, not by a behavioural assertion;
and **`doctor`** has no test driving it over a crossLayer rule — it inherits by delegation
(`src/cli/commands/doctor.ts:48`). True by delegation, not directly covered.

## Fix — reuse, do not build a producer

The first draft asserted _"the finding has to come from the builder, because only it knows a
layer resolved empty."_ **Measured false.** `isDeadGlobTree` / `isDeadSite`
(`src/core/glob-evaluator.ts:29`, `:65`) over `pathUniverse(project)` answers exactly that;
across 9 globs the two derivations agreed 9 times out of 9, by construction — both consult the
absolute and tsconfig-relative views (`path-universe.ts:79` vs `cross-layer-builder.ts:25-26`).

So the fix is **admitting `discovery` sites at `terminal-builder.ts:433`** and reusing
`deadSelectorViolation` (`:455-482`). That inherits the shared `FAULT_ADVICE` / `ON_DISK_ADVICE`
tables, `bypassFilters`, the bug-0021 discipline of never inheriting the author's `suggestion`,
and the property the docstring at `:396-399` explicitly buys — that `doctor`'s pre-flight and
the gate can never disagree. A builder-side producer re-implements all of it and becomes a
thirteenth configuration-finding producer, which is what
[plan 0078](../plans/0078-derive-the-configuration-finding-census.md) exists to stop. ADR-006
and the lego-bricks principle both say reuse.

Two caveats for the plan:

- The message is selector-worded (_"This rule's selector … can never match anything"_). It needs
  a position-aware noun, not a second producer.
- The filter is shared by **four** builders — `slice-rule-builder.ts:140,159`,
  `smells/smell-builder.ts:88`, `graphql/resolver-rule-builder.ts:105`,
  `cross-layer-builder.ts:207`. Slice already emits `emptyDiscoveryViolation`
  (`slice-rule-builder.ts:262-263`) and would double-report; `dedupe-config-findings.ts` exists
  for that.

**On `.expectEmpty()`:** the right instinct, not a free reuse. It lives on `RuleBuilder`, and
neither `CrossLayerBuilder` nor `PairFinalBuilder` is one — adopting it means lifting into
`TerminalBuilder`, where `assertsCardinality` already sits (`:409`). A **per-layer** form is
better: `.layer(name, glob, { expectEmpty: true })`, because emptiness is a property of a layer
and a rule-level flag cannot say _which_ layer may be empty. `assertDiscovered`
(`presets/shared.ts:55`) is precedent for the shape, not a call site — it takes a `discovered`
array and returns `RuleBuilderLike[]`, so it is preset-only.

## The missing case: a wrong remedy, not silence

The loop at `src/conditions/cross-layer.ts:32` only inspects `layers[i]`, never `layers[i+1]`,
so the **final** layer of a chain is never checked. With `haveMatchingCounterpart` and the
_schemas_ layer empty:

```
File "order-route.ts" in layer "routes" has no matching counterpart in layer "schemas"
File "user-route.ts"  in layer "routes" has no matching counterpart in layer "schemas"
```

An agent obeying that writes two schema files, the glob is still wrong, and they still do not
match. That is [bug 0017](./fixed/0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md)'s
shape — rule 2's behavioural corollary — and it is arguably worse than the silence, because the
remedy is confidently wrong rather than absent. A per-layer finding covers it.

## Adjacent defect at the same entry point

`haveMatchingCounterpart(layers)` makes the caller hand-construct a `Layer[]` that duplicates
the builder's internal resolution, and the guard at `cross-layer.ts:39` therefore reads **the
user's copy**, not the builder's. Rule 5 inverted: the guard is fed by a hand-maintained second
copy of the thing it guards. Measured — builder glob dead, user's hand-built layers still
populated — it reports 2 counterpart violations when the truth is that the routes layer
resolved zero files.

The docs cannot show the correct call: `docs/cross-layer.md:36` is literally
`haveMatchingCounterpart(/* pass resolved layers */)` and `:96` says "typically from the builder
internals". **Three published examples do not compile** — `cross-layer-builder.ts:70`, `:239`,
`docs/what-to-check.md:498` all show `haveMatchingCounterpart()` with no argument.

## Guard

Independent — it observes through `violations()` rather than restating `isDeadSite`. With the
fix reverted both runs return `[]`, identities equal, test fails.

Three things the first draft's guard missed:

- **It passes on a fix that false-reds every crossLayer rule.** Emit the finding unconditionally
  and the dead run yields `{finding}`, the live run `{finding, 4 pair violations}` — different
  identities, guard green. The control must also assert the live run produces **no**
  configuration finding. The diagnosis half already has this control
  (`diagnose.test.ts:315`); the runtime half needs its own.
- **The condition choice is load-bearing.** Written against `haveMatchingCounterpart` the guard
  passes today, before any fix. Use `satisfyPairCondition` or `haveConsistentExports`, assert
  the pre-fix red, and say so in the test — given this bug's own measurement fell into exactly
  that trap.
- **Enumerate the right-hand and final-layer cases**, which produce a wrong remedy rather than
  silence. Rule 5's enumeration corollary: the list is the thing that fails.

Minor: "assert the control resolved a non-zero number of files" is not directly assertable —
`PairFinalBuilder.layers` is private (`cross-layer-builder.ts:178`), `resolveLayer` is not
exported, and `globs()` returns the glob rather than the files. The control's violation count is
the proxy.

## Scope — read, not measured

`graphql/resolver-rule-builder.ts:225-227` is an explicit `if (filtered.length === 0) return []`
on a builder whose globs are also `position: 'discovery'` (`:105`), and
`smells/smell-builder.ts:123-124` has no empty guard at all (globs at `:88`). Same class by
inspection; **no working probe was obtained against either**. If it holds, this bug is filed one
entry point too narrow and the `terminal-builder.ts:433` fix covers all of them — which is an
argument for fixing it there rather than in the builder.

## Related

- [Bug 0036](./fixed/0036-the-relative-glob-audit-is-incomplete.md) — where this surfaced.
- [Bug 0042](./fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md) — a second,
  independent defect in the same `cross-layer.ts:39-53` block.
- [Plan 0074](../plans/completed/0074-r3b-the-selector-glob-flip.md) — the gate whose
  `position !== 'selector'` filter this sits outside.
- [Plan 0078](../plans/0078-derive-the-configuration-finding-census.md) — why the fix must reuse
  the existing producer rather than add one.

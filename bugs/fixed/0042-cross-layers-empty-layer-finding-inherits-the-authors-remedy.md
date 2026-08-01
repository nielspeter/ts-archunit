# Bug 0042: cross-layer's empty-layer finding inherits the author's remedy

**Reported:** 2026-08-01 · **Fixed:** 2026-08-01, unreleased
**Verified:** measured through the public API before and after
**Found in:** v0.36.3, by the review of [plan 0078](../../plans/0078-derive-the-configuration-finding-census.md)
**Severity:** Medium. A live recurrence of
[bug 0021](./0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md) at a
producer that bug's fix never reached — and it also ships a configuration finding with **no
remedy at all** when the author supplied none.

## Description

`src/conditions/cross-layer.ts:39-53` reports an empty left layer, correctly, and then copies
the author's metadata onto the finding:

```ts
message: `Layer "${leftLayer.name}" matched 0 files — a correspondence over an empty layer
          enforces nothing. Fix the layer glob.`,
suggestion: context.suggestion,   // ← the author's remedy for a real violation
docs: context.docs,               // ← the author's docs page
bypassFilters: true,
```

Two distinct faults fall out of those two lines.

**With author metadata — the finding carries a remedy that cannot apply.** Measured:

```json
{
  "message": "Layer \"ghost\" matched 0 files — …",
  "suggestion": "Split the cycle by extracting a shared module.",
  "docs": "https://example.test/authors-page",
  "bypassFilters": true
}
```

The formatter renders `suggestion` under `Fix:`, so a finding that says _your layer glob matched
nothing_ instructs the reader to extract a shared module. That is bug 0021 exactly, and rule 2's
"a remedy that is impossible on the path that produced it is worse than no message".

**Without author metadata — the finding carries no remedy at all.** `ConditionContext.suggestion`
is optional (`src/core/condition.ts:19`), so with no `.rule({ ... })` the finding ships bare:

```json
{ "message": "Layer \"ghost\" matched 0 files — …", "bypassFilters": true, "severity": "error" }
```

`execute-rule.ts:161` deliberately refuses to backfill a `bypassFilters` finding — correctly,
per bug 0021 — so nothing rescues it downstream. This is the **one** configuration-finding
producer of twelve that can reach a reader with no remedy.

## Why bug 0021's fix did not reach it

`execute-rule.ts`'s guard strips the author's `suggestion`/`docs` from a `bypassFilters` finding
only where the producer left the fields for backfill. This producer **sets** them itself, so
there is nothing for the guard to withhold — the same escape
`correspondence-builder.ts:383` hit and closed with a producer-side override.
`cross-layer.ts:52` was missed.

## Why the suite does not catch it

`tests/core/config-findings-carry-their-own-remedy.test.ts` enumerates **three** producers by
hand — `functions`, `slices`, `correspondence` — and `cross-layer` is not among them. Its
universal case asserts `expect(f.suggestion).toBeTruthy()`, which is presence rather than
correctness, so it would pass on the first fault above even if it did reach this producer.

That hand-written enumeration is the subject of
[plan 0078](../../plans/0078-derive-the-configuration-finding-census.md). This bug is the live
instance proving the plan's premise.

## Fix

Follow `correspondence-builder.ts:383`: give the producer its own remedy and stop copying
`context.suggestion` / `context.docs`. The message already states the fix in prose — _"Fix the
layer glob"_ — so the `suggestion` should be the actionable form of that, naming the layer and
its glob.

Keep `ruleId` and `because`. Per bug 0021's own test, `ruleId` says _which_ rule enforces
nothing (needed, and not a claim about a cause) and `because` is context rather than a remedy.

Per rule 3 the finding should also state that it cannot be suppressed — plan 0078, Phase 3.

## Guard

Two directions, which is what bug 0021's existing test establishes as the shape and what a
`toBeTruthy()` check cannot do:

- with a deliberately wrong author `suggestion` set via `.rule({ ... })`, the configuration
  finding carries **`not.toBe(AUTHOR.suggestion)`** and still carries `ruleId` and `because`;
- with no author metadata, `suggestion` is non-empty;
- **a real violation of the same rule inherits all four** — the control, without which "strip
  everything everywhere" passes.

Vacuity guard: assert the empty-layer finding is actually produced (count ≥ 1) before asserting
anything about its fields.

## Related

- [Bug 0021](./0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md) — the
  original, and the source of the two-direction test shape.
- [Bug 0040](../0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md) — a
  different defect in the same block: two sibling conditions have no empty-layer guard at all.
- [Plan 0078](../../plans/0078-derive-the-configuration-finding-census.md) — the census that would
  have found this, and whose Phase 2 must assert correctness rather than presence.

## Fix as shipped

`suggestion` / `docs` are no longer copied from `context`. The producer states its own remedy,
naming the layer:

> Widen the glob for layer "ghost" until it matches at least one file, or remove the layer from
> the chain. Until then every pair through it is unchecked, so the rule reports nothing whether
> the code complies or not.

`ruleId` and `because` stay, per bug 0021's own reasoning. `docs` is dropped rather than
replaced — there is no fault-specific page to point at, and the author's is about their rule.

## Guard

`tests/conditions/cross-layer-finding-owns-its-remedy.test.ts`, four cases, two-directional
because `toBeTruthy()` passes on the defect:

- with author metadata — `not.toBe(AUTHOR.suggestion)`, `not.toBe(AUTHOR.docs)`, and the remedy
  names the layer; `ruleId` and `because` still inherited;
- with none — a remedy is present;
- **control** — a real violation of the same rule inherits all four, without which "strip the
  author's fields everywhere" passes;
- vacuity — the empty layer actually produces the finding.

The fixture hand-builds `Layer[]` because `haveMatchingCounterpart` takes it as an argument
(the adjacent defect in [bug 0040](../0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)).
Passing `[]` would switch the condition off at `if (layers.length < 2) return []` and make every
assertion vacuous — which is exactly the trap 0040 was originally filed on.

## Sabotage — 2 of 2

| Revert                                        | Expected | Result |
| --------------------------------------------- | -------- | ------ |
| S2 — restore `suggestion: context.suggestion` | red      | CAUGHT |
| S4 — strip the remedy entirely                | red      | CAUGHT |

Both directions, because the two faults are independent: the wrong remedy and no remedy.

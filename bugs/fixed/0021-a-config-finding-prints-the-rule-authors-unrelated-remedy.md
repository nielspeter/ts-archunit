# Bug 0021: a configuration finding prints the rule author's unrelated remedy as its `Fix:`

**Reported:** 2026-07-28
**Fixed:** 2026-07-28
**Found in:** all versions through v0.21.0
**Severity:** High — a finding that says "this rule discovered nothing" prints, as its sanctioned fix, whatever the author wrote about the thing the rule was supposed to check. ADR-008 rule 2: a failure may not assert a cause it cannot verify. The code that was written to prevent exactly this is overridden one layer up.

## Description

`src/core/execute-rule.ts:132-139` enriches every violation with rule-level metadata:

```ts
result = result.map((v) => ({
  ...v,
  ruleId: v.ruleId ?? meta?.id,
  because: v.because ?? ctx.reason ?? meta?.because,
  suggestion: v.suggestion ?? meta?.suggestion,
  docs: v.docs ?? meta?.docs,
}))
```

That is correct for a violation of the rule. It is wrong for a **configuration finding** — a
`bypassFilters` violation, which reports that the rule enforces _nothing_. The author's
`suggestion` describes how to fix the thing the rule checks; the finding says the rule never
checked it. Juxtaposing them produces a remedy that cannot apply.

`src/builders/slice-rule-builder.ts:270-278` already identified this and guarded against it:

> Deliberately does NOT carry the rule author's `suggestion`/`docs` … a false remedy by
> juxtaposition

The guard is defeated, because the enrichment happens after the builder returns.

## Reproduction

Against `tests/fixtures/slices`:

```typescript
slices(p)
  .matching('src/nowhere/')
  .should()
  .beFreeOfCycles()
  .rule({ id: 'slices/no-cycles', suggestion: 'Split the cycle by extracting a shared module.' })
  .violations()
```

Measured:

```
message:        matching("src/nowhere/") resolved no slices: the prefix "src/nowhere/" …
suggestion:     Split the cycle by extracting a shared module.
bypassFilters:  true
severity:       error
```

`src/core/format.ts:38` renders `suggestion` as `Fix:`. So an agent is told to split a cycle in
a rule that discovered no slices to look for cycles in.

## Scope

Six shipped producers of `bypassFilters` findings, and the two precedents disagree with each
other about policy:

- `emptySelectionViolation()` (`src/core/rule-builder.ts:338`) **carries** `because`,
  `suggestion` and `docs` deliberately.
- `SliceRuleBuilder.metaViolation` (`:270`) **omits** them deliberately, with the reasoning
  quoted above.

Both cannot be right. The omitting one is right, and it is the one that loses — twice over,
since `execute-rule.ts` re-adds what it dropped.

## Fix

Four changes, not the one the first draft of this write-up predicted. The single
`execute-rule.ts` guard was necessary and **not** sufficient, because three of the producers
copy the metadata themselves and so never reach it:

1. **`execute-rule.ts`** — never inherit `suggestion`/`docs` onto a `bypassFilters` finding.
2. **`emptySelectionViolation`** (`rule-builder.ts`) — was copying `this._metadata?.suggestion`
   and `?.docs` directly. Now carries its own: _"Widen the selector until it matches at least
   one subject, or drop `.expectNonEmpty()` if matching nothing is valid here."_
3. **`SliceRuleBuilder.metaViolation`** — the producer whose comment asked for the omission.
   It was already correct about the author's fields (its `docs: GLOB_DOCS` is its own), but it
   had **no `suggestion` at all** and was relying on the enrichment. Now carries one that
   defers to the message, deliberately: `emptyDiscoveryMessage` derives a per-branch remedy and
   each branch is reachable only when its advice is true, so restating it in `suggestion` would
   mean two texts to keep in agreement.
4. **`CorrespondenceBuilder.emptyViolation`** — its `baseViolation` helper is shared with real
   violations, where inheriting the author's remedy is correct. The override has to be at the
   producer; the `execute-rule.ts` guard cannot reach it.

**`because` is kept, contrary to this write-up's first draft.** It states why the rule exists,
which is context rather than a claim about this finding's cause, and both existing producers
set it deliberately. `ruleId` is kept for the same reason: it says _which_ rule enforces
nothing, which is the first thing the reader needs.

### What the fix exposed

Removing the inherited remedy immediately failed `tests/presets/shared.test.ts` —
_"layeredArchitecture: no violation reaches the user without a remedy"_. That invariant is
ADR-008 rule 2 in the other direction, and it is what forced changes 2-4: dropping the
inherited remedy without providing a real one would have traded a false `Fix:` for no `Fix:`.
Two of the six producers had never had their own.

## Guards

`tests/core/config-findings-carry-their-own-remedy.test.ts`, five cases, asserting **three**
producers rather than one — a single-producer test would have passed on the builder that
already tried while the layer that defeated it went unguarded.

Verified by reverting each of the four production changes **one at a time**:
**caught-by-nothing 0 of 4.** Reverting the `execute-rule.ts` guard alone fails 2; the three
per-producer remedies fail 2, 3 and 2.

## Guard this needs (as specified before implementation)

- A config finding on a rule that declares `.rule({ suggestion, docs })` and `.because()` carries
  **none** of the three, and still carries `ruleId`.
- A normal violation on the same rule carries all four — or the guard is satisfied by dropping
  metadata everywhere.
- Asserted for at least two of the six producers, since the bug is that one builder's deliberate
  omission was silently reversed; a single-producer test would not have caught the layering.

## Relationship to plan 0070

**Blocks it.** [Plan 0070](../../plans/0070-a-rule-must-assert-something.md) adds a sixth kind of
configuration finding — "this rule asserts nothing" — whose whole value is that it carries the
right remedy for one of four distinguishable states. Shipping it before this fix means its
`Fix:` line is whatever the author wrote about something else, which is the defect it is
partly meant to correct.

It is also the same defect as one of 0070's own notes on accumulate: under accumulate, an
inherited condition's violations are reported by the derived rule and stamped with the derived
rule's `because` and `suggestion`. One cause, three symptoms, one place to fix it.

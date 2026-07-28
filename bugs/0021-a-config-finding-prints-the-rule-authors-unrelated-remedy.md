# Bug 0021: a configuration finding prints the rule author's unrelated remedy as its `Fix:`

**Reported:** 2026-07-28
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

## Suggested fix

Do not enrich a `bypassFilters` finding:

```ts
result = result.map((v) => (v.bypassFilters ? v : { ...v /* …as today… */ }))
```

One line, at the layer where the defect is, and it closes all six producers at once rather than
per builder. Then `emptySelectionViolation` can keep passing its own text explicitly if that
text is verified to apply — the point is that inheritance is what cannot be verified.

`ruleId` is the exception worth keeping: it identifies _which_ rule enforces nothing, which the
reader needs and which is not a claim about a cause. Keep `ruleId`, drop `because`, `suggestion`
and `docs`.

## Guard this needs

- A config finding on a rule that declares `.rule({ suggestion, docs })` and `.because()` carries
  **none** of the three, and still carries `ruleId`.
- A normal violation on the same rule carries all four — or the guard is satisfied by dropping
  metadata everywhere.
- Asserted for at least two of the six producers, since the bug is that one builder's deliberate
  omission was silently reversed; a single-producer test would not have caught the layering.

## Relationship to plan 0070

**Blocks it.** [Plan 0070](../plans/0070-a-rule-must-assert-something.md) adds a sixth kind of
configuration finding — "this rule asserts nothing" — whose whole value is that it carries the
right remedy for one of four distinguishable states. Shipping it before this fix means its
`Fix:` line is whatever the author wrote about something else, which is the defect it is
partly meant to correct.

It is also the same defect as one of 0070's own notes on accumulate: under accumulate, an
inherited condition's violations are reported by the derived rule and stamped with the derived
rule's `because` and `suggestion`. One cause, three symptoms, one place to fix it.

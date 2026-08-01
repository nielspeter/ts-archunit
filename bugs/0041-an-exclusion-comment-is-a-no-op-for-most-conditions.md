# Bug 0041: an inline exclusion comment is a no-op for most conditions

**Reported:** 2026-08-01 · **Verified:** 2026-08-01, measured through the public API
**Found in:** v0.36.3, by the review of [bug 0039](./0039-an-undocumented-exclusion-comment-suppresses-and-only-warns.md)
**Severity:** High. A **documented public feature that silently does nothing** for the
library's most-used conditions. The user writes the sanctioned exemption, the finding keeps
firing, and nothing says why. There is no error, no warning, and no diagnostic — the comment is
simply ignored.

## Description

`isExcludedByComment` bails when the violation has no `ruleId`
(`src/core/exclusion-comments.ts:262-263`):

```ts
const ruleId = violation.ruleId
if (!ruleId) return false
```

But `ruleId` is stamped onto violations from the rule's metadata **after** the comment-filtering
block has already run. In `src/core/execute-rule.ts`:

```
:102-131   comment scan and filter        ← isExcludedByComment runs here
:141       ruleId: v.ruleId ?? meta?.id   ← ruleId is stamped here
```

So an exclusion comment matches only violations whose **producing condition** stamped `ruleId`
itself. For every condition that leaves it to the enrichment step, the comment is inert.

## Reproduction

Rule carries an id; comment is documented and correctly placed:

```ts
modules(p)
  .that()
  .resideInFile('**/consumer.ts')
  .should()
  .notImportFrom('**/forbidden*')
  .rule({ id: 'probe/no-forbidden' })
```

```
surviving violations: 1  [{"ruleId":"probe/no-forbidden","line":2}]
```

Not suppressed. Note the returned violation **carries the matching `ruleId`** — stamped by the
later enrichment — which is the ordering, demonstrated. The identical source under `classes()`
_is_ suppressed, because `classes()`' condition routes through `createViolation`, which stamps.

## Which conditions are affected

Non-stamping sites, so exclusion comments do not work for them:
`dependency.ts:89,147,392`; `exports.ts:21,51,93`; `slice.ts:106,161,205`;
`reverse-dependency.ts:148,194,236`; all four module-body conditions in
`body-analysis-module.ts`; plus `function.ts`, `call.ts`, `pattern.ts`.

That list includes the dependency and import conditions, which are the ones an adopting team
reaches for first.

## Why it survived the suite

`tests/helpers/exclusion-comments.test.ts:181-204` is the only end-to-end test of the feature,
and it uses `alwaysFail` from `tests/support/test-rule-builder.ts`, which stamps
`ruleId: context.ruleId`.

The test and the code were written from the same understanding of where `ruleId` comes from, so
they agree — and they agree even though the feature does not work.
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5, on our own suite: _a test that
restates the implementation is not a test of the implementation._

## Fix

Move the stamping before the filter, or stamp `ruleId` at the point the filter needs it. Two
routes, and the choice is not obvious:

1. **Reorder** — enrich `ruleId` before the comment block at `:102`. Smallest diff. Check what
   else the block at `:102-131` assumes about un-enriched violations before doing it; `because`,
   `suggestion` and `docs` are enriched in the same pass, and the `bypassFilters` carve-out at
   `:141-150` is deliberate (bug 0021) and must not move with it.
2. **Resolve the id at the filter** — pass `ctx.metadata?.id` into `isExcludedByComment` and let
   it fall back. Keeps the enrichment ordering untouched, at the cost of the rule id having two
   sources.

Either way, this is a behaviour change in the direction of **more suppression**: rules that were
silently ignoring a user's exemption will start honouring it, so findings will disappear from
reports. That is the user getting what they asked for, but it must be in the release note, and
it interacts with [bug 0039](./0039-an-undocumented-exclusion-comment-suppresses-and-only-warns.md) —
fixing this widens 0039's fail-open from `createViolation` conditions to all of them. **Sequence
0039's decision first, or ship them together.**

## Guard

The independent derivation is **the same source under two builders**. Today `classes()`
suppresses and `modules().notImportFrom()` does not, from identical comment text — that
asymmetry is the bug, stated as a test, and it cannot pass by restating the implementation.

Rows:

- one condition per non-stamping family (dependency, exports, slice, reverse-dependency,
  module-body) — a documented comment suppresses;
- a `createViolation` condition — still suppresses (the control; must not regress);
- **no comment at all** — the violation fires. The vacuity guard, without which every row above
  is green for the wrong reason;
- a comment naming a **different** rule id does not suppress. Otherwise a fix that makes
  `isExcludedByComment` always return true passes every row.

Sabotage: revert the reorder and assert the suite reds — specifically that the non-stamping rows
red, since the `classes()` control is green either way.

## Related

- [Bug 0039](./0039-an-undocumented-exclusion-comment-suppresses-and-only-warns.md) — gated by
  this one; its fail-open currently reaches only the conditions that stamp.
- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5 — the same-derivation test that
  hid this.
- `docs/violation-reporting.md:223-255` — the documentation this bug makes untrue for most rules.

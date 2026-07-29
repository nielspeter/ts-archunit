# Bug 0020: `should()` twice silently drops the first assertion

**Reported:** 2026-07-28
**Fixed:** 2026-07-29 (v0.23.0)
**Found in:** all versions through v0.20.0
**Severity:** High — an assertion the author explicitly wrote is discarded, with no output. The rule reads as if it checks two things, checks one, and goes green.

## Description

`RuleBuilder.should()` calls `fork()` (`src/core/rule-builder.ts:71-75`), and `fork()` clears the condition list (`:269-274`):

```ts
protected fork(): this {
  const fork = this.copy()
  fork._conditions = []        // <-
  fork._reason = fork._metadata?.because ?? this._reason
  return fork
}
```

So a second `.should()` on a builder that already carries a condition throws the first one away.

## Reproduction

Against `tests/fixtures/poc`:

```
.that().haveNameMatching(/^parse/).should().notExist().should().beExported()   ->  0 violations

  notExist   alone   ->  4 violations
  beExported alone   ->  0 violations
```

Two assertions written, one enforced, four findings lost, no warning — the rule then lands in the state [bug 0019](./0019-a-rule-with-no-condition-passes-in-total-silence.md) describes if the surviving condition is also dropped.

## The same shape behaves differently on five other builders

`should()` is a bare `return this` on `SliceRuleBuilder`, `CorrespondenceBuilder`, `SchemaRuleBuilder` and `ResolverRuleBuilder`, so conditions **accumulate** there. Measured on `tests/fixtures/slices`:

```
held    = slices(p).matching('src/').should().respectLayerOrder('controllers','services','domain','bad')
  held.violations()                          ['leaky-controller.ts']
  held.should().violations()                 ['leaky-controller.ts']       <- survives
  held.should().beFreeOfCycles().violations() ['leaky-controller.ts', '[feature-a, feature-b]']
```

One source shape, two behaviours, decided by which entry point you used. Before [bug 0016](./0016-narrowing-a-named-selection-mutates-it.md) this was invisible — everything mutated _and_ accumulated, so the divergence was buried in the leak. Fixing 0016 is what made it stable and observable.

## Which direction is safe

The two failure modes are not symmetric, and that is the whole decision:

|                                 | Failure mode                                                                   | Direction        |
| ------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| **Clear** (`RuleBuilder`)       | An assertion the author wrote is discarded; the rule can reach zero conditions | **silent green** |
| **Accumulate** (the other five) | A derived rule reports the held rule's finding as its own                      | **loud red**     |

Conditions AND together and violations union, so accumulate can only ever assert _more_. It cannot produce a rule that asserts nothing. Clear can, and does.

Under ADR-008 there is no contest: a misattributed finding is read, investigated and fixed in one pass; a dropped assertion is never read at all.

## Suggested fix

Accumulate everywhere — remove `fork._conditions = []`, which collapses `fork()` into `copy()`.

Three things make this smaller than it looks:

- **`fork()`'s stated purpose is already served.** Its docstring said it exists "to support named selections without mutation". That is what `copy()` does as of bug 0016. The clearing is a vestige of the era when `should()` forking was the only protection against a held selection being edited in place.
- **The fluent path is unaffected.** `should()` on a builder with zero conditions makes the clearing a no-op, so every ordinary chain behaves identically. The divergence needs a held builder that already carries a condition — post-0016, that means holding a _rule_, not a selection.
- **The "I want a fresh assertion off the same subjects" case has a correct spelling already**: hold the selection, before `.should()`. Bug 0016 is what made that safe, and it is the form `docs/core-concepts.md` and `docs/classes.md` already teach.

## Guard this needs

Removing `fork._conditions = []` breaks **0 of 2340** tests. That is not reassurance — it is the finding. The behaviour is unguarded in both directions, so whichever way this is decided it needs its own pins:

- `.should().X().should().Y()` reports the union of X's and Y's violations, both non-zero and distinguishable by element (not by count — see the `1 === 1` note in bug 0016's guards).
- A rule held past `.should()` still asserts its own condition after a second rule is derived from it.
- The fluent single-`should()` form is unchanged.
- Same four assertions on one accumulating builder, so the two hierarchies are pinned to one semantics rather than to each other's current behaviour.

Sabotaging `fork()`'s copy (`const fork = this`) is also **0 of 2340** today, and it is a live false green: it clears the held rule's conditions in place. That pin belongs here too.

## Relationship to plan 0069

Ships with **[plan 0070](../../plans/completed/0070-a-rule-must-assert-something.md)'s 0.23.0**, not with R3b — 0070 took over proposal 019 and both bugs. R3b is what turns "zero conditions" from a silent pass into a failure ([bug 0019](./0019-a-rule-with-no-condition-passes-in-total-silence.md)); accumulating on its own upgrades a silent drop into an over-report, which is an improvement but leaves 0019 open.

Also relevant to R3b's verdict rule, which reads "`andShould()` ANDs, so the verdict on empty is **every** condition is exempt." That verdict depends on how many conditions a rule ends up carrying — which is exactly what diverges here. Settling this after R3b ships means settling it as a bug report against R3b.

## How it was fixed

**v0.23.0.** One line: `RuleBuilder.fork()` no longer clears `_conditions`. Conditions accumulate,
so a second `.should()` on one chain behaves exactly as `.andShould()` does — measured 4 + 4 = 8
violations, identical to the `.andShould()` spelling. A `satisfy(condition)` written _before_
`.should()` is retained too, which was a second silent drop nobody had reported.

`fork()` itself survives as `copy()` plus the `_reason` resolution: it is `protected` on an
exported class, so deleting it is a compile break for an external subclass. Its docstring now says
the name is historical and warns the reader not to read behaviour from it.

**The consequence for baselines, and the reversal that came with it.** Accumulate lengthens the
rule description, and the description is hashed — so entries for a rule derived off a held rule
stop matching and their accepted violations report as new. The release first bumped `HASH_VERSION`
2 -> 3 to signal that, and **two independent reviews measured the bump as a defect**:
`hashViolation()` never reads the constant, so it changed no hash and matched no entry
differently, while routing every pre-0.23.0 baseline into the version-mismatch branch and telling
those users the format was "the likely cause" — which cannot be true, and which buried the
root-mismatch branch that usually is. Reverted to 2, with the real consequence disclosed in the
CHANGELOG as a content change rather than a format change. See
[bug 0027](./0027-an-unmatched-baseline-entry-cannot-be-diagnosed.md) for the diagnosis gap that
leaves open — which is what the bump was reaching for and did not achieve.

**Why the naive guard was not enough.** The obvious test — assert a two-`.should()` rule reports 8
— passes under a sabotaged `copy()` that shares the array, because every assertion happened to read
the builder _after_ the derivation. The shipped guard discriminates by violation **message**, not
by count, and is verified against both the clearing implementation and the sharing one.

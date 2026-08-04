# Bug 0054: `within()` makes `helpers/` depend on `builders/`, closing a real cycle

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.52.0)
**Found in:** every version since `within()` shipped (plan 0015), by
[plan 0084](../../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md) turning our own
`arch/no-cycles` rule on for the first time.
**Severity:** Low as a runtime defect — nothing misbehaves; ESM handles this cycle. Medium as
architecture: it is the one cycle in our source, and it inverts a layering direction we enforce
everywhere else.

## What

`src/helpers/within.ts:2`:

```ts
import { ScopedFunctionRuleBuilder } from '../builders/scoped-function-rule-builder.js'
```

A **value** import, so `helpers → builders` is a runtime edge. Since `builders` imports from
`helpers`, `conditions` and `predicates` freely, the strongly-connected component is:

```
[builders, conditions, helpers, predicates]
```

`helpers` depending on `builders` is backwards, and **we already knew**. `arch/helpers-no-builders` in
`tests/archunit/arch-rules.test.ts` has enforced the opposite direction at `.check()` since plan 0015,
with this waiver:

```ts
.excluding('within.ts') // within() intentionally creates scoped builders
```

So `arch/no-cycles` did not discover a new violation. It found **the same misplaced file from the other
direction** — one rule sees an illegal import, the other sees the cycle that import closes — and each
was independently waived, in different tests, months apart, by someone who could not see the other
waiver. That is the actual finding here, and it is why this is filed as a bug rather than left as a
comment: two waivers for one file means the file is in the wrong place.

While reading that rule for this report, its `suggestion` turned out to be unapplicable — "Move the
shared logic to src/helpers/ or src/core/", offered to a file that is _already in_ `src/helpers/`. Half
of that remedy is a no-op. Fixed in the same commit (ADR-008 rule 2: a remedy is verified to remediate,
not merely to read well), which is a small demonstration of the thing rule 2 keeps claiming: nobody
notices an unusable remedy until a finding actually fires and someone tries to follow it.

## Why it is a bug and not just a shape

`within()` is not really a helper. It is an **entry point**: `within(calls(p)).functions()` starts a
rule chain, exactly as `functions(p)` does, and every other entry point lives in `builders/`. The
cycle is a symptom of the file being in the wrong directory, which is why the likely fix is a move
rather than an indirection.

## Fix

Probably: move `within()` to `src/builders/`. Then `helpers → builders` disappears and no indirection
is needed. Check before committing to it:

- what imports `within` today, and whether any of them would gain a bad edge;
- whether `src/index.ts`'s public surface changes (it should not — the export name stays);
- whether `arch/helpers-no-builders` was written _around_ this file, in which case it becomes stricter
  for free and that is worth stating.

**Do not** fix it by weakening `arch/no-cycles`. That rule spent months at `.warn()` and the cost is
recorded in plan 0084: while it could not fail, a **new** cycle arrived overnight (plan 0082 added a
value edge `helpers → models`, since fixed by moving the traversal to `core/`).

## Current state: excluded by identity, and enforced

`arch/no-cycles` is now `.check()` with:

```ts
.excluding('[builders, conditions, helpers, predicates]')
```

That is deliberately an **identity** exclusion, not a severity reduction. If the cycle's shape changes
— a slice joining or leaving the component — the pattern stops matching and the rule reds on the new
shape. Fail-closed. A `.warn()` would have accepted any cycle forever, which is how this went
unnoticed.

So the rule is on, this one cycle is waived with its reason recorded here, and any _other_ cycle now
fails the build.

## When this is fixed, delete the exclusion in the same commit

`tests/archunit/arch-rules.test.ts` carries `.excluding('[builders, conditions, helpers, predicates]')`.
Once `within()` moves and the cycle is gone, that exclusion matches nothing — and the only signal is a
`writeStderr` "Unused exclusion" line: **a warning, on a green build, for a finding whose remedy (delete the
line) is not optional.** So it will sit there.

Same for `arch/helpers-no-builders`' `.excluding('within.ts')`, which is the other waiver on the same file.
Both go in the commit that fixes this, and the test inventory below is where that is recorded rather than
remembered.

Found by the v0.47–0.49 review; the general form is [plan 0090](../../plans/0090-a-warn-that-expires.md).

## Related

- [Plan 0084](../../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md) — turned the rule on,
  and found this by doing so.
- `src/core/object-literal-functions.ts` — the other cycle found at the same time, fixed rather than
  waived because it was one day old and self-inflicted.

## Fix as shipped

`within()` moved from `src/helpers/` to `src/builders/`, which is what it always was: it starts a rule
chain, exactly as `functions(p)` does, and every other entry point lives there. Its two imports became
siblings; `src/index.ts` re-exports it from the new path and the public name is unchanged.

**Both waivers deleted in the same commit**, which this report insisted on:

- `arch/helpers-no-builders`' `.excluding('within.ts')`, waived since plan 0015;
- `arch/no-cycles`' `.excluding('[builders, conditions, helpers, predicates]')`.

All 46 architecture rules pass with **no exclusions** — our source is genuinely cycle-free.

And because a rule with nothing to exclude and nothing to find looks exactly like a broken one, the edge
was reintroduced to prove the rules still fire. Both red:

```
× helpers must not import from builders
× no cycles between source modules
  Cycle detected between: builders, conditions, helpers, predicates
    (e.g. builders imports conditions at call-rule-builder.ts:24)
```

## The claim in this report that was wrong

It said _"any other cycle now fails the build"_ and the suite called the exclusion _"the fail-closed
direction"_. [Bug 0056](../0056-a-cycle-identity-changes-when-imports-are-reordered.md) disproved both:
an SCC absorbs new intra-component edges without changing its name, so a new cycle among those four
slices was silently accepted. Deleting the waiver removes the instance; the mechanism is 0056's
fail-open half and remains open.

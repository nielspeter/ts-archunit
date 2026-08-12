# Bug 0076: duplicate-body similarity erases identifiers, so every wither pairs with every other wither

**Reported:** 2026-08-09 · **Fixed:** not yet
**Found in:** dogfooding `smells.duplicateBodies` on this repo for the first time, while writing
`tests/archunit/dogfood.test.ts` — the detector is published and had never been pointed at `src/`.
**Severity:** **High.** `smells.duplicateBodies` is published at the root export, and it is one of the
two rules `agentGuardrails` and `strictBoundaries` construct for `noCopyPaste`. On any codebase with a
mandated small-method idiom the finding rate is O(n²) false positives, and the only remedies available
to a user — raise `minSimilarity`, raise `minLines` — trade the false positives for real misses.

## What happens

`smells.duplicateBodies(p).inFolder('**/src/**').ignoreTests()` reports **484 pairs** on this
repository at the default `minSimilarity` of 0.85. Sampling them, the overwhelming majority are
semantically unrelated three-line methods. Three that the detector reports as **100% similar**:

```ts
// SmellBuilder.ignoreTests              // CorrespondenceBuilder.beComplete     // SmellBuilder.groupByFolder
const next = this.copy()                 const next = this.copy()               const next = this.copy()
next._ignoreTests = true                 next._checkComplete = true             next._groupByFolder = true
return next                              return next                            return next
```

Excluding test files, one file, one detector, one project: "`CorrespondenceBuilder.beComplete` is 100%
similar to `SmellBuilder.ignoreTests`". These are different classes in different modules doing
different things, and the only thing they share is the shape ADR-003 requires of every wither.

## Why

`src/smells/fingerprint.ts`. A `Fingerprint` carries `kinds` — a sequence of **`SyntaxKind` numbers**
— and `computeSimilarity` is LCS over that sequence:

```ts
const lcs = lcsLength(a.kinds, b.kinds)
return lcs / Math.max(a.kinds.length, b.kinds.length)
```

Identifiers, property names and literals never reach the comparison. `next._ignoreTests = true` and
`next._checkComplete = true` are not merely similar inputs, they are the **same** input: identical
kind sequences, LCS equal to the length, similarity exactly 1.0.

That is defensible as a _structural_ clone detector and it is not what the API says. `withMinSimilarity`
is documented as "AST similarity", and the violation message reads "X is 97% similar to Y", which a
reader takes as a claim about the code rather than about its skeleton.

## Why the knobs do not rescue it

Both available remedies are the same trade in different units:

- **`withMinSimilarity(1.0)`** does not help — the false positives are _at_ 1.0.
- **`minLines(12)`** cuts 484 → 95 on this repo, but it buys that by refusing to look at short
  functions at all, which is where copy-paste actually accumulates. Measured while writing the
  dogfood rule; the tuning was reverted for exactly this reason.

So a user's only working move today is to not run the detector.

## Consequence for the self-applied suite

`tests/archunit/dogfood.test.ts` covers the other reachable families and **skips** this one, with a
note pointing here. Self-applied coverage is 13 of the 18 checkable surfaces rather than 14, and that
is the honest number: a rule pinned at a ceiling of 484 known-bad findings is not coverage, and
tuning `minLines` until the count looked acceptable would have been worse — it would have reported
green over both the false positives _and_ any real duplication underneath them.

## Fix sketch (not yet chosen)

The fingerprint needs to carry something identifier-derived, so that two bodies with the same skeleton
and different targets separate. Options, in rough order of cost:

1. **Include a normalized identifier stream** alongside `kinds`, and require both to be similar.
   Cheapest, preserves the LCS machinery, and directly kills the wither family.
2. **Weight by node significance** — an assignment's LHS property name counts, a `const` keyword does
   not. More faithful, more to get wrong.
3. **Floor on distinct-token count**, rejecting pairs whose bodies are too trivial to be evidence of
   anything. Blunt, and overlaps with `minLines`.

Whichever is chosen, the guard is the same and it is a corpus, not a unit test: run the fixed detector
over `src/` and require that the wither family no longer pairs, **and** that a genuinely duplicated
body still does. This repo now has both populations — the ~11 withers per builder, and the
`body-analysis.ts` / `-function.ts` / `-module.ts` triple, which is real duplication that a working
detector must still find.

## Not to be confused with

The `body-analysis` triple is **genuine** duplication — `functionNotContain` and `classNotContain`
differ only in how they name the element and build the violation. That one was found by reading, not
by the detector, and it stands as its own piece of work. This bug is that the detector cannot tell
that case apart from 470-odd withers.

# Plan 0103 — A Body Too Small To Differ Is Not Evidence

**Status:** Implemented on `main`, unreleased. Phase 0's triage, Phase 1's mechanism, and Phase 2's dogfood
re-enable are all done; `docs/upgrading.md` and `CHANGELOG.md` land at actual release time, not before —
same convention plan 0104 follows. Five-persona review (2026-08-12) independently reproduced this plan's central numbers
against the real, unmodified detector and confirmed them — and found that Phase 0 as originally scoped could
land a default that breaks two of this repo's own existing tests (measured: a shared fixture at
`distinctVocabulary = 7`, another pair with exactly one token of margin against the plan's own highest
candidate floor), that its selection criterion was satisfiable at a floor leaving 448 of 495 pairs standing,
that the proposed performance test risked a vacuous pass, and one code sketch (`describe()`) would have silently
regressed plan 0099's dedupe-identity fix if pasted as shown. All fixed inline below, not left for the
implementer to rediscover.
**Fixes:** [bug 0076](../bugs/0076-duplicate-body-similarity-erases-identifiers-so-every-wither-pairs.md) — duplicate-body
similarity erases identifiers, so every wither pairs with every other wither.
**Priority:** Medium-high — reconciled against a fact that contradicts a first-draft "High," not asserted from
this repo alone. In favor: `smells.duplicateBodies` is a root export (`export { duplicateBodies }` via
`src/smells/index.ts`), two shipped presets construct it directly (`agentGuardrails({ noCopyPaste: true })` at
`withMinSimilarity(0.9)`, `strictBoundaries({ noCopyPaste: true })` at the default 0.85), and it is measured
firing 484 pairs against `src/`, almost all false, with **no working remedy**: `withMinSimilarity(1.0)` does not
help (the false positives sit AT 1.0) and `minLines(12)` only cuts 484→95 by refusing to look at short
functions, which the bug's own text names as where real copy-paste concentrates. Against: both presets wire
`noCopyPaste` at `'warn'`, not `'error'` (`src/presets/agent-guardrails.ts:161-172`,
`src/presets/boundaries.ts:317-334`), so neither shipped preset fails CI on this today, and
`plans/ROADMAP.md`'s own Deferred section (proposal 018) states plainly that `duplicateBodies` and
`inconsistentSiblings` combined are "used essentially zero times" by real adopters against an external corpus —
this plan has no evidence to the contrary. So: real, published, and self-verifiably broken (High's case), but
with no confirmed external blast radius and no CI teeth in its own shipped presets today (why not High
outright) — Medium-high, not High, is the honest read of both facts together.
**Effort:** Medium. The mechanism is small — one new `Fingerprint` field, one pairwise gate, one builder wither
— but landing a _correct_ default requires triage against a real, ambiguous corpus (see Phase 0), and this plan
discovers, mid-measurement, that the bug is one instance of a broader shape this plan does **not** fully close
(see "What this plan does not fix," below) — that residue must be filed, not silently absorbed.
**Blast radius:** **Published-API surface — two guaranteed, not hypothetical, in-repo consumers.**
`Fingerprint`, `buildFingerprint()` and `computeSimilarity()` are root-exported
(`src/index.ts:350-351`), so this is the same row of ADR-008 rule 6's table as plan 0102, and by rule 6 the
depth is guard the construction + one sabotage round. Unlike plan 0102, the change here is **monotonic in one
direction only** — see Release, below — which is the reason a two-phase version-gated migration is _not_
warranted, and that argument is made explicitly rather than assumed.

---

## Problem

`src/smells/fingerprint.ts`'s `Fingerprint.kinds` is a bare `SyntaxKind` sequence and `computeSimilarity` is
LCS over it, so identifiers, property names and literals never reach the comparison. Three real methods in
this repository —

```ts
// SmellBuilder.ignoreTests              // CorrespondenceBuilder.beComplete     // SmellBuilder.groupByFolder
const next = this.copy()                 const next = this.copy()               const next = this.copy()
next._ignoreTests = true                 next._checkComplete = true             next._groupByFolder = true
return next                              return next                            return next
```

— are reported **100% similar** to each other. They are different classes doing different things; the only
thing they share is the wither shape ADR-003 mandates for every builder method. Measured on `src/`:
`smells.duplicateBodies(p).inFolder('**/src/**').ignoreTests()` reports **484 pairs**, almost all this shape.
`tests/archunit/dogfood.test.ts` covers this family with `it.skip(...)`, pointing here, rather than either
deleting the row or pinning a ceiling over 484 known-bad findings — full reasoning for that choice is in the
bug and unchanged by this plan.

The bug's own "Fix sketch (not yet chosen)" names three candidates without picking one. **This plan picks one,
having measured all three against real bodies in this repository — not assumed from reading the code**, which
is the same standard bug 0079 held itself to when it corrected bug 0078's unmeasured "by extension" claim.

### What was measured, and what it rules out

Two real fixtures anchor every number below:

- **The false-positive triple** — `SmellBuilder.ignoreTests` / `SmellBuilder.groupByFolder` /
  `CorrespondenceBuilder.beComplete` (above). This must stop pairing.
- **The genuine duplicate** — `classContain`/`functionContain` and `classNotContain`/`functionNotContain`
  (`src/conditions/body-analysis.ts` vs. `body-analysis-function.ts`), named in the bug itself and in the
  dogfood test's own comment ("There is genuine duplication here for the fixed detector to find"). This must
  keep pairing.

**Option 1 as literally described — augment the LCS stream with raw identifier/literal text — does not
separate them.** Measured by building both fingerprints two ways (kinds-only, and kinds-with-text-augmented-
tokens for `Identifier`/`PrivateIdentifier`/`StringLiteral`/`NumericLiteral`/no-substitution-template nodes)
and re-running the same LCS:

| Pair                                                | kinds-only (today) | kinds + identifier text |
| --------------------------------------------------- | ------------------ | ----------------------- |
| `ignoreTests` vs `groupByFolder` (false positive)   | 100.0%             | **96.6%**               |
| `ignoreTests` vs `beComplete` (false positive)      | 100.0%             | **96.6%**               |
| `classNotContain` vs `functionNotContain` (genuine) | 97.6%              | 93.9%                   |
| `classContain` vs `functionContain` (genuine)       | 96.2%              | 91.8%                   |

One differing token in a 29-token body barely moves the ratio (28/29 ≈ 96.6%) — still comfortably above the
0.85 default _and_ the 0.9 `agentGuardrails` threshold. No threshold value separates 96.6% from 91.8%: any cut
low enough to drop the false positive drops the genuine duplicate too. **Rejected.**

**A narrower variant — compare only the identifier/literal tokens, ignoring structural kinds entirely — is
worse, not better.** Measured the same way, over just the text-bearing tokens in isolation:

| Pair                                                | identifier-only LCS | identifier-set Jaccard |
| --------------------------------------------------- | ------------------- | ---------------------- |
| `ignoreTests` vs `groupByFolder` (false positive)   | **80.0%**           | 50.0%                  |
| `classNotContain` vs `functionNotContain` (genuine) | 78.8%               | 62.9%                  |
| `classContain` vs `functionContain` (genuine)       | **70.0%**           | 50.0%                  |

The false positive (80.0%) scores _higher_ than one of the two genuine-duplicate pairs (70.0%) on the same
metric. There is no threshold that keeps one and drops the other. **Rejected.**

**Option 3 — a floor on the count of distinct identifier/literal values, applied as a pairwise gate before
similarity is even computed — is the only measured candidate that separates the two fixtures.** The false
positive triple carries **3** distinct identifiers total (`next`, `copy`, and the one differing property name).
The genuine duplicates carry **16–29**. Re-running `smells.duplicateBodies`'s own pairing logic against all of
`src/` (reimplemented for measurement — 443 of the real 484 pairs reproduced; the gap is an approximate
`collectFunctions` re-implementation, not a claim of exactness) at several floor values:

| Floor (min distinct vocabulary, either side) | Pairs surviving (of 443 reproduced) |
| -------------------------------------------- | ----------------------------------- |
| 0 (today)                                    | 443                                 |
| 4                                            | 399                                 |
| 6                                            | 250                                 |
| 8                                            | 128                                 |
| 10                                           | 99                                  |
| 12                                           | 76                                  |

The measured false-positive triple (distinct = 3) is excluded at every floor ≥ 4. The measured genuine-
duplicate pairs (distinct = 16–29) survive every floor in this table. **Chosen — Phase 1, below.**

### What this plan does not fix

Sampling the pairs that survive `floor = 12` turned up a **second, related false-positive class this plan does
not close**: pairs across _different_ condition families that share this codebase's own generic condition
skeleton —

```ts
evaluate(elements, context) {
  const violations = []
  for (const el of elements) { /* search, maybe push a violation */ }
  return violations
}
```

— for example `functionContain` (`body-analysis-function.ts`) paired at 85–88% with `haveOnlyReadonlyProperties`
(`members.ts`) and `mustMatchName`/`mustNotEndWith` (`naming.ts`), none of which duplicate `functionContain`'s
actual _purpose_. This is the same underlying cause as the wither triple — a framework-mandated skeleton, not
copy-paste — just less concentrated, so it takes a body with more vocabulary to exhibit it, and the distinct-
token floor alone cannot separate it from `functionContain`/`classContain` (which IS a genuine duplicate and
must keep pairing). **Not measured exhaustively — found by sampling 20 of 76 pairs at one floor value, not a
census.** This is new information the bug did not have; it belongs in its own filed bug, not folded into this
plan's scope (see Out of scope). Chasing it here would mean shipping neither fix.

## Phase 0 — the triage this plan's default depends on (implementation-time, not optional)

The table above is preliminary: 20 of 76 pairs sampled at one floor, and 443 of 484 real pairs reproduced by an
approximate corpus-collection script, not the shipped one. Two problems were found in this procedure itself
during review — both fixed below, not left for the implementer to rediscover.

**Problem A — the procedure never checked this repo's own tests, and two of them break.** Measured directly
against the real fixtures with the exact mechanism Phase 1 ships:

- `tests/fixtures/smells/same-key-object-literals/handlers.ts` (`routeA.handler`/`routeB.handler`/
  `routeC.process`, the fixture `tests/integration/baseline-portability.test.ts`'s collision guard depends on)
  — **distinct vocabulary = 7** (`{n, scaled, 3, shifted, OFFSET, value, ok}`). `duplicateFindings()`
  (`baseline-portability.test.ts:124`) calls `smells.duplicateBodies(project).withMinSimilarity(0.8).minLines(2)`
  with no `.minDistinctVocabulary()` override, so it inherits whatever default ships. Any floor ≥ 8 — the
  plan's own placeholder, and inside the candidate range below — zeroes this fixture's pairs and breaks two
  tests (`baseline-portability.test.ts:576,594`).
- `tests/fixtures/smells/duplicate-bodies/file-a.ts`/`file-b.ts` (`parseWebhookOrder`/`parseContentTypeOrder`,
  the pair `tests/smells/duplicate-bodies.test.ts` uses for 7 of its 12 tests) — **distinct vocabulary = 12 and
  17**, `Math.min = 12`. The candidate range below tops out at exactly 12 — one token of margin against the
  gate's strict `<` comparison. Land the default one higher and the same 7 tests break.

Neither was visible from a `src/`-only triage — both are in `tests/`. **Fix, landed in Phase 1, not deferred to
triage:** pad both fixtures with a few additional distinct identifiers now, decoupling them from whatever
default Phase 0 picks, rather than let two synthetic test bodies constrain the real answer. Added to Files
changed, below.

**Problem B — "pick the lowest floor that excludes zero genuine pairs" is satisfied too early to mean anything.**
Read literally, that criterion is met at floor 4: the wither triple is already excluded, and no known-genuine
pair is. But floor 4 leaves **448 of 495 pairs surviving** (measured against the real, unmodified detector, not
the reimplementation) — the fix would ship and the detector would remain majority-false-positive on this
repo's own `src/`. A floor chosen only to clear the two named fixtures, with no floor on how much noise
survives, can satisfy the letter of Phase 0 while barely moving the practical problem bug 0076 exists to fix.

**Fixed procedure:**

1. Pad `same-key-object-literals/handlers.ts` and `duplicate-bodies/file-a.ts`/`file-b.ts` so each measures
   comfortably above the highest candidate floor below (target: distinct vocabulary ≥ 20 each) — a one-time fix,
   independent of whatever default this triage lands on.
2. Run the **real** `DuplicateBodiesBuilder` (not a reimplementation) with the floor wired in at candidate
   values `{6, 8, 10, 12}` against `src/`, `.ignoreTests()`, **and** run this project's full test suite
   (`npm run test`) at each candidate — any newly-failing test is a triage input (a third fixture Problem A
   didn't name), not a surprise to debug after the fact.
3. For each candidate, sample every surviving pair below 20 total (or 20 at random above that) and classify
   each as genuine duplication, second-class boilerplate (see "What this plan does not fix," above), or
   unclassified. Record, per candidate: the surviving-pair count and the genuine:boilerplate ratio in the
   sample — not just whether a known-genuine pair was excluded.
4. Pick the **lowest** floor at which (a) the full test suite passes, (b) zero known-genuine pairs
   (`body-analysis*`, and any others triage turns up) are excluded, **and** (c) the sampled survivor count is
   materially reduced from floor 0's 443–484 — not merely "not worse than floor 4." A floor satisfying (a) and
   (b) alone, at the cost of leaving hundreds of pairs standing, does not satisfy this step; say so in the
   triage record rather than stopping at the first floor that clears the two named fixtures.
5. Record the final default, the per-candidate table (counts and ratios, not just the winning row), and the
   full-suite-pass confirmation in this plan's Phase 1 (below), replacing the placeholder.

**Triage record (measured against the real, unmodified detector, implementation time):**

| Floor | Pairs surviving (of 495, real detector, `src/`)                                       | Wither triple (`ignoreTests`/`groupByFolder`/`beComplete`) | `classContain`/`functionContain` |
| ----- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------- |
| 0     | 495                                                                                   | pairs (all three)                                          | pairs                            |
| 4     | 448 (91% of floor 0 — the plan's own "insufficient" reading, confirmed)               | excluded                                                   | pairs                            |
| 6     | 292 (59%)                                                                             | excluded                                                   | pairs                            |
| 8     | 161 (33% — the lowest candidate where survivors become a MINORITY of floor 0's count) | excluded                                                   | pairs                            |
| 10    | 121 (24%)                                                                             | excluded                                                   | pairs                            |
| 12    | 95 (19%)                                                                              | excluded                                                   | pairs                            |

**Chosen: 8.** Lowest floor satisfying all three criteria: (a) `npm run test` is fully green at this floor,
once the third-fixture finding below is fixed; (b) the known-genuine pair survives (at every candidate, in
fact); (c) materially reduced — 495 → 161 is the point where surviving pairs first become a minority of the
unfixed count, a natural, principled cutoff rather than an arbitrary stop. Floors 10 and 12 cut further with
no measured evidence of losing anything genuine, but "lowest that satisfies (a)-(c)" is what step 4 asks for,
not "most aggressive that still works" — a higher floor is a config change any adopter can make, documented
in `docs/smell-detection.md`.

**Step 2 found a third fixture Problem A didn't name, exactly as designed.** `npm run test` at floor 8 red
four test files, all for the same reason: three small, hand-written fixtures used by shipped-preset tests
were below the floor. `tests/fixtures/presets/agent-guardrails/src/mistakes.ts` (`dupOne`/`dupTwo`, measured
`distinctVocabulary = 7`, one token short) and `tests/fixtures/presets/boundaries/src/feature-{a,b}/helper.ts`
(`helperA`/`helperB`, measured `distinctVocabulary = 5`) both feed the `noCopyPaste` preset option's own test
coverage (`tests/presets/agent-guardrails.test.ts`, `tests/integration/agent-guardrails-check.test.ts`,
`tests/presets/boundaries.test.ts`) and needed the same padding treatment as the two Problem-A fixtures —
added to Files changed. After padding, `npm run test` is fully green at floor 8 (246 files, ~3359 tests).

## Phase 1 — `Fingerprint.distinctVocabulary` and the pairwise floor

One new field, populated where `buildFingerprint` already walks every descendant — no second AST pass:

```ts
// src/smells/fingerprint.ts
const TEXT_KINDS = new Set<SyntaxKind>([
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.NumericLiteral,
])

export interface Fingerprint {
  readonly kinds: readonly SyntaxKind[]
  readonly calls: readonly string[]
  readonly nodeCount: number
  /**
   * Count of DISTINCT identifier/literal texts in the body — the vocabulary
   * a body actually carries, as opposed to its punctuation/keyword shape.
   * Plan 0103's floor reads this; computeSimilarity() does not — see the
   * "why computeSimilarity stays unchanged" note below.
   */
  readonly distinctVocabulary: number
}

export function buildFingerprint(body: Node): Fingerprint {
  const kinds: SyntaxKind[] = []
  const calls: string[] = []
  const distinct = new Set<string>()

  for (const node of body.getDescendants()) {
    const kind = node.getKind()
    kinds.push(kind)
    if (NodeClass.isCallExpression(node)) {
      calls.push(node.getExpression().getText().replace(/\?\./g, '.'))
    }
    if (TEXT_KINDS.has(kind)) {
      distinct.add(node.getText())
    }
  }

  return { kinds, calls, nodeCount: kinds.length, distinctVocabulary: distinct.size }
}
```

**`computeSimilarity()` is not touched — deliberately.** Both rejected options (above) tried to fold identifier
information _into_ the similarity number itself; measurement showed that reshapes the score without separating
the populations, so it is not worth the published-API risk of changing what `computeSimilarity()` returns for
an existing pair. The floor is a **separate**, new gate, applied in `duplicate-bodies.ts` before
`computeSimilarity()` is even called — same "fast rejection" spot the node-count check already uses:

```ts
// src/smells/duplicate-bodies.ts, in findSimilarPairs()
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    const a = items[i]
    const b = items[j]
    if (!a || !b) continue

    // Fast rejection 1 (existing): node-count ratio can't reach threshold.
    const maxCount = Math.max(a.fingerprint.nodeCount, b.fingerprint.nodeCount)
    const minCount = Math.min(a.fingerprint.nodeCount, b.fingerprint.nodeCount)
    if (maxCount > 0 && minCount / maxCount < this._minSimilarity) continue

    // Fast rejection 2 (new, plan 0103): neither body has enough distinct
    // vocabulary for a match to be evidence of anything. `Math.min`, not sum
    // or average — ONE small-vocabulary side is enough to make the pair
    // uninformative regardless of the other side's size.
    const minDistinct = Math.min(a.fingerprint.distinctVocabulary, b.fingerprint.distinctVocabulary)
    if (minDistinct < this._minDistinctVocabulary) continue

    const similarity = computeSimilarity(a.fingerprint, b.fingerprint)
    if (similarity >= this._minSimilarity) {
      pairs.push({ a: a.fn, b: b.fn, similarity })
    }
  }
}
```

The builder wither, alongside `withMinSimilarity` (not on the shared `SmellBuilder` — this knob is specific to
how _this_ detector's fingerprint works, same reasoning that keeps `withMinSimilarity` off the base class):

```ts
// src/smells/duplicate-bodies.ts, class DuplicateBodiesBuilder
private _minDistinctVocabulary = 8 // Phase 0's triage record, above — measured, not guessed

/**
 * Minimum count of distinct identifier/literal text either body must carry
 * before a pair is even compared — not raw line count, and not similarity.
 * Two bodies can share a syntactic shape for no reason other than the shape
 * being mandated (a wither, a getter, a boilerplate skeleton); below this
 * threshold a "match" carries no information about what the code actually
 * does. Tune down for a codebase with terser naming than this default
 * assumes; tune up if short, low-vocabulary bodies keep surfacing as noise.
 */
minDistinctVocabulary(n: number): this {
  const next = this.copy()
  next._minDistinctVocabulary = n
  return next
}
```

**`describe()` must name it — this is the dedupe identity, not just documentation.** `describe()`'s own
doc-comment (plan 0099) is explicit: every narrowing filter that distinguishes two detector instances has to
appear here, or `dedupeConfigFindings` collapses genuinely different rules into one. This is an **addition** to
the existing method, not a replacement — review caught a first draft that showed only the new line and, pasted
literally in place of the whole array, would have silently deleted the two existing conditional pushes below it
(`ignorePaths`/`ignoreTests`), regressing the exact dedupe-identity fix plan 0099 shipped. Full context:

```ts
// src/smells/duplicate-bodies.ts, describe() — ONE line added (marked), nothing else touched
protected describe(): string {
  const scope = this._folders.length > 0 ? this._folders.join(', ') : 'all files'
  const filters = [
    `minLines >= ${String(this._minLines)}`,
    `minDistinctVocabulary >= ${String(this._minDistinctVocabulary)}`, // <- new
  ]
  if (this._ignorePaths.length > 0) filters.push(`ignoring ${this._ignorePaths.join(', ')}`)
  if (this._ignoreTests) filters.push('ignoring tests')
  return (
    `No duplicate function bodies in ${scope} ` +
    `(similarity >= ${String(this._minSimilarity)}, ${filters.join(', ')})`
  )
}
```

**Why `distinctVocabulary` is a required field, not `?`-optional (unlike plan 0102's `inertAdvice?`).** The two
cases differ in kind. Plan 0102 made `DiagnosableRule.inertAdvice` optional because that interface is
_implemented_ by third-party dialect builders (ADR-010) — a required addition would silently fail their build
in a way `diagnose()` has to tolerate at runtime regardless. `Fingerprint` is a _data shape_, constructed almost
always by `buildFingerprint()`, never implemented. A required field breaks exactly the call sites that hand-
construct a literal — measured: two, both in this repo's own `tests/smells/fingerprint.test.ts`
(`{ kinds: [], calls: [], nodeCount: 0 }` used to test the empty-fingerprint edge of `computeSimilarity`) — and
breaks them loudly, at compile time, with a one-line fix (see Files changed). An external adopter doing the
same hits the identical, recoverable, compile-time error. Optional would mean the floor silently no-ops
(`undefined < n` is always `false` in JS, so an absent field would make every pair pass the gate) for anyone who
built a `Fingerprint` by hand and didn't know to set it — a quieter, worse failure than a compile error for a
low-traffic export. Required is the safer choice here, for the opposite reason `?` was safer in 0102.

## Phase 2 — re-enable the dogfood test, honestly

The floor does not deliver "484 → 0" — Phase 0's own findings, and the second false-positive class named
above, mean some pairs will remain even at a well-chosen floor. Asserting `.toEqual([])` would be false, and
pinning a count ceiling is the exact move ADR-008 rule 5 forbids (a ceiling reads as coverage while a real
regression can still hide under it) — the same reasoning the bug's own "Consequence" section already gives for
why `minLines`-tuning-to-look-acceptable was rejected. Re-enable the test against **named, specific** pairs
instead of a count:

**Matched on `.identity`, not `.message`.** `duplicate-bodies.ts`'s own `buildViolations()` carries a doc
comment warning against exactly the alternative: message text embeds the similarity percentage, which "drifts
as either body is edited," and `dogfood.test.ts`'s own existing `configFindings` check (further down the same
file) already matches on a typed field, not parsed prose — this follows that precedent instead of introducing a
new, more fragile one. `identity` is `` `duplicate-pair::${[fileA#nameA, fileB#nameB].sort().join('::')}` ``
(`duplicate-bodies.ts`), deterministic and qualified by path, so a substring match on it is stable in a way a
message match is not.

```ts
// tests/archunit/dogfood.test.ts
it('duplicate bodies: the wither triple no longer pairs, and the real duplicate still does', () => {
  const rule = smells.duplicateBodies(p).inFolder('**/src/**').ignoreTests()
  expect(rule.examinedUnits()).toBeGreaterThan(0)

  const identities = rule.violations().map((v) => v.identity ?? '')

  // The motivating false positive — bug 0076's full three-way tie, not just
  // one edge of it. If the mechanism works it kills all three simultaneously
  // (a per-function property, applied symmetrically), so asserting only one
  // pair would pass even if a second edge of the same triangle regressed.
  const pairs: [string, string][] = [
    ['#ignoreTests', '#groupByFolder'],
    ['#ignoreTests', '#beComplete'],
    ['#groupByFolder', '#beComplete'],
  ]
  for (const [a, b] of pairs) {
    const stillPairs = identities.some((id) => id.includes(a) && id.includes(b))
    expect(stillPairs, `${a} / ${b} must no longer pair`).toBe(false)
  }

  // The motivating genuine duplicate — must survive.
  const realDuplicate = identities.some(
    (id) => id.includes('#classContain') && id.includes('#functionContain'),
  )
  expect(realDuplicate).toBe(true)
})
```

This asserts the things this plan actually knows to be true, and is honest about not asserting the rest —
consistent with `tests/matrix/vacuity-matrix.test.ts` already tracking known-open gaps by name rather than by a
count that could silently regress.

## Files changed

| File                                                            | Change                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/smells/fingerprint.ts`                                     | add `TEXT_KINDS`, add `distinctVocabulary` to `Fingerprint`, populate it in `buildFingerprint()` (same descendant walk, no second pass). `computeSimilarity()` unchanged.                                                                                                                      |
| `src/smells/duplicate-bodies.ts`                                | `_minDistinctVocabulary` field + `minDistinctVocabulary()` wither; pairwise floor check in `findSimilarPairs()` (before the LCS call); `describe()` names the new filter for dedupe identity (additive — see Phase 1's full-context snippet)                                                   |
| `tests/smells/fingerprint.test.ts`                              | the two hand-built `{ kinds: [], calls: [], nodeCount: 0 }` literals (lines ~71, ~76) need `distinctVocabulary: 0` added — the concrete break Phase 1 names                                                                                                                                    |
| `tests/smells/duplicate-bodies.test.ts`                         | add coverage for `minDistinctVocabulary()` (below-floor pair does not flag; at-floor pair does; zero-vocabulary body; `describe()` reflects the value and it participates in dedupe identity; the `minLines`-parity no-`bypassFilters` check)                                                  |
| `tests/fixtures/smells/same-key-object-literals/handlers.ts`    | pad `routeA`/`routeB`/`routeC`'s shared body with additional distinct identifiers so `distinctVocabulary ≥ 20` — Phase 0 Problem A: measured at 7 today, below every candidate floor, and `baseline-portability.test.ts` depends on it pairing                                                 |
| `tests/fixtures/smells/duplicate-bodies/file-a.ts`, `file-b.ts` | pad `parseWebhookOrder`/`parseContentTypeOrder` similarly so `distinctVocabulary ≥ 20` — measured at 12/17 today, one token of margin against the highest candidate floor Phase 0 tests                                                                                                        |
| `tests/archunit/dogfood.test.ts`                                | un-skip, replace with the identity-matched assertions (Phase 2)                                                                                                                                                                                                                                |
| `docs/smell-detection.md`                                       | document `minDistinctVocabulary(n)` beside `withMinSimilarity`/`minLines`; correct the "AST similarity" summary line (`docs/smell-detection.md:22`) **and** the deeper "## AST Fingerprinting" section (lines 63–84, which enumerates what a fingerprint captures and will go stale otherwise) |
| `docs/api-reference.md`                                         | `buildFingerprint()`'s one-line description (`docs/api-reference.md:352`, "kinds, calls, nodeCount") needs `distinctVocabulary` added                                                                                                                                                          |
| `CHANGELOG.md`                                                  | new entry under the release this ships in, per the Release section below — including the `### Changed (⚠️ BREAKING — ...)` heading this project uses for required-field additions to published interfaces (precedent: `CollectResult.examined`)                                                |
| `docs/upgrading.md`                                             | new row, same shape as the existing 0.57.0–0.59.0 rows: what shrinks, why it's not a regression, and a pointer to that file's existing "record your finding count before upgrading" recipe (already written for exactly this direction of change)                                              |

No change to `src/conditions/*`, any preset, or `computeSimilarity()`'s signature or return semantics for any
existing pair.

## Test inventory

**The measured false positive stops pairing at the chosen default.** `ignoreTests`/`groupByFolder`/`beComplete`
— none of the three pair with either other, at whatever floor Phase 0's triage lands (measured: excluded at
every floor ≥ 4; the chosen default will be ≥ 4 by construction).

**The measured genuine duplicates keep pairing.** `classContain`/`functionContain` and
`classNotContain`/`functionNotContain` still appear in `violations()` at the chosen default (measured surviving
every floor up to 12; must be re-checked at whatever Phase 0 actually picks).

**`minDistinctVocabulary()` is a real wither, not a config no-op.** `.minDistinctVocabulary(0)` reproduces today's
(broken) behavior on a small fixture pair — proves the gate is additive, not a replacement for
`withMinSimilarity`.

**The floor participates in dedupe identity.** Two `duplicateBodies()` rules differing only in
`minDistinctVocabulary` produce distinct `describe()` strings — proven the same way plan 0099 proved it for
`minLines`/`ignorePaths`: construct two builders differing in exactly this one field, assert
`describe() !== describe()`.

**Fast rejection actually rejects — mechanism specified, and the guard is verified before it ships.** No
precedent in this codebase for spying on an internal, same-package collaborator — every existing `vi.spyOn` in
`tests/` targets an I/O boundary (`process.stdout.write`, `console.error`), never a pure function one module
imports from another. Hedging between "`computeSimilarity` or the module import," as an earlier draft did, is
not a specified mechanism — review named this a possible vacuous pass (ADR-008 rule 5: "what would this test do
if the thing it guards were completely broken? If the answer is pass, the derivations are not independent"),
because whether `vi.spyOn` intercepts a bare named import used internally by the module under test depends on
this project's specific Vitest/esbuild transform, not on language semantics, and nothing in the plan checked
that it does. Two things fix this, not one:

1. **Specify the mechanism precisely**, not "or": import the fingerprint module as a namespace
   (`import * as fingerprintModule from '../../src/smells/fingerprint.js'`) and spy on the namespace property
   (`vi.spyOn(fingerprintModule, 'computeSimilarity')`) — this is the documented Vitest technique for
   intercepting a named ESM export, and it works because `duplicate-bodies.ts` calls it as
   `computeSimilarity(...)`, which under Vitest's SSR transform resolves through the same live-binding the spy
   replaces.
2. **Prove the guard is not vacuous, once, during implementation — a test of the test.** Before landing it,
   temporarily delete the `minDistinct < this._minDistinctVocabulary` check locally and confirm the spy
   assertion goes red (`computeSimilarity` gets called for the below-floor pair). If it stays green with the
   check deleted, the spy is not intercepting and this test must be redesigned (e.g., an explicit call-counter
   threaded through for testing) before it ships. This one-time check is what turns "we believe this spies
   correctly" into "we verified it," and it is exactly the discipline ADR-008 rule 5 asks every guard to pass.

**`examinedUnits()` is unchanged.** The floor gates _pairing_, not _selection_ — a below-floor function is still
counted as examined (consistent with how a function above `minLines` but never matching anything is still
examined). Assert `examinedUnits()` is identical with and without `.minDistinctVocabulary()` set, for a fixed
corpus — this is the check that would catch someone "optimizing" the floor into a `collectFilteredFunctions()`
pre-filter later, which would silently change this number.

**An absurdly high floor behaves like an absurdly high `withMinSimilarity`, not like an over-tight `minLines` —
this parity is tested, not asserted.** `minLines(1000)` over-filtering already produces a `bypassFilters`
CONFIGURATION finding when it empties the corpus (`duplicate-bodies.test.ts:54-67`), because it changes
`examinedUnits()`. `minDistinctVocabulary` gates pairing, not selection, so `.minDistinctVocabulary(9999)` can
silently zero every finding while `examinedUnits() > 0` — indistinguishable from a genuinely clean corpus, with
no signal. The Release section argues this is acceptable because it's the same shape `withMinSimilarity(1.0)`
already has today (also unguarded, also silent) — assert that parity directly: `.minDistinctVocabulary(9999)`
on a corpus with real content produces zero violations **and** zero `bypassFilters` findings, the same as
`.withMinSimilarity(1.0)` on the same corpus. One line closes a question a future reader would otherwise have
to re-derive from the Release section's prose alone.

**A real body with zero distinct vocabulary is the sharpest instance of the accepted risk, and it needs its own
test, not just the abstract mention in Release.** The existing empty-fingerprint tests
(`{ kinds: [], calls: [], nodeCount: 0 }`, `fingerprint.test.ts:70-80`) cover a hand-built, fully empty
fingerprint — a different case from a real, non-empty body with no `Identifier`/`*Literal` descendants at all
(e.g. `function f() { return true }` — a `kinds`/`nodeCount` > 0, `distinctVocabulary === 0` body). Under any
floor ≥ 1 such a body can never pair with anything again, not even an identical twin. Add: `buildFingerprint()`
on a trivial real body yields `distinctVocabulary: 0`, and two structurally-identical trivial bodies stop
pairing once the floor is set — makes the "accepted risk" concrete instead of only argued in prose.

**Sabotage matrix:**

| Revert                                                                                                                                                                                                                                                                                                        | Must red because                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the `minDistinct < this._minDistinctVocabulary` check                                                                                                                                                                                                                                                  | The wither pair reappears in `violations()`                                                                                                                                                                                                                                         |
| Move the floor comparison to `Math.max` instead of `Math.min`, tested against an **explicitly asymmetric pair** (a low-vocabulary wither-shaped body vs. a high-vocabulary body otherwise similar enough to clear `withMinSimilarity`) — a symmetric pair can't distinguish `Math.min` from `Math.max` at all | The asymmetric pair survives the floor on its large side alone                                                                                                                                                                                                                      |
| Drop `minDistinctVocabulary` from `describe()`                                                                                                                                                                                                                                                                | Two rules differing only in the floor collapse to one dedupe identity                                                                                                                                                                                                               |
| Make `distinctVocabulary` optional and default the floor check to treat `undefined` as passing                                                                                                                                                                                                                | A **third-party, hand-built** `Fingerprint` silently bypasses the floor — not exercisable by this repo's own tests, since every fingerprint here goes through `buildFingerprint()`; a design-review point on the required-field decision, not a guard this repo's suite can enforce |
| Compute `distinctVocabulary` from `kinds` instead of a fresh identifier/literal walk                                                                                                                                                                                                                          | Every fingerprint reports the same `distinctVocabulary` regardless of body content — the floor becomes a no-op constant                                                                                                                                                             |

Row dropped from an earlier draft: _"feed `computeSimilarity()` the floor and fold identifiers into the LCS
score → reproduces the rejected Option-1 numbers."_ Review found no proposed test would catch it — fast
rejection 2 runs **before** `computeSimilarity()` is ever called, so this sabotage can't touch the (already-
excluded) wither pair, and per the plan's own Option-1 table the genuine-duplicate pair only drops to
91.8%/93.9% under this sabotage — still above the 0.85 default, so the "genuine duplicate still pairs"
assertion stays green too. Neither of Phase 2's two assertions would flip. Kept here as a note rather than a
row so the next author doesn't re-propose it without also proposing what would actually catch it.

## Release

**One release, not a version-gated migration — argued, not assumed.** The floor is an additional `AND`-ed
condition on an existing pairwise check: `pairs_after ⊆ pairs_before` for any fixed `minSimilarity`, always,
because a pair can only be removed by the new gate, never added. So for every existing consumer:

- A `duplicateBodies().check()` that is **passing today stays passing** — a subset of zero is zero.
- A `duplicateBodies().check()` that is **failing today because of noise** (the common case per the bug) either
  stays failing on real findings, or newly passes — both are the _intended_ fix, not a regression.

The one accepted risk, named rather than hidden: a project whose `check()` is failing today on a **genuinely
small** duplicate (few distinct identifiers, but truly copy-pasted) could see that specific pair newly excluded
by the floor, going from a true positive to silently nothing. This is the same shape `minLines` already
accepts — a real detection trade, not a new risk category — and is why Phase 0's triage optimizes for the
_lowest_ floor that clears the known false positives, not the highest.

No `.excluding()`, baseline, or suppression semantics change. No new `DiagnosticFinding` kind. No
`bypassFilters` involved — this is a detector getting more accurate, not a new adequacy floor in ADR-008's
sense.

**"No version-gated migration" is not the same claim as "no release communication," and this plan owes both.**
`docs/upgrading.md` already documents this exact direction of change in general ("the release can report
findings on code you did not touch, or stop reporting findings it used to... a rule that starts passing... all
look identical to progress — fewer findings, no output, green run") and gives a recipe for it (record your
finding count before upgrading). Every prior enforcement-changing release in this project's history gets a row
in that table and a `CHANGELOG.md` entry, including — for the closest precedent, a required-field addition to a
published interface (`CollectResult.examined`) — an explicit `### Changed (⚠️ BREAKING — ...)` heading, which
`tests/release/version-bump-guard.test.ts` checks for. `Fingerprint.distinctVocabulary` is required, published,
and breaks the same class of external caller (anyone hand-constructing a `Fingerprint` literal). This plan
routes both to Files changed, above, rather than leaving them to be improvised at release time — the prose
already written in this section (the monotonicity proof, the one accepted risk, the "why not a migration"
argument) is close to publication-ready and should carry over into both artifacts rather than be re-derived.

## Out of scope

- **The condition-`evaluate()`-skeleton false-positive class** (see "What this plan does not fix"). Real,
  measured (sampled, not exhaustively), and structurally the same root cause as this bug — but the distinct-
  token floor does not separate it from `functionContain`/`classContain`, which must keep pairing. **File as
  its own bug once this plan ships**, so the corpus it's measured against already reflects this plan's fix
  rather than mixing the two false-positive classes in one triage.
- **Not a general clone-detection redesign.** Type-2 (rename-invariant) clone detection, weighted node
  significance (fix-sketch option 2), and canonical/positional identifier normalization were all considered
  during measurement (see Problem) and rejected or subsumed — this plan does not attempt a general-purpose
  clone detector, only closes the specific, measured false-positive class bug 0076 filed.
- **`withMinSimilarity` and `minLines` semantics are unchanged.** `minDistinctVocabulary` is a new, independent
  filter, not a replacement — a rule author who already tuned `minLines` keeps that tuning; the floor adds a
  second, orthogonal cut.
- **No claim about `inconsistentSiblings` or any other smell.** This plan is `duplicateBodies`-only; nothing
  here touches `src/smells/inconsistent-siblings.ts` (plan 0102's subject) or its `Assessment`/`inertAdvice`
  machinery.
- **The exact default is not chosen by this document.** Phase 0 is implementation-time, mandatory, and its
  result replaces the placeholder `8` in Phase 1 before this ships — this plan commits to the _mechanism_
  (a distinct-token floor) and the _procedure_ for choosing its value, not the value itself.

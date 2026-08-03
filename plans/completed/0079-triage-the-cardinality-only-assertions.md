# Plan 0079 — Triage the cardinality-only assertions

**Status:** **DONE, 2026-08-03 (v0.45.4).** Phase 1 sampled 30 and measured class C at **27%** of
the sample — above the ~15% stop rule — so Phase 2 ran. All **45** class-C blocks are converted to
identity assertions. Filed 2026-08-01 out of the ADR-008 compliance audit, which produced the
number but deliberately did not act on it.
**Priority:** Low when filed. Nothing here was a known defect — it was an unexamined population,
and the examination found roughly a third of it genuinely weak.
**Effort:** Small to start, and the estimate held: sampling was under an hour, the conversions were
mechanical once the scan was trustworthy.
**Blast radius:** Internal test quality over a corpus we control. Rule 6's floor: sample, decide,
stop. This does not earn a second round.

## Problem

[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 5's third corollary: _counting is the
shortcut. Compare identities — sets of `file:line`, sets of names — not integers._ A test that
asserts `toHaveLength(3)` passes when a change loses one finding and gains another.

A scan over the suite found **215 of 2 791 `it()` blocks (8%)** that assert a **non-zero**
cardinality with no identity assertion anywhere in the block. `toHaveLength(0)` was excluded —
the empty set _is_ an identity.

Concentrations: `callback-extractor` (13), `descendant-cache` (8),
`typescript-function-module` (8), `dependency` (7), `structural` (7),
`held-builder-is-immutable` (7), `matchers-typescript` (6), `load-rules` (5).

## What this number is, and is not

**It is an upper bound from a heuristic scan, and it has known false positives.** A spot-check
found legitimate members immediately: `complexity.test.ts` counts decision points, where the
count _is_ the value under test, and a metric assertion is an identity assertion. The scan's
identity signals are a regex over method names, so anything asserting identity through an unusual
idiom is miscounted.

Publishing the 215 as a defect list would be the shape this project spends its guards avoiding —
a number standing in for an examination nobody did. Hence a plan to _look_, not a plan to fix.

## Phase 1 — sample thirty, decide

Draw 30 at random from the 215, seeded and recorded so the sample is reproducible. Classify each:

| Class | Meaning                                                                                        | Action                    |
| ----- | ---------------------------------------------------------------------------------------------- | ------------------------- |
| **A** | Count is the value under test (metrics, complexity, caches)                                    | None. Correct as written. |
| **B** | Count is a proxy, but the block is a unit test of a pure function whose output has no identity | None. Record why.         |
| **C** | Count stands in for identity, and the test would pass on a swap                                | Fix.                      |

The decision rule, before looking: **if class C is under ~15% of the sample, stop and close this
plan with the measurement.** The population is then mostly A and B, and converting 215 blocks to
satisfy a rule that does not apply to them is churn. If C is above that, Phase 2.

## Phase 2 — fix class C, by concentration

Only if Phase 1 warrants it. Work the concentrated files first: a file with seven such blocks
usually shares one helper, so one fix converts several. Prefer the shape the rest of the suite
already uses — `expect(names.sort()).toEqual([...])` over `expect(names).toHaveLength(n)`.

## Test inventory

None of its own. This plan changes tests; the guard that it changed them correctly is that each
converted test must **fail on a swap** — losing one element and gaining another. Demonstrate that
on two converted tests, per rule 6's floor, and record it.

## Out of scope

- **The scan itself becoming a lint rule.** Tempting and wrong: the false-positive rate is the
  whole problem, so a rule enforcing this would red on classes A and B forever. If Phase 1 finds
  the population is mostly C, revisit.
- **`toHaveLength(0)` assertions.** The empty set is an identity.

## Related

- [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 5, "counting is the shortcut".
- [Bug 0028](../../bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — what
  a cardinality-vs-identity confusion costs when it reaches production: 8 colliding pairs of 47.

---

# What happened

## Phase 1 — the sample, and what it said

The scan had to be rebuilt, because the filed number came with no script. **Committed this time** at
`tests/tools/scan-cardinality-assertions.ts`, with a ratchet test beside it. The first version of this
write-up cited a script in a scratch directory that was never committed — leaving every number here
exactly as unauditable as the 215 it was replacing, while the changelog claimed a script had been
recorded. Review caught it. Reproduced from a recorded seed (`random.seed(79)` over a deterministically
sorted population).

**The first definition was wrong, and wrong in the reassuring direction.** It counted
`toBeTruthy`, `toThrow`, `toBeGreaterThan` and `toBeDefined` as identity signals, which they are
not: a block asserting `toHaveLength(3)` alongside `toBeTruthy()` still passes when one element is
lost and another gained. That definition reported **129**. Under the swap definition — only
matchers that pin WHICH elements — it reported **166**.

**On 215 versus 143.** The filed 215 came with no script, so it cannot be reproduced, decomposed or
compared against anything — which is why the scan is now committed. The honest statement is therefore
not "the difference is the identity list plus conversions since", which implies an accounting nobody
can do: **215 was never reproducible, and 143 is the first real measurement.** The direction of the
flattery is worth naming too — 45 of 143 is 31% where 45 of 215 would be 21%. The go/no-go depended on
neither: the 27% that triggered Phase 2 came from the hand-read _sample_, and holds at 32% of its 25
genuine members whichever denominator the population has.

Thirty blocks, drawn by seed, classified **by reading every one**:

| Class                                                       | Count | What they are                                                                          |
| ----------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| **A** — the count IS the value under test                   | 7     | a 16-char hash, "warns only once", cache non-conflation, ancestor dedup, a tally reset |
| **B** — one fixture, one subject, boolean question          | 10    | `length 1` means "the condition fired"; there is no second element to confuse it with  |
| **C** — the count stands in for identity, and a swap passes | **8** | six of them carried a **comment naming the identity the assertion omitted**            |
| **F** — scan false positive                                 | 5     | asserted identity through an idiom the regex missed                                    |

**C = 8/30 = 27%**, or 32% of the 25 genuine members. Above the stop rule, so Phase 2 ran.

## The scan was a hand-maintained list too

The five false positives were all one idiom: a boolean assertion **about a specific element** —
`.some((m) => m.includes('"offset"'))`, `matcher.matches(nonNullExprs[0]!)`,
`REGEX.test(descriptions[0] ?? '')`. Those pin which element, through `expect(...).toBe(true)`,
which the identity list excludes because a _bare_ `toBe(true)` pins nothing.

Adding that as a second signal took the population from 166 to **143**, and it was checked against
the hand-read classification:

| Check                                                      | Result | Worth                                                                                                                                         |
| ---------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The 5 hand-identified false positives leave the population | 5 of 5 | **Not evidence.** The signal was _derived from those five idioms_, so it is the same derivation on both sides — rule 5's "the error cancels". |
| The 8 hand-confirmed class C remain in it                  | 8 of 8 | Informative: a specificity check that the new signal did not over-fire.                                                                       |

**The genuinely independent check is elsewhere, and it is better:** the exhaustive Phase 2 read found
45 of 143 (31%) against the sample's 32%, and it does not depend on the refinement at all.

### Class B was the weakest call, so it was checked against the fixtures

Class B is the largest group and the one carrying the most weight: 10 of 30 in the sample, and a
large share of the 96 blocks deliberately left alone. The rule — _one fixture, one subject, boolean
question, so `length 1` just means the condition fired_ — has an obvious failure mode, and review
named it: **a single-subject test where the condition can fire for the wrong reason and still
produce exactly one violation.** A fixture holding two things the rule could object to would do it.

So all ten were re-checked by reading the **fixture**, not the assertion:

| Block                                     | Candidates in the fixture                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `bare-package-imports.test.ts:104`        | one relative import                                                         |
| `bare-package-imports.test.ts:137`        | one bare import (`picomatch`)                                               |
| `call-args.test.ts:188`                   | one property, `additionalProperties: false`                                 |
| `call-args.test.ts:279`                   | one call, `validate()`                                                      |
| `structural.test.ts:223`                  | one class                                                                   |
| `type-level.test.ts:65`                   | three interfaces, each in its **own** `evaluate` call                       |
| `excluding-matching.test.ts:145`          | one violation in, and the filter can only return a subset                   |
| `workspace-has-no-single-root.test.ts:80` | one file in the in-memory project                                           |
| `typescript-function-module.test.ts:22`   | one `as User`                                                               |
| `typescript.test.ts:76`                   | one cast, in the constructor                                                |
| `dependency.test.ts:142`, `:151`          | two imports, but the violation is about the **file**, and there is one file |

Every one has a single candidate, so no swap exists to miss. The rule holds for those ten.

**But the rule's premise was wrong, and a second reviewer found where.** It assumes _the array can
only be filled by the subject_. It cannot: when a selector matches nothing, this library emits
**exactly one configuration finding** — so `toHaveLength(1)` can mean "the condition never ran".

Measured on `widened-module-edges.test.ts:267` and `:281`: rename the two fixtures so the selector
matches nothing and both blocks exit **0, "2 passed"**, with the surviving element being the
dead-glob gate's finding (`bypassFilters: true`, `file: ''`, _"can never match anything in this
project"_). `:267` carries the comment _"The false green this release must not create"_ and was
sitting on a false green of a different kind. Both now assert `identify(violations)`; with the
fixtures gone they exit 1.

The project already knew this shape in the **affirmative** direction — `slice-rule-builder.test.ts:175`
and `rule-builder.test.ts:552` assert `v[0].bypassFilters === true` on purpose. Nobody had written the
negative case: _this must be a real violation and not the gate_. That is the class B rule's real
boundary, and it is worth stating as a rule of its own:

> **A count of 1 is never sufficient on a builder chain that can produce a configuration finding.**
> Assert the identity, or assert `bypassFilters === false`.

Exposure was scoped rather than assumed: every other surviving block calling `.violations()` asserts
4, 2 or 3 — a configuration finding is 1, so they red — or checks `bypassFilters` directly. The
GraphQL builder returns `[]` on an empty selection, measured. The two above were the whole of it.

### The direction nobody checked — and it found something

Both rows above can only confirm the signal _shrinks_ the population. 215 → 143 excluded blocks that
were never read, and under the corollary this plan quotes — recovered ≤ raw always, so it detects
under-collection only — the refinement was tested solely where it could shrink.

Checked afterwards, at review's prompting, by probing the signal with a block it should NOT exclude.
**The element-boolean rule was over-broad:** it treated a bare index as reaching into the collection,
so `expect(violations[0]).toBeTruthy()` counted as an identity assertion. It pins nothing about which
element is there. Removing the bare-index arm — all five motivating idioms match on the predicate list
alone, so it cost nothing — put **6 blocks** back into the population:

| Block                                                        | Class on reading                                                                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slice-rule-builder.test.ts:175`, `rule-builder.test.ts:552` | B — one subject, and `v[0].bypassFilters` pins the kind                                                                                            |
| `callback-extractor.test.ts:50`                              | F — `callbacks[0].argIndex).toBe(1)` is an identity in a numeric form `IDENTITY` misses                                                            |
| `callback-extractor.test.ts:63`, `:155`                      | B — one callback in the fixture                                                                                                                    |
| `callback-extractor.test.ts:212`                             | **C.** `respects depth limit` — the comment names `handler` at depth 0 and `default` at depth 3, and extracting the wrong one is also one callback |

One genuine class C, hidden by the over-exclusion, now converted. The check earned its keep.

## Phase 2 — 143 read, 45 converted

Every block in the population was read. Final tally: **45 class C of 143 (31%)** — against the
sample's 32%.

**What the numbers count, since three of them differ.** 45 is the classification tally: blocks judged
class C and edited. The _measured_ effect is larger, because the scan's unit is the **block** and a
block leaves the population as soon as one identity assertion appears anywhere in it — the population
went 143 → **96**, i.e. **47 blocks**, across **51** replaced count assertions. Review counted the 47
and 51 independently and they agree. The 45 is the least useful of the three and is kept only because
it is what the classification produced.

That unit also bounds what the population means: a block with one identity assertion and three
count-only ones beside it is invisible to the scan. Visible in this plan's own diff at
`held-builder-is-immutable.test.ts`, where a converted block still carries a `toHaveLength(1)` above
the conversion.

**And the sample-versus-population agreement is weaker than it looks.** I classified both, so a
systematic bias in my reading appears identically in both and the agreement would look just as good.
It is evidence the classification is _consistent_, not that it is _correct_. Testing correctness needs
a second reader classifying the same 30 blind — not done.

**The concentration heuristic was half right.** The plan predicted "a file with seven such blocks
usually shares one helper, so one fix converts several". True where the collection has identities:
`callback-extractor.test.ts` was 4 of 9, `jsx.test.ts` 4 of 5. False where the file is single-subject
unit tests: `typescript-function-module.test.ts` was **1 of 10** and `structural.test.ts` **1 of 7**,
both almost entirely class B. Concentration tracks the number of `it()` blocks, not the density of
weak ones.

**Two blocks were reclassified by measurement, not by reading.**
`preset-fanout-is-one-finding.test.ts:77` and `:101` looked like textbook C — "never collapses
ordinary violations, however alike", asserting `toHaveLength(3)`. Probed, their violations are
**identical** on ruleId, file, line, element and message, deliberately, because the claim is that
alike violations are not merged. There is no identity to assert; the count is the value. Both
reverted to counts with that reason written in.

**One file named in the concentration list was never touched, and that was a real gap.** The
paragraph above says `typescript-function-module.test.ts` was "1 of 10" class C — while the file has no
diff on this branch, which either makes the number wrong or leaves a class C unconverted against a
header claiming all are done. Review caught the contradiction. Resolved by measurement: the block is
`:86`, `reports each cast in 'as unknown as T' double-cast as a separate violation`, and its two
violations are **byte-identical** — `loadUser|line 3|contains type assertion at line 4` twice, because
`as unknown as User` puts both casts on one line and the message carries only the line. So it is class
**A**, like the two `preset-fanout` blocks, and the count is the claim. The difference was that
preset-fanout's reclassification was _recorded in the test_ and this one was not. It is recorded now —
an unrecorded exception is the shape plan 0078 already paid for.

**One conversion revealed a live surprise.** `matchers.test.ts:158` asserted two sibling matches;
the identity assertion showed the matcher returns the **identifier** nodes (`foo`, `bar`), not the
call expressions. The count could not have shown that.

**One conversion needed the library to be interrogated.** `preset-fanout:61` — "keeps two rule ids
apart, because they are different faults" — has two findings with the _same_ element and message.
The only thing distinguishing them is `ruleId`, which is exactly what the test is about and exactly
what `toHaveLength(2)` could not see.

## The swap proof

Rule 6's floor for this plan: demonstrate on two converted tests that they fail on a swap — one
element lost, another gained. Measured with both assertion styles side by side against a swapped
fixture (`handler` renamed to `onSend`; `preHandler` to `afterAll`):

| Assertion style                                        | On the swapped input |
| ------------------------------------------------------ | -------------------- |
| `expect(callbacks).toHaveLength(1)`                    | **PASSES**           |
| `expect(callbacks).toHaveLength(2)`                    | **PASSES**           |
| `expect(callbacks.map(identify)).toEqual(['handler'])` | **FAILS**            |
| `expect(...).toEqual(['handler', 'preHandler'])`       | **FAILS**            |

**One weakness in that proof, stated.** It ran in a throwaway file that _reimplemented_ `identify()`
rather than importing the shipped helper, so it shows the technique works and not that the helper does.
The permanent guard that exercises the real thing is
`tests/tools/scan-cardinality-assertions.test.ts`, whose probe row feeds two blocks through the actual
scan — and that row is what found the over-broad element-boolean rule above.

## Follow-up found on the way

`ExtractedCallback` carries `fn`, `callSite` and `argIndex` — and for two callbacks on one object
literal the `argIndex` is the same and `fn.getName()` is `undefined`, so **nothing in the public
shape tells them apart.** The tests here derive identity by walking to the enclosing
`PropertyAssignment`; a rule author cannot, so a rule like "a `handler` callback must not call
`db.query`" is currently inexpressible. Filed as
[plan 0082](../0082-an-object-literal-callback-keeps-its-name.md) rather than left in a comment.

## What this cost, and what it is worth

45 conversions, no behaviour change, one library gap found and one matcher behaviour clarified.
Against that: the four tests in [plan 0080](./0080-admit-discovery-globs-to-the-dead-glob-gate.md)'s
list that pinned a _bug_ as expected because a count coincided with it. Class C is not a style
preference — it is the shape that let bug 0040's final-layer half ship green.

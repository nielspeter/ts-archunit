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

The scan had to be rebuilt, because the filed number came with no script. Written down this time at
`scratchpad/scan.py` and reproduced from a recorded seed (`random.seed(79)` over a
deterministically sorted population).

**The first definition was wrong, and wrong in the reassuring direction.** It counted
`toBeTruthy`, `toThrow`, `toBeGreaterThan` and `toBeDefined` as identity signals, which they are
not: a block asserting `toHaveLength(3)` alongside `toBeTruthy()` still passes when one element is
lost and another gained. That definition reported **129**. Under the swap definition — only
matchers that pin WHICH elements — it reported **166**. The filed number was 215; the difference is
the identity list plus real conversions between 2026-08-01 and today.

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

Adding that as a second signal took the population from 166 to **143**, and the refinement was
then checked against the independently hand-read classification — which is the different kind of
evidence rule 5 asks for:

| Check                                                      | Result     |
| ---------------------------------------------------------- | ---------- |
| The 5 hand-identified false positives leave the population | **5 of 5** |
| The 8 hand-confirmed class C remain in it                  | **8 of 8** |

## Phase 2 — 143 read, 45 converted

Every block in the population was read. Final tally: **45 class C of 143 (31%)** — against the
sample's 32%, which is the sampling validated after the fact rather than assumed.

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

## Follow-up found on the way

`ExtractedCallback` carries `fn`, `callSite` and `argIndex` — and for two callbacks on one object
literal the `argIndex` is the same and `fn.getName()` is `undefined`, so **nothing in the public
shape tells them apart.** The tests here derive identity by walking to the enclosing
`PropertyAssignment`; a rule author cannot, so a rule like "a `handler` callback must not call
`db.query`" is currently inexpressible. Filed as
[plan 0082](../0082-an-extracted-callback-should-carry-its-name.md) rather than left in a comment.

## What this cost, and what it is worth

45 conversions, no behaviour change, one library gap found and one matcher behaviour clarified.
Against that: the four tests in [plan 0080](./0080-admit-discovery-globs-to-the-dead-glob-gate.md)'s
list that pinned a _bug_ as expected because a count coincided with it. Class C is not a style
preference — it is the shape that let bug 0040's final-layer half ship green.

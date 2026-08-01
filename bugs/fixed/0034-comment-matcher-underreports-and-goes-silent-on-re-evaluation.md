# Bug 0034: the `comment()` matcher under-reports, and returns nothing at all on re-evaluation

**Reported:** 2026-08-01
**Found in:** v0.35.0 and every earlier version — by the architect review of [plan 0047](../plans/0047-typescript-escape-hatch-matchers.md), which was going to build on this machinery
**Status:** **FIXED** 2026-08-01, released in **v0.36.0**.
**Severity:** High. Two independent under-reports in a shipped rule, and one of them is a **rule that passes the second time it runs**. `noStubComments()` (`src/rules/hygiene.ts`) is affected today, and it is in this repository's own architecture suite.

## Two defects, measured

Three `@ts-ignore` comments on lines 1, 3 and 5 of one file, through `moduleNotContain(comment('@ts-ignore'))`:

```
reported lines: [4, 6]     expected [1, 3, 5]
```

**A. The first match in each scope is swallowed.** `findMatchesBroad`'s deepest-node filter (`src/helpers/body-traversal.ts:63-68`) drops any matching node that spans another matching node. A comment matches on the node it is _leading trivia of_; for the first comment in a scope that node encloses every later match, so it is discarded as an ancestor. The lost one is always the first — which for `@ts-nocheck` is the whole-file kill switch.

**B. The reported line is the node's, not the comment's.** Lines 4 and 6 are the `export const` statements the comments lead. So even the surviving findings point one line past the thing they are about. Plan 0047 wanted to build `tsDirective()` on this precisely for _"message quality — `file contains @ts-ignore directive at line 42`"_; the line number is wrong today.

**C. The dedup set is never reset, so the same rule object is silent on its second run.**

```
const cond = moduleNotContain(comment('@ts-ignore'))
cond.evaluate([sf], ctx)   ->  2 violations
cond.evaluate([sf], ctx)   ->  0 violations
```

`comment()` holds `const matchedComments = new Set<string>()` in its closure (`src/helpers/matchers.ts:304`), keyed `filePath:pos`, to stop one comment matching repeatedly as trivia of nested nodes. It is never cleared. Cross-file is unaffected — the key includes the path — which is why this survives casual testing. It bites where a rule object outlives one evaluation: watch mode holding rules across reruns, a preset array checked twice, a test reusing a rule constant.

That is ADR-008's central failure in its purest form: a green that means nothing, produced by the guard rather than by the code.

## Why it was not caught

Every existing test builds a fresh `comment()` per assertion, and asserts _that_ a violation was found rather than _which_ — so neither the swallowed first hit nor the stale set is visible. `src/core/descendant-cache.ts:48` already records the constraint that makes C dangerous — _"`comment()` carries per-matcher dedup state, so only its walk is shareable, not its filter"_ — without noticing that the state is also never reset.

## Fix

Three separable pieces; C is the urgent one.

- **C:** register the set through `src/core/cache-registry.ts`, the mechanism `resetProjectCache()` already drives for every other cache, or key it per evaluation rather than per matcher instance.
- **A:** exempt comment matches from the deepest-node filter. A comment's match node is an attachment point, not a containment relationship, so the ancestor test does not mean for it what it means for expressions.
- **B:** report the comment range's own position. `CommentRange` carries `getPos()`; the violation should use it rather than the node's line.

## Guard

The failure mode is a test that asserts _that_ something was found. Guards must assert **which** — the exact set of lines, from a fixture with at least three comments in one scope and one in a nested scope. For C, the assertion is that the same rule object returns the identical result twice; a fresh-matcher-per-test suite cannot fail on it, which is why 2755 tests did not.

## Related

- [Plan 0047](../plans/0047-typescript-escape-hatch-matchers.md) — proposed `tsDirective()` on top of this, and to extract a shared `matchCommentRanges()` helper from it. The extraction must keep the dedup set **per matcher instance**; hoisting it to module scope turns defect C from per-rule into global and permanent.
- `noStubComments()` (`src/rules/hygiene.ts`) — under-reports today for reason A.

## Fix as shipped

The root cause is one sentence: **a comment is not the node it is attached to**, and the unit of a finding is the **comment**.

- `ExpressionMatcher` gains **one** member, `matchedTriviaPositions?(node): readonly number[]`. Its presence is what makes a matcher a trivia matcher. Returning **every** matching position, not the first, is what makes stacked comments separate findings.
- `comment()` holds **no state**. Defect C is fixed by construction rather than by remembering to reset something.
- `findMatchesInNode` — the dispatcher, not the broad walk — expands trivia matches and deduplicates them by comment position, then sorts into source order. At the dispatcher so a trivia matcher that also narrows by `syntaxKinds` still gets it.
- `MatchResult` carries `triviaPositions` parallel to `matchingNodes`, and `reportedLine(node, triviaPos)` names the comment's line at all **ten** sites.

### Three corrections to this report, all found by review

**The watch-mode claim was false.** This report and the first commit both said the stale-Set defect "bit watch mode". It did not: `runCheck` passes `fresh: true` and `load-rules.ts` cache-busts the import, so every rerun builds a new matcher. The shape actually affected is a **hoisted builder evaluated more than once** — which `docs/running-in-tests.md` explicitly recommends, so the people hit were the ones following the documentation.

**The first fix left a residual that was a regression.** Deduplicating by _node_ collapsed stacked comments: four `// TODO` lines under one statement produced **one** finding, where 0.35.0 produced several (at wrong lines). Measured through `noStubComments()`, which `agentGuardrails` ships to catch agent-written stubs — so an agent could append stubs under a baselined one indefinitely and never turn the build red. The guard shipped with that fix asserted `toHaveLength(1)`, certifying the hole as intended, in a file named `reports-every-hit`.

**"7 of 7" was a matrix from memory.** ADR-008 asks for the revert list derived from the diff. Derived mechanically, the first fix had **four** reverts caught by nothing, including `comment()` silently dropping trailing comments and `getPos()` → `getEnd()` — the latter invisible because the fixture was all `//` comments, where the two share a line.

### Sabotage

**11 of 11**, reverts enumerated from `git diff`, tree verified clean after each.

| revert                                          | caught by                                    |
| ----------------------------------------------- | -------------------------------------------- |
| `matchedTriviaPositions` returns only the first | the stacked-comment and remedy tests         |
| `getPos()` → `getEnd()`                         | the multi-line block comment test            |
| `comment()` stops seeing trailing comments      | the shape-coverage test                      |
| trivia dedup removed                            | the no-duplicates test                       |
| trivia branch removed from the dispatcher       | the every-directive test                     |
| source-order sort dropped                       | `ordering.ts`, where pre-order gives `4,1,2` |
| `reportedLine` ignores the position             | the exact-message test                       |
| `useInsteadOf` threads `good`'s positions       | the two-matcher test                         |
| `call.ts` reverts to the node line              | the callback test                            |
| deepest-node filter re-applied to trivia        | the every-directive test                     |
| `identifyMatches` loses its node mapping        | the callback test                            |

Two of those rows — the sort and the `call.ts` sites — scored MISSED on the first pass and needed fixtures built to discriminate them: a file whose first line ends in a trailing comment, and a comment inside a callback.

### Guards

The three defects survived **2767 passing tests** because every test asserted _that_ a violation was found rather than _which_. The new file asserts which, and derives the expected lines from a raw text scan of the fixture rather than hard-coding them — hard-coded numbers are how the first version came to pin an under-report as correct.

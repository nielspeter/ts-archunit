# Bug 0052: `noStubComments()` cannot see a stub marker in a function's own docstring

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.47.0)
**Found in:** every version since `noStubComments()` shipped, by
[plan 0083](../../plans/0083-eat-our-own-dogfood.md) Phase 1 — planting the violation each of our own 37
dogfood rules forbids. 34 of 36 rows caught it; this was one of the two that did not.
**Severity:** **Medium-high.** The condition works for one placement of the thing it forbids and
misses the commonest one, silently. We ship it in `agentGuardrails`, which is the preset aimed at
AI-generated code — where `// TODO: implement` above an unfinished function is the canonical artifact.

## What

```ts
export function noStubComments(pattern: RegExp = STUB_PATTERNS): Condition<ArchFunction> {
  return functionNotContain(comment(pattern))
}
```

`functionNotContain` calls `searchFunctionBody(fn, matcher)` (`src/conditions/body-analysis-function.ts:64`).
It searches the **body**. A function's own leading comment is not in its body, so it is never visited.

Measured against the condition directly, four placements of the same marker:

| Where the stub marker is                               | Violations |
| ------------------------------------------------------ | ---------- |
| Inside the body — `function a() { // TODO: finish`     | **1** ✅   |
| Trailing the function — `} // TODO: finish`            | **1** ✅   |
| **Leading the function** — `// TODO: finish` above it  | **0** ❌   |
| **JSDoc leading the function** — `/** TODO: finish */` | **0** ❌   |

The two that fail are the two a human or an agent actually writes. `// TODO: implement this` goes
_above_ the signature, not inside the body — that is what a stub **is**: a function with a marker
where the explanation belongs and often nothing inside it at all.

Note the irony in the mechanism: `comment()` reads `getLeadingCommentRanges()` **and**
`getTrailingCommentRanges()` (`src/helpers/matchers.ts:353`), so the matcher is capable of it. The
traversal never offers it the function node — only nodes inside the body — so leading ranges of the
declaration itself are unreachable. The matcher can see what the search never shows it.

## How it was found, and why nothing else would have

Plan 0083's Phase 1 plants the violation each dogfood rule forbids and asserts the rule reds. Our own
`hygiene/no-stubs` rule stayed green with a `TODO` planted in `src/`.

The audit this plan **originally** specified — delete each rule, confirm the suite reds — would have
found nothing here: deleting a rule from a green suite leaves it green. This is the third instance of
that shape, after [bug 0011](./0011-dogfood-rules-select-nothing.md) and
[bug 0049](./0049-the-type-assertion-self-check-selected-classes.md), and the second where the
rule existed, passed, and had never been shown to fire.

## Fix as shipped

A **trivia** matcher searches from the declaration; everything else still searches the body.

```ts
if (matcher.matchedTriviaPositions !== undefined) {
  return toResult(findMatchesInNode(triviaRoot(fn.getNode()), matcher))
}
```

Three things about that, each of which was a wrong turn avoided or taken:

**Why discriminate on trivia at all.** `functionNotContain` is general-purpose. Handing the
declaration node to `expression(/…/)` would match the function's entire source text, turning every
body-analysis rule into a whole-declaration one. `matchedTriviaPositions` is the exact set of matchers
that need the attachment point, and it is already on the interface — no new flag.

**Why search _from_ the declaration rather than _also_ searching it.** `triviaMatches` visits
`[node, ...allDescendants(node)]` and deduplicates by comment position, so the body comes along and no
comment can be reported twice. Testing the declaration separately would have needed its own dedup
against the body's. Verified: a function with a marker in its docstring **and** one in its body reports
**2**, not 1 and not 3.

**`triviaRoot`, because the first version fixed half the cases.** For `const f = () => …`,
`ArchFunction.getNode()` returns the `VariableDeclaration` and the docstring attaches two levels up on
the `VariableStatement` — measured `nodeLeading: 0`, `parentLeading: 0`, `grandparentLeading: 1`. So
`function f()` was fixed and `const f = () => …` was still broken, which is half the codebases that
would use the rule. `getFirstAncestorByKind` finds the _nearest_ statement, so a nested arrow does not
reach out to its enclosing function's docstring — pinned by a control, because that over-reach is the
obvious way to fix this wrongly.

A bodiless function (an overload signature) is now covered too, for free: the old code returned early
on `!body`.

### Measured, after

| Placement                                                  | Before | After    |
| ---------------------------------------------------------- | ------ | -------- |
| Inside the body                                            | 1      | 1        |
| Trailing the function                                      | 1      | 1        |
| Leading line comment                                       | **0**  | **1**    |
| Leading JSDoc                                              | **0**  | **1**    |
| Leading JSDoc on an arrow const                            | **0**  | **1**    |
| Leading line comment on an arrow const                     | **0**  | **1**    |
| CONTROL: clean function                                    | 0      | 0        |
| CONTROL: clean arrow const                                 | 0      | 0        |
| CONTROL: two distinct markers                              | —      | 2        |
| CONTROL: nested arrow must not inherit the outer docstring | —      | 1, not 2 |

### And it immediately found something, which is the point

With the traversal fixed, our own `hygiene/no-stubs` rule went **red on our own `src/`** — five hits,
none of them a stub. That is [bug 0053](./0053-the-stub-rule-matched-prose-about-stubs.md): the pattern
matched prose _about_ markers, including `noStubComments()`'s own docstring. The two shipped together
because this one cannot go green without that one.

## Sabotage — and the first run of it caught nothing

| Revert                                                                           | Result |
| -------------------------------------------------------------------------------- | ------ |
| Traversal back to the body (this bug)                                            | CAUGHT |
| `triviaRoot` stops at the node, so arrow consts are unfixed again (the half-fix) | CAUGHT |
| Baseline asserted green before each, restored after                              | 0      |

**The first run of that matrix scored both rows CAUGHT BY NOTHING.** The fix was measured with
throwaway probes, the numbers went into this document, and nothing permanent held them — so reverting
either half left the suite green.

That is worth more than the fix. The "Fix" section above had already asked _"what would the suite do if
the fix were wrong? Today, nothing — which is how this shipped"_ — and then the fix shipped the same
way, one section below the sentence diagnosing it. Measuring a behaviour and **recording** the number
is not the same as **guarding** it; a number in a write-up is ADR-008's own "hand-typed measurement in
a plan" row.

The 16 rows in `tests/conditions/stubs.test.ts` are the permanent form.

## Out of scope

- **`hygiene/no-empty-bodies`**, which is a different condition and caught its plant correctly.
- **Whether `agentGuardrails` should promote this to `error`.** `docs/presets.md` commits to new rules
  entering at `warn` or `off` in a minor; a severity change is a separate decision.

## Related

- [Plan 0083](../../plans/0083-eat-our-own-dogfood.md) Phase 1 — the matrix that found it.
- `src/helpers/matchers.ts:303` — `STUB_PATTERNS`, which matches `TODO`, `FIXME`, `HACK`, `XXX`,
  `STUB`, `DEFERRED`, `PLACEHOLDER`. The pattern was never the problem.
- [Bug 0049](./0049-the-type-assertion-self-check-selected-classes.md) — a rule that existed,
  passed, and had never run against the thing it claimed to cover. Same shape, different axis: that
  one had the wrong element kind, this one has the wrong traversal root.

# Bug 0052: `noStubComments()` cannot see a stub marker in a function's own docstring

**Reported:** 2026-08-04 · **Fixed:** not yet
**Found in:** every version since `noStubComments()` shipped, by
[plan 0083](../plans/0083-eat-our-own-dogfood.md) Phase 1 — planting the violation each of our own 37
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
that shape, after [bug 0011](./fixed/0011-dogfood-rules-select-nothing.md) and
[bug 0049](./fixed/0049-the-type-assertion-self-check-selected-classes.md), and the second where the
rule existed, passed, and had never been shown to fire.

## Fix

Search the function's own comment ranges as well as its body. The likely shape is that
`searchFunctionBody` gains the declaration node itself for comment-kind matchers, or
`noStubComments()` stops going through `functionNotContain` and asks the node directly — decide during
implementation, but **do not** fix it by only handling `//` and leaving JSDoc, since the measurement
above shows both fail and JSDoc is the more common form in generated code.

Then the ADR-008 rule 5 question, asked against the diff: what would the suite do if the fix were
wrong? Today, nothing — which is how this shipped.

**Required tests**, all four rows of the table above, because fixing leading comments while breaking
body detection is the obvious regression and the current suite would not notice:

1. leading line comment → 1
2. leading JSDoc → 1
3. inside the body → 1 (**control** — it works today and must keep working)
4. trailing → 1 (**control**, same reason)
5. a function with no marker → 0 (**control**, or the fix could be "always report")

## Out of scope

- **`hygiene/no-empty-bodies`**, which is a different condition and caught its plant correctly.
- **Whether `agentGuardrails` should promote this to `error`.** `docs/presets.md` commits to new rules
  entering at `warn` or `off` in a minor; a severity change is a separate decision.

## Related

- [Plan 0083](../plans/0083-eat-our-own-dogfood.md) Phase 1 — the matrix that found it.
- `src/helpers/matchers.ts:303` — `STUB_PATTERNS`, which matches `TODO`, `FIXME`, `HACK`, `XXX`,
  `STUB`, `DEFERRED`, `PLACEHOLDER`. The pattern was never the problem.
- [Bug 0049](./fixed/0049-the-type-assertion-self-check-selected-classes.md) — a rule that existed,
  passed, and had never run against the thing it claimed to cover. Same shape, different axis: that
  one had the wrong element kind, this one has the wrong traversal root.

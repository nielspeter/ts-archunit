# Bug 0061: `// NOT IMPLEMENTED` no longer matches, and the docstring claimed it would

**Reported:** 2026-08-04 · **Fixed:** not yet
**Found in:** v0.47.0 ([bug 0053](./fixed/0053-the-stub-rule-matched-prose-about-stubs.md)).
**Severity:** Medium. A false negative on a rule that ships at `error` in the preset aimed at generated
code — and by ADR-008's own standard, a marker that silently stops matching is a check that cannot fail.

## What

Bug 0053 dropped the `i` flag from the whole expression and hand-alternated only the initial letters:

```ts
;`${COMMENT_LINE_START}(?:[Nn]ot\\s+[Ii]mplemented|[Cc]oming\\s+[Ss]oon)\\b`
```

Measured:

| comment                  | pre-0.47 | now      |
| ------------------------ | -------- | -------- |
| `// not implemented yet` | match    | match    |
| `// Not Implemented`     | match    | match    |
| `// NOT IMPLEMENTED`     | match    | **miss** |
| `// Coming Soon`         | match    | match    |
| `// COMING SOON`         | match    | **miss** |

And the docstring one line above asserted the opposite until v0.49.1: _"The phrase forms stay
case-insensitive — nobody writes 'NOT IMPLEMENTED'"_. All-caps is the one casing the **marker** branch
would otherwise have caught, and the stated reason for the claim is the counterexample to it.

`docs/upgrading.md` states the limit as _"a lowercase `// todo:` is no longer matched"_ — the phrase
forms are not mentioned, so this narrowing shipped undocumented.

## Related, and possibly the bigger half

Reviewers measured further narrowings that the anchoring introduced, none of them documented:

| comment                                                   | pre-0.47 | now      |
| --------------------------------------------------------- | -------- | -------- |
| `// Stub: not implemented yet`                            | match    | **miss** |
| `// Placeholder implementation - replace with real logic` | match    | **miss** |
| `// hack: bypass validation`                              | match    | **miss** |
| `// For now, return an empty array (not implemented)`     | match    | **miss** |
| `/** @todo implement caching */`                          | match    | **miss** |

Some of those are correct by design (`// hack:` lowercase, `@todo` lowercase). Some are not obviously so:
`// Placeholder implementation` is an ordinary stub spelling with a capital P, and the marker branch is
case-sensitive.

**Verify each row before acting.** They are reported, not measured here, and the anchoring interacts with
the casing rule in ways worth separating: which misses are the _anchor_, which are the _casing_, and
which are intended.

## Fix

Narrow scope: add the all-caps forms to the phrase branch, or make the phrase branch genuinely
case-insensitive with an inline group — `(?i:…)` is not available, so either alternate all letters or split
the expression so only the phrase half carries `i`. Then correct `docs/upgrading.md`'s stated limit.

Broader scope, which is [plan 0091](../plans/0091-a-stub-marker-is-delimited-not-cased.md): the casing rule
was chosen to reject two wrapped prose lines in _this repository's_ unusually marker-dense docstrings, and
it gave up case-insensitivity for every user. A **delimiter** requirement — marker at a comment-line start
**and** followed by `:`/`(`/end-of-line — rejects `stub,` and `deferred.` mid-sentence while keeping casing.
That is the better trade, and it is a redesign rather than a fix.

Do the narrow fix here so the false negative closes; take the redesign as its own plan with its own corpus.

## Test inventory

1. **`// NOT IMPLEMENTED` and `// COMING SOON` match.** Red today.
2. **The prose rows from bug 0053 still do NOT match** — the whole point of that fix, and the row that
   stops this from being a revert.
3. **Each reported row above, classified**: anchor, casing, or intended. A table in the test, since the
   distinction is what the redesign decision needs.
4. **The docstring's claim matches the code**, asserted — this bug exists partly because prose and regex
   disagreed and nothing compared them.

## Related

- [Bug 0053](./fixed/0053-the-stub-rule-matched-prose-about-stubs.md) — introduced it.
- [Plan 0091](../plans/0091-a-stub-marker-is-delimited-not-cased.md) — the redesign.
- `src/helpers/matchers.ts`.

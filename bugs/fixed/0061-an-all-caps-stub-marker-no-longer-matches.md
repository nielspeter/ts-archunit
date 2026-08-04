# Bug 0061: `// NOT IMPLEMENTED` no longer matches, and the docstring claimed it would

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.55.0)
**Found in:** v0.47.0 ([bug 0053](./0053-the-stub-rule-matched-prose-about-stubs.md)).
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

Broader scope, which is [plan 0091](../../plans/0091-a-stub-marker-is-delimited-not-cased.md): the casing rule
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

- [Bug 0053](./0053-the-stub-rule-matched-prose-about-stubs.md) — introduced it.
- [Plan 0091](../../plans/0091-a-stub-marker-is-delimited-not-cased.md) — the redesign.
- `src/helpers/matchers.ts`.

## Fix as shipped

The phrase branch's casing is **derived per letter** rather than hand-alternated:

```ts
function anyCase(word: string): string {
  /* n -> [Nn], o -> [Oo], … */
}
const PHRASES = ['not implemented', 'coming soon']
  .map((phrase) => phrase.split(' ').map(anyCase).join('\\s+'))
  .join('|')
```

Deriving it is the point. Adding `[NN]OT` and `[CC]OMING` by hand would have fixed the two casings someone
noticed and left `// nOt ImPlEmEnTeD` — measured, it matches now — so the class is closed rather than two
instances of it. The markers stay case-**sensitive**, which is what rejects a wrapped JSDoc line beginning
`stub,`, and both of bug 0053's prose rejections still hold.

## The classification this report asked for, measured

The report listed six _reported but unverified_ rows and its inventory demanded each be classified as
anchor, casing or intended. Done, by running the old and new patterns plus an anchor-only variant against
each:

| comment                                               | cause      | disposition                                                               |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `// NOT IMPLEMENTED`                                  | casing     | **fixed here**                                                            |
| `// COMING SOON`                                      | casing     | **fixed here**                                                            |
| `// Stub: not implemented yet`                        | casing     | [plan 0091](../../plans/0091-a-stub-marker-is-delimited-not-cased.md)     |
| `// Placeholder implementation …`                     | casing     | plan 0091                                                                 |
| `// hack: bypass validation`                          | casing     | plan 0091                                                                 |
| `// todo: implement the refund path`                  | casing     | plan 0091 — the documented limit                                          |
| ` * stub, which the compiler …`                       | casing     | **intended** — bug 0053's own prose case, and what the casing rule is FOR |
| `// the todo list below`                              | anchor     | **intended**                                                              |
| ` * - TODO: wire this up`                             | **anchor** | **new finding**, handed to plan 0091                                      |
| `/** @todo implement caching */`                      | **anchor** | **new finding**, handed to plan 0091                                      |
| `// For now, return an empty array (not implemented)` | **anchor** | **new finding**, handed to plan 0091                                      |

**The last three are not a casing problem and this report did not separate them.** A **bulleted** `- TODO:`
inside a JSDoc list is an extremely common real marker, and the anchor rejects it because `-` sits between
the `*` and the word. Same for `@todo`, where the `@` intervenes. Those are the anchor's design, not the
casing's, so they belong with the delimiter redesign — recorded there with this measurement rather than
left in a reviewer's message.

## Found by an adversarial pass before tagging

`anyCase` did not escape regex metacharacters. Measured on hypothetical future phrases:

| input     | produced                 | means           |
| --------- | ------------------------ | --------------- |
| `todo(x)` | `[Tt][Oo][Dd][Oo]([Xx])` | a capture group |
| `wip.`    | `[Ww][Ii][Pp].`          | any character   |
| `a+b`     | `[Aa]+[Bb]`              | one or more `a` |

**None of them throw.** The pattern silently means something other than the phrase, which is the worst
shape a defect can take in a rule that gates a build. No live defect — today's phrases are letters and
spaces — but the function exists precisely to be called with a _new_ phrase, and that is when it would
bite. Now escaped, with the measurement recorded at the site.

## A second review, after shipping v0.55.0 — the escaping fix was half a fix

The pre-tag pass fixed `anyCase`'s no-case branch and left the **cased** branch with the identical hazard.
A case mapping is not one-to-one:

```
'ß'.toUpperCase() === 'SS'      // two characters
anyCase('ß')      === '[SSß]'   // a class of THREE single characters
```

So `anyCase('straße')` built a pattern that **did not match its own uppercase form**, and did not throw —
the same silent-wrongness, one branch over, in the fix for it.

Now an **alternation** when either mapping is multi-character, and a character class while both are single.
That split is not cosmetic, and the change detector is what established it: switching _every_ letter to an
alternation moves `STUB_PATTERNS`' text — and therefore every baselined finding's identity — while
`[Nn]` and `(?:N|n)` match identically. A migration charged to every adopter for no behavioural change.
The detector fired on that, went quiet once the class was kept for the ASCII case, and that is the guard
doing its real job: reporting a cost I had not intended rather than a bug.

`anyCase` is now exported (from `matchers.ts`, deliberately **not** from `src/index.ts`, so not public API)
and guarded by a **round-trip property** over metacharacters and multi-character mappings: whatever the
input, the pattern must match it in every casing. Both traps fail that property; neither failed anything
before.

## Sabotage

| Revert                                              | Result                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| `anyCase` back to alternating only the first letter | CAUGHT — the all-caps and mixed-case rows                 |
| The `i` flag added to the whole expression instead  | CAUGHT — bug 0053's wrapped `stub,` prose row             |
| `anyCase` applied to the MARKER branch too          | CAUGHT — the same prose row, which is what it protects    |
| The pattern's `String()` form changed               | CAUGHT — the v0.54.0 change detector, printing its remedy |

That last row is the one worth noting: the guard built for bug 0060 fired on the very next pattern change
and forced steps 2 and 3 of its own remedy. It was built one release earlier for exactly this.

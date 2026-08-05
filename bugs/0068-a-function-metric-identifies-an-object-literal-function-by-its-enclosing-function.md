# Bug 0068: a function metric names an object-literal function after its enclosing function

**Reported:** 2026-08-05 · **Fixed:** not yet · **Rewritten:** 2026-08-05, after v0.57.0 closed the half
this report led with.
**Found in:** asking whether [0067](./fixed/0067-a-duplicate-pair-identity-collides-on-two-same-named-functions-in-one-file.md)
was smells-only. It is not — the same wrong-name mechanism reaches `rules/metrics`.
**Severity:** **High.** Downgraded to Low after v0.57.0 closed the collision half, then **restored** when
three reviewers independently measured that it still costs coverage — see "Why Low was wrong" below.
Reproduced on an 18-line fixture, `spikes/0068-metric-identity-collides.mjs`.

> **Read this header before the body.** This report was filed against **0.56.0** claiming an identity
> collision, and **v0.57.0 closed that collision** — `disambiguateIdentities` in `src/core/violation.ts`
> runs in `applyFilters` and covers every family, metrics included. Re-measured on the same fixture at
> v0.57.0: **4 findings, 4 identities**, suffixed `…::lines` / `…::lines#1`. **No baseline entry is lost,
> and the High severity is withdrawn.**
>
> What survives is narrower and is the subject of the rest of this report: the finding still carries the
> **wrong name**. Sections below written before the rewrite describe the collision as live; they are kept
> because the root-cause analysis is unchanged and still explains the surviving defect.

## What survives at v0.57.0

Within a single violation, `message` and `element` name different functions:

```
line  4  element=makeAlpha  id=…::lines     message: "makeAlpha has 12 lines (max: 3)"
line  4  element=makeAlpha  id=…::lines#1   message: "errorResponseBuilder has 8 lines (max: 3)"
                    ^^^^^^^^^                          ^^^^^^^^^^^^^^^^^^^^
```

The second row is a finding **about the arrow**, labelled with the **enclosing function's** name. Two
consequences, both small:

1. **The terminal and the JSON `element` field are wrong.** A reader looking for `makeAlpha` at line 4
   finds a 12-line function that does not breach an 8-line report.
2. **String-form `.excluding()` misses it.** `execute-rule.ts:152` matches a string pattern by
   `[element, file, message].includes(pattern)` — exact array membership, not substring — so
   `.excluding('errorResponseBuilder')` does **not** match. The regex form does, via `message`
   (`:153` uses `pattern.test(target)`). So the escape hatch works only if the author reaches for a regex,
   and nothing tells them that.

### Why Low was wrong — corrected after review

This report said _"Neither costs coverage. This is a correctness-of-output bug, not a false green, which
is why it is Low."_ **Measured, it is a false green, and three reviewers reproduced it on different
metrics.**

`BaselineEntry.measured` is a per-identity **ceiling**, and the identities inside a colliding group are
separated only by a positional `#N`. So the ceilings are keyed to a **slot**, not to a function. Change
the membership or the order of the group and the ceilings rotate onto the wrong functions:

```
baselined:  alpha=10  bravo=14  charlie=8      (maxFunctionLines(3))
then:       alpha deleted, charlie grown 8 -> 13
reported:   1  — "bravo has 14 lines"          bravo did not change. False RED.
                 charlie 8 -> 13:              SILENTLY ACCEPTED
```

And the mirror case, with no code change at all — **alphabetising a handler map** turns a clean run red on
an untouched function, while its neighbour slides under an 18-line ceiling it never earned.

The same shape reproduces on `maxFunctionParameters`, which is the cleanest demonstration because it is the
only function metric whose outer measurement is independent of the nested arrow — `lines` and `complexity`
both count the arrow into the enclosing function, so their group cannot shrink to one.

`disambiguateIdentities`' own docstring predicted this before this report was filed: _"a swap can hand the
survivor a ceiling belonging to a different element and silently accept a regression."_ v0.57.0 therefore
**masks** this defect rather than closing it — for 0064/0065/0067 the identity was under-determined and the
positional suffix is a genuine floor, but here a better value sits one argument away, so the suffix turns a
wrong **name** into a wrong **slot**.

The fix below removes it: with `qualifiedName` passed, each arrow gets a distinct base identity, no group
forms, and the regression reports red. Verified by applying it and re-running the same probe.

## What happens (as filed against 0.56.0 — the collision half is now closed)

With `includeObjectLiteralFunctions: true`, a function metric reports the object-literal arrow **and** its
enclosing function, and gives both the **enclosing function's** identity.

Measured, `maxFunctionLines(3)` over an 18-line fixture (`scratchpad/collide/src/b.ts`, two `return { … }`
literals each holding an `errorResponseBuilder` arrow):

```
line  4  element=makeAlpha  id=b.ts::makeAlpha::lines   "makeAlpha has 12 lines (max: 3)"
line  6  element=makeAlpha  id=b.ts::makeAlpha::lines   "errorResponseBuilder has 8 lines (max: 3)"
line 17  element=makeBeta   id=b.ts::makeBeta::lines    "makeBeta has 12 lines (max: 3)"
line 19  element=makeBeta   id=b.ts::makeBeta::lines    "errorResponseBuilder has 8 lines (max: 3)"
```

**6 findings, 4 identities** across the fixture. Two functions at different lines with different messages
carry one identity, so baselining `makeAlpha`'s 12-line body also accepts the arrow at line 6 — and keeps
accepting it as it grows.

Same result for `maxFunctionComplexity(1)`: 6 findings, 4 identities.

Note the internal disagreement, which is what makes this cheap to fix and easy to miss: within a single
violation the **message** says `errorResponseBuilder` and the **element and identity** say `makeAlpha`. The
correct name was in scope and was used for one field and not the other.

## Root cause — `qualifiedName` exists, is plumbed, and the function path does not pass it

`metricViolation` (`src/core/metric-violation.ts:96`) already takes the right value as an optional
parameter and falls back when it is absent:

```ts
identity: `${node.getSourceFile().getFilePath()}::${options.qualifiedName ?? getElementName(node)}::${options.metric}`
```

The fallback `getElementName(node)` resolves an unnamed arrow up to its nearest **named ancestor**, which
for an object-literal function is the enclosing function — hence `makeAlpha`.

The three **class** metrics pass it. The three **function** metrics do not:

| rule                                              | source                                | passes `qualifiedName`                         |
| ------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| `maxMethods` / `maxClassLines` / `maxMethodLines` | `src/rules/metrics.ts:64, :139, :218` | yes — `getMemberName(cls, member)`             |
| `maxFunctionComplexity`                           | `src/rules/metrics-function.ts:31`    | **no**                                         |
| `maxFunctionLines`                                | `src/rules/metrics-function.ts:67`    | **no**                                         |
| `maxFunctionParameters`                           | `src/rules/metrics-function.ts:107`   | **no** — expected to collide, **not measured** |

Every one of the three builds its `message` from `fn.getName()` — the value that is correct — and then
passes `fn.getNode()` to `metricViolation` with no `qualifiedName`, so the identity re-derives a name from
the AST node and gets a different answer. **Two name derivations inside one violation, disagreeing.**

So the class path was fixed and the function path was not. The mechanism differs from 0067: there the
qualified name genuinely does not exist (no binding to derive it from); here it exists, is correct, and is
discarded one line before it is needed.

## The comment above the defect already forbids it, twice

`metric-violation.ts:87-94` reasons carefully about exactly this failure and cites its own history:

> Leaving the FILE out is the other half, and it was shipped once: two classes named `Big` in different
> files produced one identity, one hash, and `withBaseline`'s last-write-wins picked whichever ceiling came
> last — measured, a real 10 → 15 regression was silently accepted while the sibling sat at 20. That is bug
> 0028's shape recreated inside bug 0012's fix, and `ArchViolation.identity`'s own contract forbids it:
> **"two distinct violations sharing one identity are one violation to the baseline, and accepting either
> accepts both."**

The file is now in the identity and the **name** was the remaining half.

**That `last-write-wins` consequence no longer follows, and this paragraph used to claim it did.** v0.57.0's
`disambiguateIdentities` gives the second finding its own hash, so no `measured` value is overwritten and no
regression is silently accepted. Corrected rather than deleted, because the reasoning is what makes the
surviving wrong-name defect worth fixing at all: the comment above this line is right that a name is part of
an identity's meaning, and the disambiguator makes the identity _unique_ without making it _correct_ — the
second finding is keyed on a name that is not its own.

## Fix

One line per rule — pass the name the message already uses:

```ts
metricViolation(
  fn.getNode(),
  { metric: 'lines', measured, message, qualifiedName: fn.getName() },
  context,
)
```

`fn.getName()` is `ArchFunction`'s own name, which for an object-literal function is the qualified key path
built by `fromObjectLiteralFunction` (`arch-function.ts:281`). No new derivation, no new engine, and it
makes the identity agree with the message by **construction** rather than by two paths happening to match.

Note this does **not** close 0067, and the two must not be merged: 0067's names are already equal because
nothing distinguishes them, so passing the name through changes nothing there. This bug is "the right name
was discarded"; 0067 is "there is no right name yet".

## Guard

The vacuity trap here is specific and worth naming, because the obvious test walks into it: a fixture with
**one** object-literal function per file cannot show this. The inner and outer findings must both fire, in
the same file, for the collision to exist. So the guard needs a fixture where an object-literal function
**and** its enclosing function both breach the same threshold, and it must assert **identities, not counts**
— `expect(findings.length).toBe(4)` passes with the bug intact, since the bug loses identities, not
findings. Assert `new Set(findings.map(v => v.identity)).size === findings.length`.

Derive the census rather than listing the three rules: every `metricViolation` call site that does not pass
`qualifiedName` is a candidate, and that is checkable from source.

## Not measured

- `maxFunctionParameters`. Same construction at `metrics-function.ts:107`, so it is **expected** to collide,
  but the fixture's arrows take one parameter and never breached it. Measure before claiming it in a
  changelog.
- Whether the class metrics are fully safe. They pass `getMemberName(cls, member)`, which looks correct, but
  two classes in one file with a same-named method were **not** probed.
- Whether `element` disagreeing with `message` has consequences beyond identity — `.excluding()` matches
  against `[element, file, message]`, so an exclusion written against the message may not match the element.
  Not tested.

# Bug 0068: a function metric names an object-literal function after its enclosing function

**Reported:** 2026-08-05 · **Fixed:** 2026-08-06 (v0.58.0) · **Rewritten:** 2026-08-05, after v0.57.0 closed the half
this report led with.
**Found in:** asking whether [0067](./0067-a-duplicate-pair-identity-collides-on-two-same-named-functions-in-one-file.md)
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

## Fix as shipped

**v0.58.0**, 2026-08-06. Shipped in two attempts; the first was wrong in a way worth recording, because
it is the same shape as the bug.

### Attempt 1 — passing the own name alone, and why it regressed

The report's Fix section prescribed one line per rule: `qualifiedName: fn.getName()`. That makes the
identity agree with the message, and it **moved the collision instead of closing it.**
`owningBindingName` (`arch-function.ts:248`) deliberately declines to prefix an object literal that is
**returned from a factory** or passed as a call argument — _"inventing one from a distant ancestor would
be a guess"_ — so two factories each returning `{ build: … }` both name it `build`. Measured:

|                       | before attempt 1     | after attempt 1                  |
| --------------------- | -------------------- | -------------------------------- |
| `makeBeta`'s `build`  | `::makeBeta::lines`  | `::build::lines`                 |
| `makeGamma`'s `build` | `::makeGamma::lines` | `::build::lines` — **identical** |

Distinct before, byte-identical after, falling back to `disambiguateIdentities`' positional `#N` — the
exact ceiling-rotation mechanism this report's severity rests on, relocated into the resolver-map and
route-table shapes the release notes advertise as fixed. A reviewer reproduced the harm end-to-end
through the CLI: a survivor inherited a ceiling of 8 and a 4 → 8 regression was silently accepted.

### Attempt 2 — as shipped

The refusal in `owningBindingName` is right for a **display name**, which is what it governs. An
**identity is an opaque key**, not a claim about what a thing is called, so scope-qualifying it is not a
guess. `metricViolation` now builds the identity's name segment from the pair — measured across every
function shape, because neither name alone is sufficient:

| shape                             | own name                   | scope (`getElementName`)                             | identity segment                    |
| --------------------------------- | -------------------------- | ---------------------------------------------------- | ----------------------------------- |
| two factories returning `{build}` | `build`, `build` — collide | `makeBeta`, `makeGamma`                              | `makeBeta.build`, `makeGamma.build` |
| arrow inside a named function     | `errorResponseBuilder`     | `makeAlpha` — collides with its parent's own finding | `makeAlpha.errorResponseBuilder`    |
| bound literal `resolvers.top`     | `resolvers.top`            | `ArrowFunction` — a kind, not a scope                | `resolvers.top`                     |
| top-level `function takesFive`    | `takesFive`                | `takesFive`                                          | `takesFive` — unchanged             |

Display names, messages and `haveNameMatching` are untouched. The three call sites derive the name
**once** and use it for both the message and the identity — two expressions that agreed in every branch
but one (`fn.getName() ?? '<anonymous>'` beside a bare `fn.getName()`) would have reproduced this
report's own defect for an anonymous function, inside its fix.

`element` also carries the qualified name. That was **not** in the report's Fix section and had to be
added: `qualifiedName` alone corrects the identity and leaves consequence 1 — the terminal and JSON
field — still naming the enclosing function.

### Correction: the class path WAS touched

This section previously said the class metrics were untouched "because they already passed
`qualifiedName`". False for `element`. They pass it, so `element: options.qualifiedName ?? base.element`
changes them too — measured, `save` → `UserRepo.save`, on `maxCyclomaticComplexity`, `maxMethodLines`
and `maxParameters`. Identity is unchanged there, so no `classes()` baseline moves; `.excluding()` by
bare member name does. Three documents said otherwise and all three are corrected. Nothing in the suite
pinned `element` for a class metric — an output change on three published conditions passed 3189 tests
silently — so `tests/rules/metrics.test.ts` now pins it as a literal.

**The `functions()` path reaches class methods too**, since `collectFunctions` includes them by default,
so `UserRepo.save` identities move under a `functions()` metric. The release notes originally scoped the
migration to object-literal functions; corrected.

### Measured, before and after

Fixture `tests/fixtures/metrics/src/nested-object-literal.ts`, built around the traps this report named
plus the two the review added:

| metric                      | before                                                                  | after                                                                       |
| --------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| lines, inner arrow          | `element=makeAlpha  id=…::makeAlpha::lines` (identical to its parent's) | `element=errorResponseBuilder  id=…::makeAlpha.errorResponseBuilder::lines` |
| lines, two factory `build`s | `::makeBeta::lines`, `::makeGamma::lines`                               | `::makeBeta.build::lines`, `::makeGamma.build::lines`                       |
| parameters, `manyParams`    | `element=makeAlpha`                                                     | `element=manyParams  id=…::makeAlpha.manyParams::parameters`                |

**The `maxFunctionParameters` item from "Not measured" is now measured**, and the report's expectation
was half right. It produces the wrong name as predicted — but with the original fixture it did **not**
collide, because a collision needs the enclosing function to breach the _same_ metric and `makeAlpha`
took no parameters. The fixture now gives `makeAlpha` five, so the parameters row exercises a real
group. Before that change, reverting the parameters fix left the row **green**.

### Guard

`tests/rules/metric-identity-names-its-own-function.test.ts`, plus the class-metric `element` pin in
`tests/rules/metrics.test.ts`:

- **Never a count.** `toHaveLength(4)` passes with the bug intact — the bug loses identities, not
  findings. Even `identities.size === violations.length` was rejected: two counts, and this repo's own
  cardinality scanner flagged it. The rows assert identity **names** as lists.
- **An independent derivation**: literal expected element names, written out, compared against what the
  conditions produce — the one row that notices if the shared `fn.getName()` source is itself wrong.
- **A regression row** for the two factory `build`s, asserting `['makeBeta.build','makeGamma.build']`
  rather than "two distinct strings", which a positional `#N` would also satisfy.
- **Behavioural `.excluding()` rows**, closing the report's third "Not measured" item and testing the
  release notes' two-directional claim by applying it rather than reading it (ADR-008 rule 2).
- **A census that asserts its own population first.** The first version scanned with a regex requiring
  exactly twelve spaces of indentation; every real call site is at fourteen or sixteen, so it inspected
  **0 of 9** and passed with the entire fix deleted. It is now a ts-morph parse asserting
  `parsed.length === textual occurrences` before asserting anything about the contents, and the three
  sites that legitimately pass no name are listed by name — the stated invariant was false too, so a
  repaired regex would have redded on correct code.

### Sabotage

7 rows, **verdicts recorded per test rather than per row** — the first matrix scored 5/5 caught and was
blind to the vacuous census, because another test caught every row and one whole-suite exit code cannot
see which detector fired. Green baseline asserted, every patch asserted to apply non-trivially (two did
not on the first run and were reported as unmeasured rather than scored), verdicts from exit codes, the
three identical `qualifiedName` edits split into three rows.

| row                                                  | caught by                                |
| ---------------------------------------------------- | ---------------------------------------- |
| complexity site drops the name                       | 3 tests, incl. the census                |
| lines site drops the name                            | 6 tests                                  |
| parameters site drops the name                       | 3 tests, incl. the census                |
| `element` stops using the qualified name             | 6 tests, incl. an `.excluding()` row     |
| **identity drops the scope prefix (the regression)** | 3 tests, incl. the dedicated factory row |
| identity uses scope only (pre-0068 behaviour)        | 6 tests                                  |

**Caught by nothing: 0 of 7.**

### Still open

- **Adopter baselines move for `functions()` metrics** — object-literal functions and class methods
  alike. Same class as 0064/0065; the changelog carries a preview command that names every moving entry
  before upgrade.
- **Two classes in one file with a same-named method** — this report's second unmeasured item. The
  scope-qualified identity now separates them under a `functions()` metric (`Repo.save` vs `Other.save`
  are already distinct own names), but the case was not probed directly.
- **An anonymous function** still reports `<anonymous>` in the message against a kind-derived identity
  (`FunctionDeclaration`). The three call sites now derive one name, so message and identity no longer
  disagree about _which_ function — but the name itself is still not an identity. That is 0067's
  territory, not this one's.
- 0067 is **not** closed by this and must not be merged into it.

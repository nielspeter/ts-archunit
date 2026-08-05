# Bug 0064: a dependency identity collides across two spellings of one module

**Reported:** 2026-08-05 · **Fixed:** not yet
**Found in:** pre-existing, long before v0.56.0. Surfaced by the five-persona review of the bug-0059
branch, and **not** caused by it.
**Severity:** High. A baseline fail-open on a published surface — one accepted entry silently
pre-accepts a second, genuinely different dependency edge. Blast radius is the baseline identity string
adopters store on disk, which is the top row of [ADR-008](../adr/008-agent-first-failure-surfaces.md)
rule 6. (An earlier draft of this line also argued the trigger was "the common monorepo layout". That is a
**frequency** argument, and `BUGS.md`'s convention says in terms that severity is not about frequency —
the blast-radius sentence carries the rating on its own. Removed rather than rephrased.)

## What happens

`edgeViolation`'s identity is built from the **resolved absolute path** of the target
(`edgeCandidates(edge, sourceFile)[0]`, `src/conditions/dependency.ts`), while every discriminator inside
it derives from the **specifier as written**. Two spellings that resolve to the same file therefore
produce one identity for two distinct findings.

Measured on an in-memory project with `paths: { '@app/*': ['src/*'] }`, one file importing the same
module by an alias and by a relative path:

```
DYNAMIC, two spellings
  notImportFrom: findings=2  hashes=1   *** COLLISION ***
  identities = ["…::dynamic::/src/legacy/index.ts::#0",
                "…::dynamic::/src/legacy/index.ts::#0"]

NAMED import, two spellings
  notImportFrom: findings=2  hashes=1   *** COLLISION ***
  identities = ["…::import::/src/legacy/index.ts::old",
                "…::import::/src/legacy/index.ts::old"]
```

This is [bug 0028](./fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md)'s shape.

**`paths` is not required**, and saying so was too narrow in one direction while being too broad in
another. Any two spellings resolving to one file will do — a workspace package name beside a relative
path (`@acme/shared` vs `../../shared/src/index.js`) needs no `paths` at all, and is the likelier shape in
the wild. Conversely, what actually collides is narrower than "uses aliases": one file reaching one module
twice, same kind, same target, **and matching discriminators**. Differing names save it — so for the named
case the file must import _the same symbol_ by two spellings, which `import/no-duplicates` and
`no-duplicate-imports` both flag. The reachable case is the names-less one: two dynamic imports of one
module written two ways.

## Three things the fix must not get wrong

Each of these was got wrong once during review, so they are recorded rather than left to be
rediscovered.

**1. It is not a v0.56.0 regression, and the ordinal is not the cause.** The named-import block above
reproduces under the _pre-ordinal_ discriminator, where no ordinal is consulted at all. Filing it against
that release, or bisecting to it, sends the reader to the wrong commit. v0.56.0 neither caused nor
worsened it.

**2. Keying the ordinal counter on the resolved path does not fix it.** That was the first proposed
remedy. It cannot work: when `names` is non-empty the discriminator returns the names and never reaches
the ordinal branch, so the named case above stays collided.

**3. It is module-family only, and the slice family is correct for a statable reason.** The slice family's
`siteIdentity` (`src/conditions/slice.ts`) keys on the raw `edge.specifier`, so the same fixtures give
**2 findings / 2 hashes** through `notDependOn`. Calling that "accidentally correct" — as the first
version of this report did — loses the thing a future refactor needs. The invariant is:

> An identity of the form `groupKey :: discriminator` is unique only if the discriminator is injective
> **within the group the identity keys on**.

The slice family satisfies it because its identity group **equals** its discriminator group (both the
raw specifier). The module family violates it: it keys the group on `resolvedPath` while both
discriminator branches are computed over the strictly finer `specifier` partition, and concatenating a
coarse key with a discriminator injective only over a finer one is unsound. That predicts the measured
collisions exactly.

Stated as an invariant, a future "make the two families consistent" change acquires a **direction**. Left
as "one uses resolved, one uses raw", it is a coin flip that could _propagate_ this defect rather than fix
it. Note also that `names` is injective in **neither** partition — `import { X }` and `import { X as Y }`
both carry `['X']` — which the resolved-vs-specifier framing hides, and which is the mechanism behind all
three collisions actually present in this repo's corpus.

## Scope — measured, and one expectation refuted

The first version of this report recorded `onlyImportFrom` and `dependOn` as _expected, not measured_.
Both were then measured, and one of them was wrong:

| condition        | result                                                     |
| ---------------- | ---------------------------------------------------------- |
| `notImportFrom`  | **2 findings / 1 hash — collides.**                        |
| `onlyImportFrom` | **2 findings / 1 hash — collides.** Expectation confirmed. |
| `dependOn`       | **Refuted — cannot collide.** Drop it from the scope.      |

`dependOn` does not route through `edgeViolation` at all. It emits **one violation per file**, with
identity `${path}::depends-on::${sortedGlobs}`, so two spellings of one module cannot produce two findings
to collide. Both premises the original scope rested on — "reads the same constant" and "routes through the
same `edgeViolation`" — are false for it, and a guard written against it would be **vacuous**.

The collision is also wider than the two spellings first documented. Measured on both v0.55.3 and v0.56.0,
two-spelling fixtures, `notImportFrom`:

| spelling                                     | findings / hashes    |
| -------------------------------------------- | -------------------- |
| `dynamic`                                    | 2 / 1 — collides     |
| named `import`                               | 2 / 1 — collides     |
| **default `import`**                         | **2 / 1 — collides** |
| **`type-expression`**                        | **2 / 1 — collides** |
| named `reexport` with distinct outward names | 2 / 2 — safe         |

**Every spelling collides whenever the discriminators match; only differing names save it.** The fix's
guard must cover that set rather than the two examples above.

## Candidate fix — the first proposal was REFUTED by measurement

**Do not implement the version this report originally carried.** It proposed keying the counter on
`kind::resolvedPath ?? specifier` and appending `#n` for `n > 0` **regardless of whether `names` is
present**, claiming "the first member of every group keeps a byte-identical identity, so the migration is
empty". Two reviewers implemented it independently and measured it:

|                                   | identities moved | collisions closed |
| --------------------------------- | ---------------- | ----------------- |
| module family, this repo's `src/` | **129 of 975**   | 3 → 0             |
| slice family, this repo's `src/`  | **39 of 304**    | 0 → 0             |
| edge-level count, src + fixtures  | **187 of 2526**  | 0 here            |

The claim was true of _first_ members and false of the entries. Every **later** member of a group gains
`#n`, and a later member is only _collided today_ when its `names` also match — so wherever the names
differ, the entry was already unique and correct, and the proposal moved it. The minimal repro needs no
alias at all, just one specifier and two edges with different names:

```ts
import type { Old } from '../legacy/index.js'
import { old } from '../legacy/index.js'
// second edge: `…::old`  ->  `…::old#1`   MOVED, and it never collided
```

That is `src/index.ts` lines 2 and 4 of this very repository — `export { … } from './core/project.js'`
beside `export type { ArchProject } from './core/project.js'` — which is why the barrel alone accounts for
most of the 129. Under the proposal **three existing test files fail**, one of them titled _"a NAMED kind
keeps a byte-identical identity — no baseline migration"_: the failing test's title is the property the
proposal claimed to preserve.

**This report asserted that remedy from a table, on the surface where a table is not admissible evidence,
in a section that told its own reader to verify before adopting.** The caution was right and being in a
footer did not save it. That is why the measured result now leads.

### The construction to adopt instead

Two independent formulations were measured and both move **3 of 975** — precisely the second member of the
three groups that genuinely collide today:

1. **Collision-suffix (preferred).** Build the candidate identity exactly as today, then append `#k` to
   the 2nd..nth edge in a file whose **full candidate identity string** is already duplicated. Its
   property is a theorem rather than a replay: _if an identity does not collide, it is emitted
   byte-for-byte._ It also subsumes v0.56.0's empty-discriminator trick rather than generalising it —
   appending `#1` to an empty component yields `…::#1`, the string v0.56.0 already emits.
2. **Two counters.** Counter A keyed `kind::(resolvedPath ?? specifier)` incremented by every edge, used
   when `names` is empty; counter B keyed `kind::(resolvedPath ?? specifier)::sortedNames` incremented
   only by named edges, used otherwise. Measured 3/975 module, 0/304 slice, 231/232 test files pass.

Both close the collision for **named and names-less alike**. Under either, the single expected test
failure is `widened-module-edges.test.ts`, whose two assertions deliberately pin the documented aliased
-import residual at _"TWO identities, and this is the honest number"_ — the fix removes that residual, so
2 becomes 3. That is a correct red requiring a test update, not a regression.

**Measure whichever is chosen before adopting it.** Not because the reasoning above is weak, but because
that is exactly what the refuted proposal's own footer said, and it was ignored.

## Guard — the file first nominated is blind to this

This report originally nominated `tests/conditions/identity-does-not-move.test.ts` with a two-spelling
fixture. Measured: **that file passes unchanged under the broken candidate**, and under the working one
too. Every `SPELLINGS` row is a single edge and every collision row is a same-names pair, so nothing in it
can see a same-specifier-different-names move. A guard nominated for a regression it cannot detect is the
defect this project keeps re-filing.

**Primary guard: a corpus identity diff.** Replay every module and slice identity over this repository's
own source against a captured set. That is what caught the 129, it is the differently-derived value
ADR-008 rule 5 asks for, and it would have failed on the commit. `tests/core/module-edges-corpus.test.ts`
already walks the real corpus but asserts edges, lines and candidates — never an identity string.

**Secondary, in `identity-does-not-move.test.ts`**, two rows rather than one:

1. two spellings of one module (`baseUrl: '/'` plus `paths: { '@app/*': ['src/*'] }` works in the
   in-memory project, so the fixture is cheap), and
2. **two edges of one kind to one module carrying _different_ names** — the row that fails under the
   refuted candidate and passes under the correct fix. Its absence is why the file was blind.

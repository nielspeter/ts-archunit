# Plan 0094 — the residual findings from the v0.56.0 review

**Status:** Open, not started. Filed 2026-08-05. These are the items from the five-persona review of the
bug-0059 branch that were **triaged and deliberately not done** in v0.56.0, recorded so the deferral is a
decision rather than an omission.
**Priority:** Medium. Two are live fail-opens in guards (§1, §2); one is a pre-existing defect that needs
its own bug number (§3); the rest are accuracy and reachability.
**Effort:** Small to medium. Eight independent items, none coupled to the others except §1 and §2, which
touch the same file.
**Blast radius:** Mixed, and each item states its own row. §3 is **the baseline identity string an adopter
stores on disk** — the top row of [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6, and the
reason it is a bug and not a line here. Everything else is **an internal check over a corpus we control**
(our own suite and docs): prove each detector fires once and stop. Do not build machinery for these.

## Why this is a plan and not eight more bugs

v0.56.0 fixed the two findings that were _reachable from an adopter's baseline_: the identity of four
names-less `import`/`reexport` spellings moved while three shipped sentences promised they did not, and
the guard for that promise asserted only the one spelling where it held. Both are closed, with
`tests/conditions/identity-does-not-move.test.ts` as the enumerated guard — reverting the fix fails 9 of
its rows, and under that revert it is the **only** file in a 232-file suite that fails. (Of the rows that
survive the revert, three are the forms that genuinely do not move and the rest are structural rows that
would survive any discriminator change — an earlier version of this paragraph called all of them forms.)

The follow-up round added the row that pins the **sort and the join separator**, which were the last two
characters of that function guarded by nothing: without the sort, a cosmetic reorder of a named import
list moves every multi-name entry in an adopter's baseline, and an import-sorting lint autofix does
exactly that. Both mutations left the full suite green before the row existed.

What remains is a different class: guards that work but whose evidence is weaker than it could be,
documentation that is accurate about the wrong scope, and one pre-existing defect that this release
surfaced without causing. Filing each as a bug would overstate them; leaving them in five reviewers'
messages would lose them.

**The pattern worth naming.** Bug 0059 was fixed, reviewed, and the fix introduced a second identity
collision justified by a false claim and guarded by a test that exercised only the passing case. That is
three rounds of the same failure. The countermeasure that worked was not another round of review — it was
enumerating the cases from the **diff** rather than from memory, and asserting against a **differently
derived** value (the identity strings v0.55.3 actually produces). Items §1 and §2 below are the remaining
places where a derivation still guards itself.

---

## 1. The ordinal's counter key is unguarded

`src/core/module-edges.ts`, `nextOrdinal`. The key is `${edge.kind}::${edge.specifier}`. Measured by the
testing review: mutating it to `edge.specifier` alone, or to `edge.kind` alone, leaves the **full suite
green** (rows S9 and S10 of 29). The increment is guarded — freezing the ordinal at 0 in either collector
is caught — but the key is not.

Consequence of the `specifier`-only mutation, measured on a real finding: adding a static import above a
lazy one moves the lazy one's identity from `…::` to `…::#1`. That is precisely the "identity survives
edits above it" property the ordinal exists to provide, gone, with nothing red.

**Fix.** The existing stability row prepends `export const unrelated = 1` — a line that is not an edge, so
it exercises nothing about the counter. Prepend an **edge** instead: an `import` of the _same_ module
catches the `specifier`-only key; a dynamic import of a _different_ module catches the `kind`-only key.
Two rows, same file, no new fixture.

## 2. `ignoreTypeImports` × the newly-counted kinds has no row

`src/helpers/slice-graph.ts`, `QUESTIONS['type-bindings'].erased`. Measured: making `type-expression`
exempt from the erasure filter (a false positive on the documented escape hatch), and making `dynamic`
always erased (which silently reverts this release's headline fix for anyone who sets the flag), **each
leave the suite green**.

v0.56.0 widens two published conditions to two new kinds and adds no row anywhere passing
`ignoreTypeImports` alongside those kinds. Coarse whole-predicate swaps _are_ caught by the existing
plan-0085 rows, which is why the gap survived — it is specifically per-kind.

**Fix.** Four rows: `{dynamic, type-expression}` × `{ignoreTypeImports: true, false}`, asserting the
behaviour that is already correct today.

## 3. The resolved-path collision — file it as its own bug

**This is the one item that must leave this plan and become a numbered bug.** It is pre-existing, it moves
nothing in v0.56.0, and it is not caused by the ordinal.

`edgeViolation`'s identity keys on the **resolved** path (`src/conditions/dependency.ts`), while every
discriminator within it derives from the **specifier**. Two spellings that resolve to one file — a `paths`
alias and a relative path, the common monorepo layout — therefore collapse to one identity. Measured:
`notImportFrom` gives 2 findings and 1 hash.

Three things that must be in the bug report, because each was got wrong once already during review:

- It is **not** a regression in v0.56.0, and **not** fixed by keying the ordinal counter on the resolved
  path. It reproduces with plain named imports under the _pre-ordinal_ discriminator, where no ordinal is
  consulted at all. Filing it against this release sends the next reader to the wrong commit.
- It is **module-family only**. The slice family's `siteIdentity` keys on the raw specifier and reports 2
  hashes. So the two families agree on _what counts as an edge_ and disagree on _what counts as the same
  finding_ — the slice family is accidentally correct here, and a future "make them consistent" change
  could propagate the defect rather than fix it.
- `onlyImportFrom` and `dependOn` were **not measured**. Both read the same constant and `onlyImportFrom`
  routes through the same `edgeViolation`, so the collision is expected there — expected, not measured.

### 3b. The reverse family sets no `identity` at all — a second bug number, beside §3

Found while settling whether `require` identities move (they do not — see below). `onlyBeImportedVia`
(`src/conditions/reverse-dependency.ts:147-154`) and `beImported` (`:193-200`) push violations with **no
`identity` field**, so `hashViolation` falls back to `rule::element::message` and `element` is a basename.
Measured: two importers sharing a basename (`/src/feature/consumer.d.ts`, `/src/other/consumer.d.ts`) give
**2 findings / 1 hash**. That is bug 0063's shape, live in the family plan 0088 never reached — and unlike
§3 it is not a discriminator problem but the total absence of one.

**Settled, and it needs no row: `require` identities cannot move.** `edgesOf` does compute an ordinal for
`require`, and `edgeDiscriminator` would return `''`/`#1` for it, but nothing identity-bearing ever asks:
no forward condition counts `require`, and the reverse conditions that do count it set no `identity`.
Structurally unreachable rather than accidentally so — `addToGraph` (`:34-41`) dedupes on
`(importer, target)`, so the reverse family sees one edge per importer however many spellings the file
uses. `tests/conditions/identity-does-not-move.test.ts` is therefore correct to be silent about `require`,
and that silence should not be read as a gap by whoever reviews it next.

## 4. Four statements contradicted by the code shipping beside them

Three were fixed in v0.56.0 (the identity promise, in the CHANGELOG, `docs/upgrading.md` and two source
comments). These remain:

- **`kindsFor` does not exist.** `src/helpers/slice-graph.ts` says "See `kindsFor` below" and
  `bugs/fixed/0059-….md` states the fix as `kindsFor(question)`. The symbol is `QUESTIONS`. Grep confirms
  zero definitions.
- **`edgeStream`'s docstring still documents the contract this release inverted** — "Order is unspecified,
  and since plan 0076 it differs between a cold and a warm call", with a measured cold/warm table — while
  the code below it sorts and `tests/core/module-edge-cache.test.ts` pins the opposite. An agent reading
  the JSDoc concludes the ordinal from `edgeStream` is unreliable, which is the reverse of what this
  release established.
- **The sort's stated rationale is measurably false.** It is justified by "a file mixing `import` and
  `import()` of the same module gets different ordinals depending on which collector ran". It cannot: the
  counter key includes `kind`, so those are different counters. The sort is still worth keeping — both
  cache rows fire on it — but re-justify it on the honest ground, and rename the test row that says "the
  ordinal depends on it".
- **`bugs/BUGS.md`'s 0062 row says `shellcheck` is in `ci.yml` and not `publish.yml`.** It is in
  `publish.yml`, added under bug 0062. This branch edited that file and left the claim standing.

## 5. `require()` is asserted as a constant, never as behaviour

`expect(FORWARD_EDGE_KINDS.require).toBe(false)` reads the constant it guards and restates it. Proof it is
insufficient: with the core kind fix reverted, that row stays green.

The behavioural row is **free** — measured passing today: `allowJs`, a `.js` file with
`require('../legacy/index.js')`, asserting the edge resolves (non-vacuous) and that both `notDependOn` and
`notImportFrom` report nothing. The counterpart claim (reverse conditions _do_ count `require`) is already
properly guarded.

~~Separately, `docs/slices.md` mis-scopes the limit to `allowJs`.~~ **Done in the v0.56.0 follow-up.** The
adopter review escalated it: a pure-TypeScript reader saw "under `allowJs`, a `require()` in a JavaScript
file" and correctly concluded "not me", when `import legacy = require('./legacy.js')` in a plain `.ts`
file is equally unreported (`kindOf` classifies `ExternalModuleReference` as `require`). Both
`docs/slices.md` and the CHANGELOG now name the TypeScript form, and both now give `docs/modules.md`'s
better reason for the identical behaviour ("CJS reds land in interop and generated `.d.ts` where the
remedy is usually 'nothing you can do'") rather than the ESM-only-package reason, which described our
distribution rather than the adopter's code.

What remains here is only the **behavioural row**, which is still missing.

## 6. The agreement row discards cardinality

`expect(notDependOn(p).length > 0).toBe(notImportFrom(p).length > 0)` is the only row comparing the two
families, and it is green as `false === false` when neither reports, and green when one reports 1 and the
other 3. Compare the sets of `(file, line)` pairs instead — §3 is exactly the class a boolean cannot see.

## 7. Reachability of what this release explains well

The asymmetry — `notDependOn()` counts dynamic imports, `beFreeOfCycles()` does not — is explained, and
the explanation is good. It lives in the page-top container tip of `docs/slices.md`. A reader deep-linked
from a failure lands on `### notDependOn` or `### respectLayerOrder`, which explain only the _type-only_
split. One sentence in each section, naming the dynamic case, closes it. **Still open.**

~~And `docs/troubleshooting.md` has no section for "new violations after an upgrade on code I did not
touch".~~ **Done in the v0.56.0 follow-up.** The adopter review argued the timing, and it was right: the
person who hits this red is not the one who read the CHANGELOG, it is a teammate weeks later whose
unrelated PR goes red on a file they never opened, and whose first move is to paste `dynamically imports`
into search. The existing nearest heading ("A rule that passed for months now fails") is scoped to
0.34.0's selector findings and would have actively misled them. That section is worth more in the release
that manufactures the symptom than it will ever be again, so it did not wait. It is keyed to both shipped
verbs, states that the finding is true rather than a regression, covers the second-sibling case in the
module family too, and ends on the one instruction that matters — do not regenerate.

Also: `docs/troubleshooting.md`'s "A rule that passed for months now fails" is scoped entirely to 0.34.0's
selector findings. Nothing covers "new violations after an upgrade on code I did not touch", which is the
v0.56.0 experience. Key a section to the words a reader will paste into search: `dynamically imports`,
`references the type from`.

## 8. Smaller, each independently true

- **Slice findings carry no `suggestion`.** The dependency family attaches a per-kind remedy; the slice
  family does not, so a violation arrives with no `Fix:` line and no link from today's red to yesterday's
  green. `siteIdentity` is set, so message and suggestion text are both free to change without moving a
  hash.
- **The slice message does not name the module.** The modules family prints the specifier; the slice
  family names only the two slices, so on a file with thirty imports the reader hunts through a code frame.
- **`makeEdge` returns a placeholder `ordinal: 0`** that both callers must overwrite. A third collector
  restores the collision with no compile error. `Omit<ModuleEdge, 'ordinal'>` makes omission a type error —
  the same argument `FORWARD_EDGE_KINDS`' own docstring makes for its total `Record`.
- **`QUESTIONS` and `ErasureQuestion` live in `slice-graph.ts`**, so only the slice family can reach them,
  while "coupling, ignoring type bindings" is the question _both_ families ask. Hoisting them into
  `module-edges.ts` is what stops the next refinement splitting the two families again — which is how bug
  0059 happened. Note the erasure predicate is currently spelled five independent times.
- **`buildSliceDependencyGraph` and `findSliceDependencyDetails` are exported for nobody.** The docstring
  says they "remain exported because `tests/` and the reverse-graph work call them directly"; grep finds
  no caller, and the `tests/` mentions are all inside comments. Un-export both, or drop the sentence.
- **`bugs/BUGS.md`'s version header** is hand-typed and lagged the release. `tests/docs/upgrading.test.ts`
  derives its version list from `CHANGELOG.md` precisely so this cannot rot; the BUGS.md header has no
  such derivation.
- **The version bump is not in the commit subject.** Seven of the last fourteen folded bumps put `(vX.Y.Z)`
  there, and the release skill runs `npm version` unconditionally — against an already-bumped tree that
  yields the wrong number, which fails closed at changelog-extract but only after a tag exists on the
  remote.
- **`docs.yml` deploys on any push to `main` touching `docs/**`**, with no concurrency group and no
dependency on publish, so a failed publish can leave the live site documenting a version npm does not
serve. Recorded in bug 0062 as gap 4; this was the first release since to touch `docs/`. Mitigation
  without touching the workflow: tag before pushing the merge.

## Out of scope

- **Widening `names` to carry the local binding.** Three of the four names-less spellings have a perfectly
  good discriminator that `namesOf` discards by policy — `import D from 'm'` has `D`, `import * as NS` has
  `NS`. The policy is right for what `names` _means_ (the names crossing the edge), so the answer is a
  separate `binding` field consulted before the ordinal, shrinking the positional primitive to genuinely
  anonymous edges. Worth doing; not worth coupling to any item above.
- **Renaming `ErasureQuestion`.** It now selects the kind set as well as the erasure predicate, so the name
  covers half of it. It is exported; churning a published type name for accuracy is not worth a migration
  while the docstring states what it selects.
- **A `HASH_VERSION` bump.** Not needed and deliberately not done: no existing identity moves, which is the
  measured result v0.56.0 ships. Recorded here so the decision is findable rather than re-litigated.

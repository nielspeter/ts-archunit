# Plan 0072 — A denylist glob that cannot match anything

**Status:** DRAFT 1. Mechanism settled by measurement; the measurement **refutes the design
[plan 0069](./0069-no-rule-may-certify-nothing.md) recorded for this fault**, so read
"What 0069 got wrong" before anything else.
**Priority:** Medium. A silent false green, but a narrow one — it needs a path-shaped denylist glob
that matches nothing, which is a typo rather than a design error.
**Depends on:** nothing. 0069's R3b (the designed static guard) and this are independent; this does
**not** need R3b's adopting-codebase gate, and it does **not** need plan 0071's widening.

## Problem

`notImportFrom('**/legcay/**')` reports zero violations forever, and that is indistinguishable from
a ban being respected. Measured on `tests/fixtures/module-edge-conditions`:

| rule                                          | violations | `diagnose()` |
| --------------------------------------------- | ---------- | ------------ |
| `notImportFrom('**/bannned/**')` — **a typo** | 0          | **0**        |
| `notImportFrom('**/banned/**')` — a real ban  | 0          | **0**        |

The second row is correct and must stay silent: a ban nobody violates is a rule doing its job. The
first row is a rule that **cannot fire**, counted as coverage.

**Polarity decides the scope, and it is measured.** The same typo in the allowlist direction is
maximally loud, so it needs no diagnostic at all:

| glob                              | findings | reads as               |
| --------------------------------- | -------- | ---------------------- |
| `onlyImportFrom('**/bannned/**')` | **14**   | screaming              |
| `notImportFrom('**/bannned/**')`  | **0**    | "the ban is respected" |

Plan 0071's widening made the allowlist case _louder_ (more edges, so more non-matching edges) while
the denylist case stays at exactly 0 forever. So this plan is **negative-polarity condition globs
only**. `GlobSite.polarity` already carries the distinction (`src/core/glob-site.ts:85`).

## What 0069 got wrong, and why it matters here

0069's "R3b gained a fault" section states the mechanism as **a glob-exercise tally** — "a glob that
can match but matched no edge in this run" — and records two prerequisites from that: `diagnose()`
promises to report _"without running any of them"_ and a tally requires running; and `doctor` cannot
load a rule file that imports vitest.

**Both prerequisites are moot, because a tally cannot work.** Measured: for
`notImportFrom('**/legcay/**')` every edge _is_ tested against the glob — the condition iterates all
edges and matches each one. Tested-count is non-zero and match-count is zero, which is byte-for-byte
what a respected ban produces. A tally distinguishes nothing.

The real discriminator is **satisfiability**, and it is static:

> An unsatisfiable glob cannot be an armed tripwire. A tripwire has to be armed against something
> that exists. `**/legcay/**` matches no path in the project, so nothing can ever cross it.
> `**/legacy/**` matches real paths, so it can.

That preserves the reasoning 0069 warned must not be deleted — `src/core/diagnose.ts:165-168`'s
_"a positive condition glob is indistinguishable from an armed tripwire that has not fired"_ — rather
than replacing it. The skip is not wrong; it is **too broad**. It is applied to every
`position === 'condition'` glob (`diagnose.ts:169`), while the tripwire argument only justifies
skipping the _satisfiable_ ones.

**Correct 0069's section to point here** rather than leaving a refuted mechanism and two phantom
prerequisites in a plan that is otherwise finished.

## Mechanism

The obstacle is not the condition-position skip. It is that **`import-target` globs have no path
universe to be dead against**, deliberately:

- `src/core/glob-site.ts:23` — _"a resolved module path or a bare specifier. Never [checked]"_
- `src/core/path-universe.ts:72` — _"`import-target`, `specifier` and `literal` are not path kinds
  and have no [universe]"_
- `src/predicates/module.ts:103` — _"an installed package resolves into node_modules, which is
  outside the project by construction, so checking it would fail every correct dependency rule"_

That exemption is right. `notImportFrom('fastify')` matches no project path and is a perfectly good
rule — and bug 0014 was fixed precisely so a bare package name works. So the fix cannot be "check
import-target against the path universe".

**It has to be a shape discriminator.** `'**/legcay/**'` is unmistakably naming a path;
`'fastify'` and `'@scope/pkg'` are unmistakably naming a package. Only the first kind can be
meaningfully unsatisfiable.

```ts
/**
 * Whether an `import-target` glob is naming a PATH rather than a package.
 *
 * Only a path-shaped glob can be checked against the path universe. A bare
 * specifier legitimately matches no project path — that is what bug 0014 was
 * fixed to support — so misclassifying one as dead would fail every correct
 * `notImportFrom('fastify')`.
 */
function namesAPath(glob: string): boolean
```

Discriminator, to be settled by measuring the real corpus (see the inventory): a glob is
path-shaped when it contains `/` **and** is not a bare or scoped package specifier. `'@scope/pkg'`
contains `/` and is a package; `'**/legacy/**'`, `'src/legacy/*'` and `'../legacy/**'` are paths.
A subpath import (`'#internal/*'`) and a package subpath (`'lodash/fp'`) are the two shapes that
will decide whether "contains `/`" needs strengthening.

Then, for a site with `position === 'condition'` **and** `polarity === 'negative'` **and**
`namesAPath(glob)` **and** the glob dead against the path universe: report it. Everything else keeps
today's behaviour.

This is one narrow widening of an existing skip. No new surface, no runtime tally, `diagnose()`'s
"without running" promise intact, and `doctor` needs nothing it does not already have.

## Decisions

**A configuration finding, not a violation.** It reports that a rule enforces nothing, which is
0069's category: `bypassFilters: true`, forced to `error`, refused by `.excluding()`, skipped by
diff and baseline. Same treatment as every other "this rule cannot fire" finding.

**The remedy is specific, because the generic one is wrong here.** 0069's dead-glob remedy offers
"the glob names a directory rather than the files inside it (append `/**`)" among its causes. For a
denylist the likeliest cause is a misspelling, and the second-likeliest is that the banned code was
already deleted — in which case the correct action is to **delete the rule**, not fix the glob. Say
both, and say which is which.

**It must not fire for a package-shaped glob, ever.** That is the failure mode that would make this
plan a net negative: `notImportFrom('fastify')` on a project that has not installed fastify yet is a
legitimate pre-emptive ban, and a red there would teach people to delete the guard. Guarded by
identity in the inventory, in both directions.

## Test inventory

1. **The two rows in Problem, as one test.** `notImportFrom('**/bannned/**')` reports a
   configuration finding; `notImportFrom('**/banned/**')` over a folder nobody imports reports
   **nothing**. Both in one test, because the pair is the whole point and asserting either alone
   passes on a build that fires for everything or for nothing.
2. **Package-shaped globs never fire**, asserted as an explicit list: `'fastify'` (installed),
   `'not-installed-anywhere'` (not installed), `'@scope/pkg'`, `'lodash/fp'`, `'#internal/x'`. The
   not-installed row is the one that matters — it is the legitimate pre-emptive ban.
3. **Polarity**: the same unsatisfiable glob in `onlyImportFrom` reports **no** configuration
   finding, because 14 real violations already say it. Asserted with the violation count, so it
   fails if the allowlist ever goes quiet.
4. **Position**: an unsatisfiable path-shaped glob in `.that().notImportFrom(…)` **predicate**
   position — decide and pin. Plan 0071 made that predicate anti-monotone, so a dead glob there
   selects _everything_, which is loud in a different way. Measure before deciding.
5. **`.excluding()` is still exempt** — `position === 'exclusion'` matching zero is remedy-optional
   (proposal 006) and must stay silent. A sabotage that widens the skip removal to exclusions must
   red.
6. **The remedy remediates**, both branches: fixing the spelling clears it, and deleting the rule
   clears it. The second is the branch a generic dead-glob remedy gets wrong.
7. **`diagnose()` still reports without running.** Asserted by a rule whose evaluation would throw:
   `diagnose()` must still return the finding. That is what stops a future implementer reaching for
   a runtime tally.
8. **Corpus non-regression**: `diagnose()` over this repo's own rule files reports the same findings
   as before this change. The discriminator is new logic on a shipped surface; it must add exactly
   one class of finding and no others.
9. **Sabotage, from the diff**: drop the `namesAPath` guard (packages must red — this is the net-negative
   direction); drop the polarity guard (the allowlist must red); drop the satisfiability check (armed
   tripwires must red); invert `namesAPath` (everything flips).

## Out of scope

- **The exercise tally.** Refuted above; a tally cannot distinguish a typo'd denylist from a
  respected ban.
- **0069's R3b static guard** for non-condition positions — designed, gated on an adopting
  codebase's `doctor` pre-flight, independent of this.
- **Bug 0015's edgeless-subject case** — a subject set with no edges at all, so the allowlist was
  never exercised. Different fault, different owner, evidence in that bug file.
- **Normalizing `import-target` globs** — 0067 part C's path-glob auto-fail plus normalization is
  the broader version of the shape question here, and it is parked on a version decision. This plan
  needs only to _classify_ a shape, not to rewrite it.
- **Reporting a package-shaped glob for a package that is not in `package.json`.** Tempting and
  wrong: a pre-emptive ban on something not yet installed is the main reason to write one.

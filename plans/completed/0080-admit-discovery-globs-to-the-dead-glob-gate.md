# Plan 0080 — Admit discovery globs to the dead-glob gate

**Status:** **DONE — shipped in v0.44.0** (2026-08-03). Split out of
[bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)
on 2026-08-03 when a design review measured that the bug's proposed fix carried three criticals and
rested on an inverted premise. The bug's API half shipped in v0.42.0; this is its silence half.
**Priority:** Medium. A real false green, at an entry point no preset uses.
**Effort:** Medium. One line of filter change, and three criticals that each need a decision.
**Blast radius:** A gate on published findings, shared by **four** builders. Per
[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6 that is the published-API row: guard
the guard, and treat every builder's message as a separate claim.

## Problem

Two of the three cross-layer conditions report **nothing** when a layer resolves to no files.
Measured on a 2-routes / 2-schemas fixture, intact configuration against a dead left-layer glob:

| Condition                 | all layers resolve | left layer dead     |
| ------------------------- | ------------------ | ------------------- |
| `satisfyPairCondition`    | **4** violations   | **0** — false green |
| `haveConsistentExports`   | **4** violations   | **0** — false green |
| `haveMatchingCounterpart` | 1 violation        | 1 — config finding  |

The intact column is non-zero, so the comparison is sound. `haveMatchingCounterpart` is already
guarded at `src/conditions/cross-layer.ts:49` and must not be re-fixed.

The gate that should catch this discards the verdict one line after computing it:

```ts
// src/core/terminal-builder.ts:433
if (site.position !== 'selector') continue
```

Its stated premise (`:388`) is _"`discovery` already fails (0067-D, and the slice builders own
their own message)"_. **False for crossLayer**, and that is the root cause.

## The change

Admit `discovery` sites. One line. Everything below is why that one line is not the whole plan.

## Critical 1 — the gate REPLACES slice's finding, it does not duplicate it

The bug claimed slice would double-report and that `dedupe-config-findings.ts` would collapse it.
Both halves are wrong, and the truth is worse.

The dedupe key is `` `${file} ${ruleId ?? rule} ${element}` ``, and `element` is the rule id for
slice (`slice-rule-builder.ts:324`) against `site.glob` for `deadSelectorViolation`
(`terminal-builder.ts:473`) — two keys, no merge. But they never coexist:
`collectWithAssertionGuard` early-returns at `terminal-builder.ts:176`
(`if (deadGlobs.length > 0) return deadGlobs`), so `collectViolations()` — and therefore
`emptyDiscoveryViolation` (`slice-rule-builder.ts:263`) — never runs.

**Measured cost: 15 slice tests, 13 of them the entire bug-0009 remedy corpus**
(`slice-rule-builder.ts:344-466`), whose stated subject is _"each branch below is reachable only
when its advice is actually true."_ Admitting discovery sites naively trades an ADR-008 rule 1
defect for a rule 2 defect — the Context table's own signature.

### The fix, and it must be derived rather than named

Do **not** write an "except slice" list. That is the rule-5 shape this project keeps paying for,
and `terminal-builder.ts:388`'s comment is itself an instance of it — an unchecked claim about who
owns what.

Derive it: for a dead **discovery** tree, run `collectViolations()` first and prefer a
`bypassFilters` finding it produces; fall back to the gate's finding when it produces none. Keep
**gate-first** for `selector`, where the AST-walk rationale at `terminal-builder.ts:174` genuinely
applies.

Cost is one extra `collectViolations()` on the discovery-dead path, which is cheap for all three
owners: slice returns at `:263`, resolver at `:225-227`, and smell scans an empty folder set. It
keeps **one** producer, so plan 0078's census is untouched, and slice keeps both its better message
and its `every`-slices semantics.

## Critical 2 — the empty-project short-circuit is missing on the selector path TODAY

Independent of this plan, and it should probably be fixed first.

Measured on `tests/fixtures/does-not-load`:

- **gate:** _"This rule's selector `matching("src/")` can never match anything … this path exists
  and contains TypeScript, but your tsconfig include/exclude keeps it out of the project. Correct
  the glob, or remove the rule."_
- **doctor:** `kind: 'project-empty'`, _"the project loaded 0 source files."_

`diagnose.ts:189` has the bug-0031 short-circuit; `deadSelectorFindings` has none. So the gate tells
the reader to correct a **correct** glob, and it breaks the character-for-character parity pinned at
`tests/core/assertion-gate.test.ts:598-628` — falsifying the docstring at
`terminal-builder.ts:396-399` that bug 0040 cited as its reason to reuse this producer.

Admitting discovery sites widens the blast radius of a defect that is already shipped. **File it
separately and fix it first.**

## Critical 3 — this re-introduces a deliberately withdrawn slice guard

`assignedFrom` fans out one glob tree per entry (`slice-rule-builder.ts:145-162`), so one dead entry
among populated siblings is a dead _tree_ and would now fail. `slice-rule-builder.ts:272-281`
records that exact guard being withdrawn before release because it fires on legitimate projects —
"a layer not created yet, and the `strict-boundaries` scaffold itself". Measured:
`slice-rule-builder.test.ts:185-205` fails.

Note the asymmetry that decides the design: **per-tree is right for crossLayer**
(`cross-layer-builder.ts:193-198`) and **deliberately wrong for slice `assignedFrom`**. One position
filter cannot express both, which is a second argument for Critical 1's derived approach.

## The message lies for three of four builders, and not only in its noun

Measured, all three read `This rule's selector layer("routes", …)` / `assignedFrom({ … })` /
`resolvers(p, …)`. The bug called for "a position-aware noun". That understates it: the **cause
clause** is what lies. Fixing the noun alone ships a grammatical sentence that is still wrong.

## What it fixes beyond the headline

- **The "missing case" bug 0040 rates worse than the silence.** A dead **final** layer yields a
  correct configuration finding naming `layer("schemas", …)` — which the condition's loop at
  `cross-layer.ts:33` structurally cannot produce, since it only inspects `layers[i]`. Live control:
  0 violations, 0 findings.
- **graphql resolver:** 0 existing tests break; a dead discovery glob goes from **0 findings to 1**.
  The bug's read-not-measured claim is now measured true, and `resolver-rule-builder.ts:225-227` is
  preempted.
- **smells:** 2 tests break, and `tests/smells/smell-builder.test.ts:71-80` **is itself a false
  green** — `inFolder('**/nonexistent/**')` asserting `not.toThrow()` with the comment "No files in
  nonexistent folder, so no violations". A new row for ADR-008's Context table. Rewrite it against a
  real-but-different folder.

Both need a release note. Rule 1's migration corollary is already satisfied — `doctor` reports these
today, because `diagnose.ts:227` includes `discovery`. That is this plan's strongest argument, and
the same fact that makes Critical 2 a parity **regression** rather than a new divergence.

## Phase order

1. **Critical 2 first, on its own** — the empty-project short-circuit on the selector path. Shipped
   defect, independent, and it must be right before the gate's audience widens.
2. Extract one `isFaultPosition(position)` shared by `diagnose.ts:227`, `:256` and
   `terminal-builder.ts:433`. Two hand-maintained inverse position lists that must agree is the
   drift, **and they already disagree**.
3. The derived preference from Critical 1, with slice's corpus green.
4. Position-aware message: noun **and** cause clause.
5. smells + graphql, with the false green at `smell-builder.test.ts:71-80` rewritten.

## Test inventory

| Test                                                 | Asserts                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| dead crossLayer layer, `satisfyPairCondition`        | a configuration finding, where there were 0                            |
| same, `haveConsistentExports`                        | ditto                                                                  |
| dead **final** layer                                 | a finding naming the right layer — the case the condition cannot reach |
| live control, all three conditions                   | **no** configuration finding (or the fix false-reds everything)        |
| slice, dead `matching()`                             | slice's **own** message survives, not the gate's                       |
| slice, `assignedFrom` one dead entry among populated | still **passes** — the withdrawn guard stays withdrawn                 |
| empty project, selector and discovery                | gate text == `doctor` text, character for character                    |
| resolver, dead discovery glob                        | 1 finding, up from 0                                                   |
| smells, dead `inFolder`                              | 1 finding; the rewritten test uses a real folder                       |

## Guards

Sabotage from `git diff`, exit codes, green baseline asserted first, **tree held exclusively**
(ADR-008 rule 5, and bug 0045). At minimum: remove the discovery admission; make the preference
gate-first for discovery; break the empty-project short-circuit; reverse the `isFaultPosition`
sense. Each must red, and the live controls must stay green.

## Out of scope

- The condition-side guard at `cross-layer.ts:49`. **Keep it.** `deadSelectorFindings` returns `[]`
  when `getProject()` is `undefined` (`terminal-builder.ts:415`) and `PairFinalBuilder`'s project is
  optional (`cross-layer-builder.ts:181`), so it is the no-project fallback. Written down here
  because after this plan it looks unreachable and someone will delete it.
- Claiming `isDeadSite` and `resolveLayer` are independent derivations. They are not — both are
  picomatch over `project.getSourceFiles()`, switched by the same `isProjectRelative` predicate, so
  the error cancels on both sides. Fine as evidence the gate _suffices_; not as a rule-5 guard. They
  also differ: `isDeadSite` takes the union of both path views (`path-universe.ts:64-71`,
  deliberately generous) where `resolveLayer` consults one. No reachable divergence was found — a
  second reason to keep the condition-side guard rather than call it redundant.

## Related

- [Bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md) — the API half, shipped v0.42.0.
- [Plan 0078](../0078-derive-the-configuration-finding-census.md) — keeping one producer keeps its census untouched.
- [Bug 0009](../../bugs/fixed/0009-slice-glob-conventions-diverge-and-remedy-misleads.md) — the slice remedy corpus Critical 1 would destroy.
- [Bug 0031](../../bugs/fixed/0031-diagnose-blames-the-glob-when-the-project-loaded-nothing.md) — the short-circuit Critical 2 says is missing on the selector path.

## What shipped, and where the plan was wrong

All five phases, and the plan's own design for Critical 1 turned out to be **unbuildable**.

### Phase 1 — already done

Critical 2 shipped as [bug 0048](../../bugs/fixed/0048-the-dead-glob-gate-blames-the-glob-when-the-project-is-empty.md)
in v0.42.1, before this work started.

### Phase 2 — `isFaultPosition`, and the two lists really did disagree

Verified before changing anything: `diagnose.ts` skipped `exclusion` and `condition`, so it treated
**selector and discovery** as faults; the gate skipped everything but `selector`. Two inverse
hand-maintained formulations, disagreeing about exactly `discovery` — which is why `doctor` reported
a dead layer glob and the build did not. One predicate now, used by all three sites.

### Phase 3 — the plan's fix could not work, and slice is the counterexample

The plan said to **derive** the owner: run `collectViolations()` first and prefer any `bypassFilters`
finding it produced. Built it, and it failed on the case Critical 3 names.

For a **partially** empty `assignedFrom`, slice produces **nothing** — _deliberately_. A slice with
no files yet is legitimate, and that guard was withdrawn before release for firing on real projects.
So "prefer what the builder produced" reads silence as _no opinion_ when silence **is** the opinion.

Replaced with a **declaration**: `ownsDiscoveryDiagnosis()`, precedent `assertsCardinality()`
directly above it. Two builders declare it —

| builder            | why                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------ |
| `SliceRuleBuilder` | discovery is not per-tree; it owns both the all-empty and partial-empty cases        |
| `PairFinalBuilder` | all three conditions name the empty _layer_, with bug 0042's thrice-corrected remedy |

Still derived in the sense that mattered: the knowledge lives with the builder that has it, never as
a list of exceptions in the gate. That list was the unchecked claim this plan was filed to correct.

**And the ownership turned out to be per-condition, not per-builder.** Admitting discovery globs made
the gate preempt `haveMatchingCounterpart`'s empty-layer finding — better than the gate's, and bug
0042's whole subject. But declaring builder-level ownership would have re-silenced the two sibling
conditions, which is the bug. So `haveConsistentExports` and `satisfyPairCondition` now share one
`emptyLayerFinding` helper with it, using the `context.layers` that v0.42.0 put there. Three
conditions, one helper, so a fourth cannot arrive without the guard.

### Phase 4 — the cause clause, not just the noun

Review was right that a position-aware noun understates it. _"so it has no subjects and cannot fail"_
is false for a discovery glob — there may be plenty of subjects; nothing was discovered to compare.
Both clauses vary now, and a sabotage row pins the noun.

### Phase 5 — measured, both confirmed

- **graphql resolver:** dead discovery glob **0 findings → 1**, live control silent. The plan's
  read-not-measured claim is now measured.
- **smells:** the same, and `tests/smells/smell-builder.test.ts:71` **was itself a false green** —
  `inFolder('**/nonexistent/**')` asserting `not.toThrow()` under the comment _"No files in
  nonexistent folder, so no violations"_. The ∀-over-∅ pass written down as the expectation.
  Rewritten against the fixture's real directory, with the dead-glob case as its own row.

### Three more tests that pinned vacuous passes

- `cross-layer-builder.test.ts` — _"no violations and no crash when a layer matches no files"_, whose
  callback was named `'should not be called'`. True, and the defect.
- `held-builder-is-immutable.test.ts` — proved no leak by asserting a dead folder glob yielded
  **zero** findings. Now asserts on the finding's kind instead; the immutability property is unchanged.
- `smell-builder.test.ts:71`, above.

## Sabotage — 7 of 7

| Revert                             | Result |
| ---------------------------------- | ------ |
| M1 — `discovery` not a fault       | CAUGHT |
| M2 — every position a fault        | CAUGHT |
| M3 — discovery never reported      | CAUGHT |
| M4 — ownership declaration ignored | CAUGHT |
| M5 — slice stops owning            | CAUGHT |
| M6 — crossLayer stops owning       | CAUGHT |
| M7 — noun always "selector"        | CAUGHT |

The patch helper now **aborts on an ambiguous anchor** as well as a missing one. That is the failure
that fooled the v0.43.2 cost measurement — two identical lines, `replace(..., 1)` hitting the wrong
one, both arms running the same path. A count check is two lines and would have caught it.

## Out of scope, unchanged

The condition-side guard at `cross-layer.ts` stays: `deadSelectorFindings` returns empty when
`getProject()` is undefined and `PairFinalBuilder`'s project is optional, so it is the no-project
fallback. It is now also the primary path, since `PairFinalBuilder` owns discovery diagnosis.

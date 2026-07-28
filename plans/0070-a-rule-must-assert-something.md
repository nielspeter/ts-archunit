# Plan 0070 — a rule must assert something, and every assertion you write is kept

**State:** DRAFT 2 — reviewed once (architect + product), rewritten. The mechanism changed; the diagnosis did not.
**Priority:** Highest open item, ahead of R3b. Both defects are live in v0.21.0 and both are silent.
**Effort:** One root implementation, six hook overrides, one deletion, and the guards. Two releases.
**Closes:** [bug 0019](../bugs/0019-a-rule-with-no-condition-passes-in-total-silence.md), [bug 0020](../bugs/0020-should-twice-silently-drops-the-first-assertion.md).
**Splits from:** [plan 0069](./0069-no-rule-may-certify-nothing.md) R3b — see "Why this is not R3b".
**Absorbs:** [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md), except its override-key ask — see Out of scope.
**Blocked by:** [bug 0021](../bugs/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md). This plan's finding would print the rule author's unrelated `Fix:` line until that is fixed.

## Corrections carried into draft 2

Round 1 found the largest defect **inside the draft's own mechanism** — the same place round 6
found plan 0069's. The pattern is consistent enough to name: the diagnosis survives review,
the mechanism does not, because the mechanism is where the untested assumptions live.

| Claimed in draft 1                                                                           | Measured 2026-07-28                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Four sites"                                                                                 | **Five states.** `tsconfig(p).check()` with no `.requires()` → 0 violations, 0 warnings, exit 0. A rule asserting nothing, in scope by this plan's own title, invisible to a design that patches four `collectViolations` bodies           |
| Four per-builder implementations                                                             | `plans/ROADMAP.md:80` already recorded the decision — "a single implementation on `TerminalBuilder` instead of five copies" — and draft 1 reverted it without arguing against it. `terminal-builder.ts:23` states the general form         |
| "A condition-less rule is decidable without a filesystem", the argument for shipping ungated | **False of draft 1's mechanism.** The check sat after the empty-subject early return, so `.that().haveNameMatching(/^zzznope/).should().check()` stayed silent. What it shipped was "a rule with **≥1 subject** must assert something"     |
| "The surviving case is a predicate-only method after `.should()`, which resets the phase"    | **Inverted.** `that()` is the only writer of `_phase` besides `should()`. Measured: `.should().areAsync().check()` → **0 warnings**; `.that().pred.check()` with no `.should()` → **1 warning**. The shape draft 1 named is the silent one |
| "There is no legitimate 'I meant to assert nothing' case; that is the premise"               | **Refuted by this framework's own code.** `src/presets/layered.ts:44` guards `if (otherLayerGlobs.length > 0)` precisely because a config-driven rule yields zero conditions when the configured list is empty                             |
| Test item 6, findings "distinguished by element"                                             | **Unimplementable.** Two conditions over one selection iterate the same filtered set, so elements are identical by construction. The discriminator is the **message**                                                                      |
| Test item 9, "flip the assertion"                                                            | `toHaveLength(4)` is satisfied by a correct **and** a sabotaged `copy()` — `notExist` gives 4, `beExported` gives 0. The `1 === 1` defect from bug 0016's own review, reintroduced by the fix next door                                    |
| "a test that reflects over builders with a `_conditions` field"                              | `_conditions` is an instance field, so `Object.getOwnPropertyNames(Cls.prototype)` is false for **all 18** exported builders. Field reflection cannot be written — and it would classify `TsconfigBuilder` as fine                         |
| One release                                                                                  | The pre-upgrade instrument is wrong in **both** directions (see "Why two, not one"). Two releases, measure then flip — the R2a→R3 precedent                                                                                                |
| "This plan does both — completes `assertsSomething` and ships ungated"                       | Self-contradictory. `0069:343` says "without that addition, 019 belongs in R3a", and `0069:451` **rejects** moving it there. Completing the addition returns 019 to R3b by 0069's own rule. Argument withdrawn; the other one suffices     |
| "`ROADMAP.md` says 'at five sites'"                                                          | It says four, twice (`:76`), corrected in the v0.21.0 commit. The stale "five" is in `proposals/019:47,62` and `bugs/0019:54`. Draft 1 corrected the document that was already right and left the two that were wrong                      |
| `rule-builder.ts:371`, `:73`, `:269-274`                                                     | `:378`, `:76`, `:276-282`. Exact as cited: `:338`, `:206`, slice `:234`, schema `:183`, resolver `:209`                                                                                                                                    |

## Problem

Two defects, one sentence apart. Both shipped, both silent, both found while deciding a
design question rather than by any test.

**A rule with subjects and no condition passes in total silence.** Measured against
`tests/fixtures/poc`:

```
functions(p).that().haveNameMatching(/^parse/).should()    // 4 subjects, 0 conditions
  .check() throws:  NO — passes
  warnings:         0 — SILENT
```

There is a guard for exactly this at `src/core/rule-builder.ts:378`, and it cannot fire for
that shape: it is gated on `_phase === 'predicate'`, and `should()` sets the phase to
`'condition'` (`:76`).

**`should()` twice discards the first assertion.**

```
.that().haveNameMatching(/^parse/).should().notExist().should().beExported()  ->  0 violations
  notExist   alone  ->  4 violations
  beExported alone  ->  0 violations
```

Two assertions written, one enforced, four findings lost, no output. `fork()` clears
`_conditions` (`:276-282`), and `should()` calls `fork()`.

They compose: the second produces the state the first fails to report.

## Five states, four remedies

Draft 1 enumerated call sites. The right enumeration is **states in which a rule asserts
nothing**, because that is what the title claims and what determines the message. Measured,
all five, on `tests/fixtures/poc`:

| Shape                                      | Today                               | `_phase`      | Sanctioned fix                                             |
| ------------------------------------------ | ----------------------------------- | ------------- | ---------------------------------------------------------- |
| `.that().pred.should().check()`            | 0 warnings, no throw                | `'condition'` | Add a condition after `.should()`                          |
| `.that().pred.should().areAsync().check()` | **0 warnings**, no throw            | `'condition'` | `areAsync` is a **predicate** — move it before `.should()` |
| `.that().pred.check()` (no `.should()`)    | 1 warning, no throw                 | `'predicate'` | Add `.should()` and a condition                            |
| `functions(p).check()` (bare)              | 1 warning, text claims "predicates" | `'predicate'` | Delete the rule, or complete it                            |
| `tsconfig(p).check()` (no `.requires()`)   | 0 warnings, no throw                | n/a           | Add `.requires({...})`, or delete the rule                 |

`_phase` separates the first two from the next two for free, and it is already there
(`grep -n "_phase" src/core/rule-builder.ts` → `:38, :57, :76`). So **drop `_phase` from the
gate and keep it in the message.** Bug 0019's "drop the `_phase` term" is right about the
condition and wrong about the text.

A fifth remedy exists that no shape above implies, and draft 1's premise denied it:

```ts
// src/presets/layered.ts:44
if (otherLayerGlobs.length > 0) {
```

That guard exists because the natural expression of a config-driven rule — build the
selector, add one condition per configured entry — yields **zero conditions when the
configured list is empty**. A user writing their own preset over their own config hits it,
and their fix is neither "add a condition" nor "delete the rule": it is _don't generate the
rule when there is nothing to assert_. The message must say so, or the finding asserts a
remedy that does not apply — ADR-008 rule 2, which is what [bug 0021](../bugs/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md) is already about.

## Mechanism

### 1. One gate, on the root

`TerminalBuilder` is the single root of all 13 builders as of plan 0069, and
`terminal-builder.ts:23` states the rule this follows: _"anything that must hold for all
thirteen builders now has exactly one place to live."_

```ts
// TerminalBuilder — concrete, not abstract. Both roots are public exports, so an abstract
// member is a compile break for an external subclass (the `globs()` argument from R2a).
assertsSomething(): boolean {
  return true
}

// Private root wrapper. `collectViolations()`'s signature is untouched.
private collectWithAssertionGuard(): ArchViolation[] {
  const violations = this.collectViolations()
  // Root cause wins. A rule whose SELECTOR is empty already reported the deeper fault,
  // and stacking a second config finding on it is a flood, not a finding. This is test
  // item 5 for free, rather than as a special case repeated per builder.
  if (violations.some((v) => v.bypassFilters)) return violations
  if (this.assertsSomething()) return violations
  return [...violations, this.noAssertionViolation()]
}
```

Called from the three methods that already funnel every builder: `violations()`, `check()`,
`warn()`.

**This is what makes the ungated argument true.** `assertsSomething()` reads the builder's own
fields and touches no filesystem, so the gate no longer sits behind subject materialization.
`.that().haveNameMatching(/^zzznope/).should().check()` fails. `tsconfig(p)` with no
requirements fails. Builder #14 is covered the day it is written, because the default is
"asserts something" and an override is a deliberate act.

### 2. Six hooks

| Builder                 | `assertsSomething()`                            | Note                                                                                             |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `RuleBuilder`           | `this._conditions.length > 0`                   | Exists at `:206`; keep                                                                           |
| `SliceRuleBuilder`      | `this._conditions.length > 0`                   |                                                                                                  |
| `SchemaRuleBuilder`     | `this._conditions.length > 0`                   |                                                                                                  |
| `ResolverRuleBuilder`   | `this._conditions.length > 0`                   |                                                                                                  |
| `TsconfigBuilder`       | `Object.keys(this._requirements).length > 0`    | The state draft 1 could not see                                                                  |
| `CorrespondenceBuilder` | `this._checkComplete \|\| this._checkNoOrphans` | Already **throws** (`:197`); the hook aligns it with the others and makes it visible to `doctor` |

`SmellBuilder`, `PairFinalBuilder` and the cross-layer builders take their assertion
structurally — there is no state in which they assert nothing — so they inherit `true`. That
is a claim, so test item 6 makes it one a test can refuse.

### 3. The finding, and its message

Same shape as `emptySelectionViolation()` (`:338`), which carries `because`, `suggestion` and
`docs`. **This one must not**, and neither should the other five config findings — [bug 0021](../bugs/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md).
`SliceRuleBuilder.metaViolation` already argues the case in a comment ("a false remedy by
juxtaposition") and is defeated by `execute-rule.ts:132-139`. This plan does not ship until
that is fixed, because otherwise the `Fix:` line on "this rule asserts nothing" is whatever
the author wrote about something else.

The message branches on the state table and states the subject count. Draft 1 called the count
an open question on the grounds that only `RuleBuilder` knows it. That was wrong: schema and
resolver both compute `filtered` immediately above their check, and the slice site has
`this._slices`.

```
<N> subjects selected, and the rule asserts nothing about them, so it can never fail.
Add a condition after .should() — or, if this rule is generated from configuration,
skip generating it when there is nothing to assert.
```

for `_phase === 'predicate'`:

```
<N> subjects selected, and the rule never reached .should(), so it asserts nothing.
Add .should() and a condition.
```

and for a predicate applied after `should()` — detectable as zero conditions with ≥1
predicate added after the fork:

```
<N> subjects selected, and the rule asserts nothing: <name> is a predicate, which filters
subjects rather than asserting anything about them. Move it before .should().
```

**The shipped `doctor` advice is already wrong for the main shape** and changes with this:
`src/core/diagnose.ts:99` and `docs/cli.md:117` both say _"add a `.should()` clause, or delete
it"_, and the shape that will fail has the `.should()`. The runtime message and the `doctor`
advice must be the same string from one place — two texts for one state is a trust problem for
an agent diffing them.

### 4. `describeRule()` on the three builders that lack it

Overridden only on `RuleBuilder` (`:124`). Slice, schema and resolver inherit
`TerminalBuilder`'s, which returns `rule: this._metadata?.id ?? 'unnamed'`. So the instrument
this plan tells people to measure with would report three findings all named `unnamed`. Each
of those builders already has a private `buildRuleDescription()`; expose it the way
`RuleBuilder` does.

### 5. Accumulate, not clear

Delete `fork._conditions = []` (`:278`).

|                                                | Failure mode                                                                   | Direction        |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| **Clear** (`RuleBuilder` today)                | An assertion the author wrote is discarded; the rule can reach zero conditions | **silent green** |
| **Accumulate** (slice, schema, resolver today) | A derived rule reports the held rule's finding as its own                      | **loud red**     |

Conditions AND together and violations union, so accumulate can only assert _more_. It cannot
produce a rule that asserts nothing; clear can, and does — it is how a rule reaches §1's state
without the author omitting anything.

**A third option was available and is rejected on the record:** `should()` on a builder that
already carries a condition could itself be a configuration finding ("you already asserted X —
use `.andShould()`"). It breaks nothing documented, costs no baseline churn, and produces no
misattribution. Rejected because it makes six entry points stricter than the other four for a
shape that is unambiguous in the reading — `.should().X().should().Y()` reads as both — and
because inventing a seventh behaviour where four builders already agree is the pattern plan
0069 spent three drafts removing.

**`.andShould()` stays canonical.** `docs/core-concepts.md:192` teaches it, and it is already
the no-op-returning-`this` that accumulate makes `.should()` equivalent to. Document a second
`.should()` as equivalent-but-discouraged; do not promote it to a taught form. Two spellings
for one semantic is how the `.severity()` / `.asSeverity()` confusion got made.

**Metadata juxtaposition, stated:** under accumulate the inherited condition's violations are
reported by the derived rule and stamped with the derived rule's `because` and `suggestion`
(`execute-rule.ts:132-139`), so a `notExist` violation can print the remedy for `beExported`.
`andShould()` already has this; bug 0021 is the same defect for config findings. One cause,
three symptoms, fixed once.

**What does not change:** the fluent form. `should()` on a builder with zero conditions makes
the clearing a no-op, so every ordinary chain is byte-identical.

## Releases

Two minors. `^0.21.0` does not admit `0.22.0`, so a minor is an opt-in upgrade and a patch is
a forced one — the argument already written into this project's v0.21.0 entry.

**0.22.0 — the instrument. Nothing fails.**

- `assertsSomething()` on the root and all six hooks; `describeRule()` on the three;
  corrected advice text in `diagnose.ts` and `docs/cli.md`; bug 0021.
- A CHANGELOG notice in the shape 0.20.0 used: _"Run `doctor` now to find out what the next
  release will cost you."_
- **Plus a pre-flight that works on the version the consumer already has**, because `doctor`
  cannot reach two documented authoring paths: `loadRuleFiles` collects only
  `export default [...]` (`src/cli/load-rules.ts:33-40`), so a rule inside a vitest `it()` body
  is invisible, and a self-executing rule file throws on import. A multiline-aware grep reaches
  both:

  ```
  \.should\(\)\s*\.(check|violations|warn|severity|asSeverity)\b
  ```

  Measured: **0 hits** across `docs/ examples/ src/ tests/ README.md` here, and it flags both
  the one-line and multi-line forms in a positive sample.

**0.23.0 — the flip.** The root gate fails, and 0020 lands with it. They ship together: 0019
alone leaves 0020 able to manufacture a one-condition rule where the author wrote two (which
does not trip 0019 — it asserts _something_), and 0020 alone leaves `.should()` with no
condition silent.

### Why two, not one

The instrument is wrong in **both** directions today, so one release would tell consumers to
measure with something that disagrees with what ships:

- **Under-reports.** `assertsSomething` is implemented once, and `diagnose.ts:176` is
  `rule.assertsSomething?.() === false` — a builder without the method is silently skipped, so
  slices, schemas and resolvers report clean.
- **Over-reports.** `diagnose()` never materializes subjects, while draft 1's runtime check sat
  after the empty-subject return — so `doctor` named rules the flip would not fail. §1 removes
  that disagreement by making the runtime gate subject-independent too. Two releases is still
  right, because a consumer needs a version where they can measure without being failed.
- **A self-executing rule file surfaces them one per CI run**, because the finding throws and
  aborts module evaluation. That is the hazard 0.20.0's CHANGELOG documented for `.warn()`; the
  pre-flight grep is the answer.

### Upgrading section for 0.23.0

Three audiences, because the change is not uniform:

1. **`RuleBuilder`'s six entry points** — silence → hard failure. Nobody has ever seen a signal.
2. **Slices, schemas, resolvers** — warning → hard failure. If `has no conditions` has been in
   your logs, it is now red. Much the softer story, and the one that will actually fire.
3. **`tsconfig()`** — a rule with no `.requires()` now fails.

And **regenerate your baseline**, for 0020 specifically. Identity hashes the rule
_description_, which is built from the condition list (`buildRuleDescription()` `:288`,
`hashViolation` `src/helpers/baseline.ts:95`). Measured:

```
held rule:        that have name matching /^parse/ should not exist
held hash:        681c3489b0a18e17
accumulated hash: 443abd1a3d216773
```

So baselined findings on a rule derived off a held rule resurface as new — and the same code
location is now reported **twice under two identities**, once by each rule, both needing
entries.

### The opt-out asymmetry, stated rather than left implicit

The empty-**selector** guard is opt-**in** (`.expectNonEmpty()`, `:117`) because an empty
selection is sometimes legitimate. This one is opt-out-**impossible**: `.warn()` throws,
`.excluding()` refuses out loud, diff and baseline skip it. A consumer who hits it has exactly
one path — change code.

That is deliberate and defensible: unlike an empty selector, a rule with subjects and no
assertion has no reading under which it is doing its job. But it is a real product decision and
it belongs in the plan and the docs, not in a one-clause premise. `.expectEmpty()` — the escape
hatch decided for the selector case in [the appendix](./0069-appendix-vacuous-tests.md) — is
**not** the hatch here: it asserts the selector matches nothing and fails if it ever matches
something, so pointing a 42-subject rule at it converts a silent pass into a wrong red. It also
does not exist in `src/`; draft 1 named it anyway, which is the `--rule` defect corrected in
v0.21.0, repeated in the plan written after that correction.

## Why this is not R3b

Plan 0069 assigns proposal 019 to R3b, gated on an adopting codebase's `doctor` pre-flight, and
states the criterion that separates R3a from R3b: R3a is where _"the blast radius is fully
measurable here"_; R3b is _"only these red on globs the adopting team wrote"_.

Measured in this repo:

| Change                               | Tests broken  |
| ------------------------------------ | ------------- |
| Zero-condition rule fails, root gate | **0 of 2363** |
| Accumulate instead of clear          | **1 of 2363** |

Neither reds on a glob. A condition-less rule is a property of the rule's own text — and under
§1's mechanism that is now true of the implementation, not only of the argument. So 019's
membership in R3b was a misclassification by 0069's own criterion, and that argument alone
carries the split.

**Draft 1's second argument is withdrawn.** It said the incomplete `assertsSomething` meant 019
belonged in R3a by `0069:343`, _and_ that this plan completes it. Both cannot hold: completing
it satisfies 0069's precondition and returns 019 to R3b by that same sentence. `0069:451` also
explicitly rejected "move 019 into R3a so its gate can see it". The no-glob-content argument
does not depend on a defect this plan repairs, and is sufficient.

The one test that breaks under 0020 is a guard added by bug 0016's own fix. Before that guard
existed the same change broke **0 of 2340** — the behaviour was invisible in both directions,
which is why this plan can state a number at all.

## Test inventory

Every case states its failing direction. A guard for "asserts nothing" that is satisfied by
failing everything is the defect this repo exists to prevent.

**0019 — must fail**

1. Each of the five states above **fails**, one test per state — including `tsconfig(p)` with no
   `.requires()`, and the empty-selector-plus-no-condition case draft 1's mechanism left silent.
2. **The control:** a rule with subjects and one real condition passes. Without it, "fail on
   zero conditions" is indistinguishable from "fail always".
3. Each remedy appears in the message for its own state and **only** for its own state. Assert
   the message text — three shapes sharing one message is the ADR-008 rule 2 failure this plan
   is partly about.
4. The finding is refused by `.excluding()` and by `.asSeverity('warn')`, and skipped by diff
   and baseline. R3a's machinery is already tested; this asserts the new finding inherits it.
5. A rule whose **selector** is empty _and_ which asserts nothing reports the selector finding
   **only**. Root cause, not a flood — falsifiable because §1 orders it explicitly.
6. Reflection over both entry points, in the shape of
   `tests/core/glob-declaration.test.ts:56-86`: two hand-written lists, `CAN_BE_ASSERTIONLESS`
   and `ASSERTION_IS_STRUCTURAL`, each with a per-builder reason, and a failure when a newly
   exported builder appears in neither. **Not** field reflection. Keep that file's
   `it('actually discovers the builders')` case: `[].filter()` is `[]`, which is exactly how
   this shape went green before.
7. `diagnose()` reports the condition-less rule for **all six** hooks, with a usable rule name
   rather than `unnamed` (§4), and does **not** report a rule the runtime would pass.

**0020 — must keep both**

8. `.should().X().should().Y()` reports the union, **discriminated by message** — both
   condition descriptions in the derived rule's findings, one in the held rule's. Not by
   element: two conditions over one selection iterate the same filtered set, so elements are
   identical by construction. Not by count: `notExist` gives 4 and `beExported` gives 0, so
   `toHaveLength(4)` is satisfied by a correct and a sabotaged `copy()` alike.
9. The two bug-0016 guards this retires are **replaced, not flipped** —
   `held-builder-is-immutable.test.ts:286` ("does not stack") and `:268`, whose sabotage
   (`fork()`'s copy sharing state) stops existing once `fork()` clears nothing. Each needs a
   condition pair where **both** contribute violations, asserted on messages.
10. The single-`should()` fluent form is unchanged: one rule's violations snapshotted before and
    after, on a non-empty set.
11. `.andShould()` and a second `.should()` produce identical findings — the equivalence the docs
    will now claim.

**Sabotage exit criterion.** Every guard fails with its production change reverted, and the
reverts are applied **one at a time**. Bug 0016's review found six sabotages caught by nothing
precisely because the guards had only ever been checked against a full revert. Report
caught-by-nothing as a number.

## Documentation

The last release changed 40 methods across 12 classes and shipped one substantive doc line.
Four pages are load-bearing here:

- **`docs/violation-reporting.md:52-58`** — "The one thing `.warn()` cannot silence" enumerates
  configuration findings. This adds a sixth kind, the one users will actually hit, and it must
  also state that there is no opt-out at all.
- **`docs/cli.md:117`** and **`src/core/diagnose.ts:99`** — the advice is the wrong remedy for
  the shape that will fail. One string, one place.
- **`docs/api-reference.md:491`** — _"Nothing here fails a build — it is the measuring
  instrument for a future release"_. After 0.23.0, half of what `doctor` reports does fail.
- **`docs/core-concepts.md:104-124`** — documents
  `entryPoint(p).that().<predicates>.should().<conditions>.check()` as a shape. It becomes an
  enforced contract. One sentence there is the highest-leverage doc change in the release.

## Out of scope

- **The glob flip and `emptyIsPass`.** Still R3b, still gated on the pre-flight. This plan hands
  R3b one constraint: `emptyIsPass`'s exemption is defined over a **set** of conditions, and
  accumulate widens the reachable mixed sets. `andShould()` already made them reachable, so this
  is widening rather than a new class — but the union rule is R3b's to settle.
- **Proposal 019's override-key ask** (`src/presets/shared.ts:91`) — a warning when an
  `overrides` key matches no rule. Genuinely one call site, and 019 calls it "the same fix", but
  a preset misconfiguration is not a false certification: the rules still run and still assert.
  It does not belong in a release about rules that assert nothing. **Follow-up, named here so
  absorbing 019 does not retire it silently.**
- **Collapsing `fork()` into `copy()`.** After the deletion `fork()` differs only in the
  `_reason` line. A refactor; this is a behaviour change.
- **Bug 0015** (`only*` conditions pass on edgeless subjects). Same vacuity family one layer
  down: the selector matches, the condition runs, and the condition itself is ∀ over an empty
  set. Not reachable by a condition **count**.
- **`_phase`'s other jobs.** It survives for dual-use dispatch (20 read sites) and `globs()`
  position stamping (`:155-186`). Only the gate stops using it; the message starts.

## Existing code survey

Done before drafting, per the review process, and re-verified for draft 2.

| Ask                                        | Status                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config finding that bypasses diff/baseline | **Exists.** `bypassFilters` on `ArchViolation` (`src/core/violation.ts:65`), honoured in `execute-rule.ts:51,115`.                                                   |
| Severity floor — cannot be downgraded      | **Exists.** `severityFor()` (`violation.ts:157`) returns `'error'` for any `bypassFilters` finding regardless of the fallback. Shipped in R3a.                       |
| The finding's shape                        | **Exists as precedent.** `emptySelectionViolation()` (`rule-builder.ts:338`) — copied, minus the metadata enrichment (bug 0021).                                     |
| `assertsSomething()` reporting hook        | **Exists, on one builder.** `DiagnosableRule.assertsSomething?` (`diagnose.ts:32`), consumed at `:176`, implemented only at `rule-builder.ts:206`. §1–2 complete it. |
| Classification-list reflection test        | **Exists as precedent.** `tests/core/glob-declaration.test.ts:56-86`, which classifies 16 exported builders with per-builder reasons. Item 6 copies that shape.      |
| Throwing on a missing assertion            | **Exists.** `correspondence()` already does it (`correspondence-builder.ts:197`). This plan gives the other five what one builder has had all along.                 |
| `.expectEmpty()`                           | **Does NOT exist** — a decision, not code. Draft 1 named it as a remedy; wrong twice over. See "The opt-out asymmetry".                                              |

Two facts checked because the flip depends on them:

- **No documented example is condition-less**, and stronger than draft 1 claimed: a
  multiline-aware scan across `docs/ examples/ src/ tests/ README.md` returns **0 hits**, so it
  holds for the `init` templates, the examples and the test suite too.
- **No preset generates a condition-less rule.** Not by construction — `collectRule`
  (`src/presets/shared.ts:36`) attaches metadata and severity to an already-complete rule — but
  measured, and `src/presets/layered.ts:44` guards the one shape that would.

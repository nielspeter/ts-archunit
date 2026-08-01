# Plan 0070 — a rule must assert something, and every assertion you write is kept

**State:** DONE — **0.22.0** shipped the instrument, **0.23.0** shipped the flip. Reviewed twice
as a plan, then twice more as code. Round 1 (architect + product) replaced the mechanism's
location; round 2 (five personas, mechanism implemented in throwaway worktrees, 28-revert
sabotage matrix) replaced the mechanism's **message contract** and its ordering. The
diagnosis and the state table survived every round unchanged.
**Priority:** Highest open item, ahead of R3b. Both defects are live in v0.21.0 and both are silent.
**Effort:** One root gate, one new advice hook, seven `assertsSomething()` hooks, two new
`RuleBuilder` fields, five deletions, `describeRule()` on six builders, and the guards.
Two releases. **See Implementation notes for what 0.22.0 actually shipped.**
**Closes:** [bug 0019](../../bugs/fixed/0019-a-rule-with-no-condition-passes-in-total-silence.md), [bug 0020](../../bugs/fixed/0020-should-twice-silently-drops-the-first-assertion.md).
**Splits from:** [plan 0069](./0069-no-rule-may-certify-nothing.md) R3b — see "Why this is not R3b".
**Absorbs:** [proposal 019](../../proposals/019-rules-that-enforce-nothing-must-fail.md) in full —
including its central ask, the **deletion** of the four `console.warn + return []` sites, which
draft 2 forgot — except the override-key ask (see Out of scope).
**Unblocked:** [bug 0021](../../bugs/fixed/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md)
shipped in v0.21.0. This plan's finding inherits that pattern; round 2 found three places where
draft 2 would have reintroduced the 0021 defect, all closed below.

All line references are as measured at `2f875b2` (v0.21.0) by round 2's reviewers; re-derive at
implementation time rather than trusting them across commits — two of draft 2's were stale
within one commit of being written.

## Corrections carried into draft 3

Round 2 implemented draft 2's mechanism in isolated worktrees and attacked it. What failed:

| Claimed in draft 2                                                              | Measured 2026-07-28/29                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The message branches on `_phase`; third state "detectable" from existing state  | **Undecidable.** `.should().areAsync()` and `.and().areAsync().should()` are byte-identical in every field the builder carries. And `_phase === 'predicate'` does not mean "`.should()` was never reached" — `.should().that().areAsync()` is a supported shape and lands there                                                                                                                                                 |
| The message "states the subject count"                                          | The root cannot compute it; state 2's count is taken **after** the misplaced predicate filtered (author's 4-subject selector reported as "0 subjects"); and at N=0 the count steers to the wrong fault. Dropped — see "The message carries no subject count"                                                                                                                                                                    |
| "0 of 2363" for the root gate                                                   | **3 of 2368** — and **2 of the 3 break in 0.22.0**, the release draft 2 said fails nothing. One of the three is `tests/config/tsconfig.test.ts:339`, a shipped test asserting the **opposite** contract for the tsconfig state                                                                                                                                                                                                  |
| "six hooks"; `SmellBuilder` "structural — no state in which it asserts nothing" | **Seven.** `smells.inconsistentSiblings(p)` with no `forPattern()` returns `[]` from `detect()` — selects subjects, asserts nothing, passes silently, invisible to `doctor`. The identical miss draft 1 made with `tsconfig()`, inside the list draft 2 certified                                                                                                                                                               |
| `CorrespondenceBuilder`: "the hook aligns it with the others"                   | **Dead at runtime.** `collectViolations()` throws `RangeError` before the gate runs; the error escapes `runCheck`'s `ArchRuleError`-only catch and **drops every remaining rule file**. The hook bought `doctor` visibility only                                                                                                                                                                                                |
| "Nothing new is built here"; `bypassFilters`-wins ordering                      | The ordering only functions when `.expectNonEmpty()` was opted in; the default dead-glob case got "add a condition" for a glob fault. Replaced by gate-first — see "Ordering"                                                                                                                                                                                                                                                   |
| Absorbs 019                                                                     | 019's Proposal section is one sentence — _replace_ the four warn sites — and draft 2 never deleted them: warn **and** throw, two remedies, one state. "One deletion" is five                                                                                                                                                                                                                                                    |
| Test items as specified                                                         | 28-revert sabotage matrix: **5 caught by nothing**, three of them the bug-0021 family (the new finding losing `suggestion`/`because`/`ruleId` — no test names the fourth producer). Item 6 survived the sabotage it exists for (both lists are prose; the load-bearing third case of the cited precedent was not cited). Item 7 unimplementable (**five** builders lack `describeRule()`, not three). Item 10 certifies nothing |
| "violations union"; "13 builders"; the accumulated hash `443abd1a3d216773`      | They **concatenate** (repeated condition → 8 findings, 4 duplicate hash pairs, pre-existing via `andShould()`); **15** exported `TerminalBuilder` subclasses plus one unexported; the hash reproduces nowhere — the real accumulated set is four distinct hashes. The conclusion (regenerate baselines) stands; the printed evidence was wrong                                                                                  |
| `_phase` "survives for `globs()` position stamping"                             | `globs()` never reads `_phase` — position comes from which list an entry is in. Only a docstring claims otherwise, and it is wrong                                                                                                                                                                                                                                                                                              |

Also cut: draft 2's "the pattern is consistent enough to name" sentence. Round 2's product
reviewer was right that it was rhetoric doing the work of a fix, and it was attached to a
mechanism carrying an unplaced hook.

## Problem

Two defects, one sentence apart. Both shipped, both silent, both found while deciding a design
question rather than by any test.

**A rule with subjects and no condition passes in total silence.** Measured against
`tests/fixtures/poc`:

```
functions(p).that().haveNameMatching(/^parse/).should()    // 4 subjects, 0 conditions
  .check() throws:  NO — passes
  warnings:         0 — SILENT
```

There is a guard for exactly this at `src/core/rule-builder.ts:387`, and it cannot fire for that
shape: it is gated on `_phase === 'predicate'`, and `should()` sets the phase to `'condition'`.

**`should()` twice discards the first assertion.**

```
.that().haveNameMatching(/^parse/).should().notExist().should().beExported()  ->  0 violations
  notExist   alone  ->  4 violations
  beExported alone  ->  0 violations
```

`fork()` clears `_conditions` (`:276-281`), and `should()` calls `fork()`.

They compose: the second produces the state the first fails to report.

## The states, and their remedies

The unit of enumeration is **states in which a rule asserts nothing**, not call sites. Measured,
on `tests/fixtures/poc` unless noted:

| #   | Shape                                      | Today                                        | Sanctioned fix                                              |
| --- | ------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------- |
| 1   | `.that().pred.should().check()`            | 0 warnings, no throw                         | Add a condition after `.should()`                           |
| 2   | `.that().pred.should().areAsync().check()` | **0 warnings**, no throw                     | `areAsync` is a **predicate** — move it before `.should()`  |
| 3   | `.that().pred.check()` (no `.should()`)    | 1 warning, no throw                          | Add `.should()` and a condition                             |
| 4   | `functions(p).check()` (bare)              | 1 warning, text claims "predicates"          | Delete the rule, or complete it                             |
| 5   | `tsconfig(p).check()` (no `.requires()`)   | 0 warnings, no throw                         | Add `.requires({...})`, or delete the rule                  |
| 6   | `smells.inconsistentSiblings(p).check()`   | 0 warnings, no throw                         | Add `.forPattern(...)`, or use `duplicateBodies`            |
| 7   | `correspondence(p).side(...).side(...)`    | throws raw `RangeError`, crashes the CLI run | Add `.beComplete()` / `.haveNoOrphans()` / `.beBijective()` |

State 6 is round 2's addition — `inconsistent-siblings.ts` opens `detect()` with
`if (!this._pattern) return []` — and it invalidates the claim that the smell branch is
structural. `duplicateBodies` genuinely is (it always compares pairwise); the classification
test (item 6) now has to prove that rather than record it.

A remedy exists that no shape implies and that the message must carry, because
`src/presets/layered.ts:44` proves a preset author can hit it: a config-driven rule yields zero
conditions when the configured list is empty, and the fix is _don't generate the rule_. The
finding carries the rule's `ruleId`, and preset ids are namespaced (`preset/...`), so the advice
can say "if this rule comes from a preset, report it to the preset's author" without guessing.

### Distinguishing the states needs two new fields, named here because they are mechanism

Round 2 proved states 1 and 2 are byte-identical in current state, and that `_phase` cannot
express "never reached `.should()`" (state 3/4) because `.should().that()` legally returns to
the predicate phase. So:

- **`_reachedShould: boolean`** — set true in `should()`, never reset. `false` → states 3/4.
- **`_misplaced: string[]`** — predicate descriptions pushed by `addPredicate()` when
  `_phase === 'condition'` (a predicate-only method used after `should()`; dual-use methods
  dispatch to conditions in that phase and never reach `addPredicate`). Non-empty → state 2,
  and the message names the predicate. `.should().that().areAsync()` deliberately does **not**
  register: the author explicitly returned to the predicate phase, and the state-1 remedy is
  correct for it.

Both are copied by `copy()` (`_reachedShould` via `shallowClone`; `_misplaced` needs a line in
`RuleBuilder.copy()`), and the existing structural guard
(`held-builder-is-immutable.test.ts` › "every in-place-mutated container field is copied")
catches a leaked `_misplaced` for free — verified by round 2's sabotage of exactly that.

`_phase` is not used by the gate or the message at all. It keeps its one real job, dual-use
dispatch (15 read sites; the "20" in draft 2 and the `globs()` dependency were both wrong).

## Mechanism

### 1. Gate first, on the root

```ts
// TerminalBuilder. Concrete, not abstract — both roots are public exports (the globs()
// argument). Public, not protected — diagnose() duck-types it through DiagnosableRule,
// and it is already shipped public on RuleBuilder.
assertsSomething(): boolean {
  return true
}

// Protected: the advice channel. One string per state, produced by the builder that
// knows its own states. diagnose() consumes it through DiagnosableRule, so the doctor
// advice and the failure message are the SAME string by construction — round 2 measured
// draft 2 shipping two diverging texts for one state. PUBLIC as shipped, not protected:
// a protected member cannot satisfy the structural interface diagnose() consumes.
assertionAdvice(): string {
  return 'this rule asserts nothing, so it can never fail. Add an assertion, or delete the rule.'
}

private collectWithAssertionGuard(): ArchViolation[] {
  if (!this.assertsSomething()) {
    return [this.noAssertionViolation()]   // built from describeRule() + assertionAdvice()
  }
  return this.collectViolations()
}
```

Called from `violations()`, `check()`, `warn()` — the three methods every consumption path
funnels through (round 2 verified: no subclass overrides them, no call site bypasses them).

**Gate-first, not root-cause-first.** Draft 2 ran the rule and let an existing `bypassFilters`
finding win. Round 2 broke that three ways: the ordering only functions when `.expectNonEmpty()`
was opted in; a rule that provably cannot fail still paid a full AST walk; and
`CorrespondenceBuilder.collectViolations()` **throws** before returning, so its hook was dead
and the `RangeError` escaped the CLI's `ArchRuleError`-only catch, dropping every remaining
rule file. Gate-first fixes all three: no walk, no throw, one finding. The cost is that a rule
with a dead glob _and_ no condition reports the missing assertion only — which is the right
sequencing: an assertion-less rule cannot fail regardless of its selector, and the selector
fault (if any) surfaces on the re-run after the first fix. Item 5 pins this ordering.

The correspondence `RangeError` for a missing assertion becomes unreachable and is deleted;
the sides-count `RangeError` is a different fault (arity, not assertion) and stays.

### 2. Seven hooks

| Builder                       | `assertsSomething()`                            | `assertionAdvice()` names                               |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `RuleBuilder`                 | `this._conditions.length > 0`                   | states 1/2/3-4 via `_reachedShould`/`_misplaced`        |
| `SliceRuleBuilder`            | `this._conditions.length > 0`                   | `beFreeOfCycles()` and friends                          |
| `SchemaRuleBuilder`           | `this._conditions.length > 0`                   | `haveFields()` and friends                              |
| `ResolverRuleBuilder`         | `this._conditions.length > 0`                   | `contain()` and friends                                 |
| `TsconfigBuilder`             | `Object.keys(this._requirements).length > 0`    | `.requires({...})`                                      |
| `CorrespondenceBuilder`       | `this._checkComplete \|\| this._checkNoOrphans` | `.beComplete()` / `.haveNoOrphans()` / `.beBijective()` |
| `InconsistentSiblingsBuilder` | `this._pattern !== undefined`                   | `.forPattern(...)`                                      |

Known accepted edge: `requires({ strictNullChecks: undefined })` passes the key-count while
comparing nothing. The hook is a key count, not an assertion count; noted, not solved.

`DuplicateBodiesBuilder`, `PairFinalBuilder` and the cross-layer chain are structural — and
that claim is now _proven_ by item 6's third case plus the item-1 behavioural cases, not
recorded in a prose list (round 2 showed the list-only version certifies whatever is written
in it).

### 3. The message carries no subject count

Draft 2's `<N> subjects selected...` is withdrawn, on three measurements: the root cannot
compute N; state 2's N was taken after the misplaced predicate filtered, reporting the author's
4-subject selector as `0 subjects`; and at genuine N=0 the count steered the reader toward a
remedy for the wrong fault. The finding is about the missing assertion, and its message says
exactly that, per state, from `assertionAdvice()`:

- state 1: `this rule reached .should() but no condition follows, so it asserts nothing and can never fail. Add a condition after .should() — or, if this rule is generated from configuration, skip generating it when there is nothing to assert; if it comes from a preset (ruleId "preset/..."), report it to the preset's author.`
- state 2: `this rule asserts nothing: "<predicate>" is a predicate, which filters subjects rather than asserting anything about them. Move it before .should(), then add a condition.`
- state 3/4: `this rule never reached .should(), so it asserts nothing. Add .should() and a condition, or delete the rule.`
- states 5-7: per the table above.

The selector question ("did this even match anything?") is deliberately not folded in — that is
the empty-selector guard's job (`.expectNonEmpty()` today, R3b's flip later), and it re-emerges
the moment the assertion exists.

Two adjacent texts change with this, or they contradict it:

- `src/core/diagnose.ts:102` and `docs/cli.md:117` — _"add a `.should()` clause, or delete
  it"_ is the wrong remedy for states 1 and 2 (the `.should()` is present). `diagnose()` now
  reads `assertionAdvice` through `DiagnosableRule`, so the strings cannot drift again.
- `src/core/execute-rule.ts:85-88` — the exclusion-refusal text hard-codes _"Fix the rule's
  selector instead"_, the empty-**selector** remedy, for every config finding. Round 2 named it
  the third 0021-family site. It becomes cause-neutral: _"fix the fault it names instead."_

Per [bug 0021](../../bugs/fixed/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md),
the finding sets its own `suggestion` (from `assertionAdvice()`), keeps `ruleId` and `because`,
and inherits nothing — and the test that enforces that for the three existing producers gains
this one as its **fourth** (round 2's sabotage matrix showed the finding could lose all three
fields with nothing failing).

### 4. `describeRule()` on the builders that lack it, with a fallback for the bare rule

`grep -rn describeRule src/` finds two definitions. Slice, schema and resolver expose their
private `buildRuleDescription()`; `TsconfigBuilder` returns its module-level
`RULE_DESCRIPTION`; `CorrespondenceBuilder` builds `correspondence [a <-> b]` from its sides.
`functions(p)` bare yields `''`, so the finding's name falls back the way
`emptySelectionViolation` already does (`buildRuleDescription() || ...`), naming the entry
point. Slice's description embeds ten file names; item 7 bounds the name rather than calling it
"usable".

This section is a prerequisite of §1, not a nicety: with the producer on the root,
`describeRule()` is its only naming channel, and without §4 three hooks report `unnamed`.

### 5. Accumulate, not clear — and the four warn sites are deleted

Delete `fork._conditions = []` (`:276-281`).

|                                                | Failure mode                                                                   | Direction        |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| **Clear** (`RuleBuilder` today)                | An assertion the author wrote is discarded; the rule can reach zero conditions | **silent green** |
| **Accumulate** (slice, schema, resolver today) | A derived rule reports the held rule's finding as its own                      | **loud red**     |

Conditions AND together and their violations **concatenate** (not "union" — a repeated
condition reports twice; see below). Accumulate cannot produce a rule that asserts nothing;
clear can, and does.

**The four `console.warn + return []` sites are deleted** — `rule-builder.ts:387`,
`slice-rule-builder.ts:234`, `schema-rule-builder.ts:183`, `resolver-rule-builder.ts:209`. This
is proposal 019's literal ask, and post-gate they are dead code for the state they warn about;
leaving them would emit warn **and** finding with two different remedies for one state.
`inconsistent-siblings.ts`'s `if (!this._pattern) return []` likewise becomes unreachable and
goes. Five deletions plus the `fork()` line.

**Duplicate conditions: deferred, with the reason measured.** `.should().notExist().should().notExist()`
under accumulate reports each violation twice with identical hashes — and `andShould()` with a
repeated condition **already does exactly this at v0.21.0** (8 findings, 4 duplicate hash
pairs). Accumulate inherits an existing property rather than creating one. No dedupe: deduping
conditions by description collapses distinct `defineCondition()`s that share a description (a
silent green), and deduping the report by hash hides genuine duplicates from other producers.
One sentence lands beside `.andShould()` in `docs/core-concepts.md`; item 11 guards the
equivalence including the repeated-condition case.

**`.andShould()` stays canonical.** The `.should()`-twice equivalence is documented in the
0.23.0 CHANGELOG entry — where the person asking "why do both my assertions run now?" will
look — and _not_ promoted to the taught surface (the `.severity()`/`.asSeverity()` lesson,
applied as round 2's customer refined it).

**What does not change:** the fluent form. `should()` on a zero-condition builder makes the
clearing a no-op, so every ordinary chain is byte-identical.

## Releases

Two minors. `^0.21.0` does not admit `0.22.0`, so a minor is opt-in — this project's own
recorded argument. **Before tagging either: add a `concurrency` group to `publish.yml`** — two
tags in quick succession with no group means `latest` lands on whichever publish finishes last.

### 0.22.0 — the instrument. The gate warns; nothing throws that didn't before.

- `assertsSomething()` on the root and all seven hooks; `assertionAdvice()`; `describeRule()`
  on the five; the two advice-text corrections; `_reachedShould`/`_misplaced`.
- ~~**The gate emits a runtime warning and then proceeds exactly as today.**~~ **Withdrawn — see Implementation notes.**
  This — not a grep — is the pre-flight, and it is the round-2 customer's design: it reaches
  every authoring shape _by construction_ (vitest `it()` bodies, self-executing files, loops,
  presets, builder #14), which no lexical tool does. Round 2 measured the draft-2 grep reaching
  **1 of 5 states and 3 of 15 realistic shapes**, with `git grep -E` silently reporting clean;
  it is demoted to a one-line hint for state 1, stated with per-platform commands
  (`git grep -nP` / `rg -U`) and with its coverage said plainly.
- `runDoctor` catches non-`ArchRuleError` failures per file instead of crashing on a vitest
  import (round 2 measured a raw `TypeError`); `format-github` omits `file=`/`line=` when
  `file === ''`, because `::error file=,line=0` is not a valid annotation and 0.23.0 makes
  these findings common.
- **This release fails two of this repo's own tests, and that is planned, not discovered:**
  `tests/core/diagnose.test.ts:218` (`toEqual(['dead-glob'])` gains `'no-condition'`) and
  `:309` (`toEqual([])` gains one). Both are updated **preserving their exact-identity form**
  — the cheapest green (`toContain`) would destroy the only guard on `base`, which is exactly
  the ADR-008 an-agent-resolves-it-cheaply hazard, so the plan says it out loud.
- A 0.22.0 Upgrading note (not just a notice): `diagnose()` reports more; `explain` output
  changes for the six builders gaining `describeRule()`; `doctor`'s exit code goes 1 on
  newly-visible states for anyone who wired it in despite the docs; stderr gains warnings that
  0.23.0 turns into failures. Baseline identity is untouched in 0.22.0 — `rule` comes from the
  condition context, not `describeRule()` (measured; recorded so nobody re-derives it).

### 0.23.0 — the flip. The gate is re-added as a finding; `fork()` stops clearing; `HASH_VERSION` bumps.

**Re-added, not flipped.** 0.22.0 shipped the hooks and withdrew the runtime gate entirely
(see Implementation notes), so 0.23.0 adds `collectWithAssertionGuard` back in its finding
form — gate-first, ahead of `collectViolations()`, for the three reasons §1 gives — and this
time it needs none of the withdrawn machinery: no latch, no channel, no name special-case. The
finding is an `ArchViolation` with `bypassFilters`, so it reaches the formatter, the JSON
payload, the annotation surface, the exit code, diff and baseline through code that already
exists and is already tested. That is the whole reason the withdrawal was worth its cost.

0019 and 0020 ship together: 0019 alone leaves 0020 able to manufacture a one-condition rule
where the author wrote two (which does not trip 0019); 0020 alone leaves `.should()` with no
condition silent.

**`HASH_VERSION` 2 → 3.** Accumulate changes `buildRuleDescription()` for rules derived off a
held rule, so their baseline hashes change. Without the bump, `matched === 0` fires the
unmatched-baseline finding whose text asserts _"generated against a different repository
root"_ — a false cause, in the release about findings that assert false causes. With it, the
version-mismatch branch is true and its remedy (regenerate) is the right one. (Draft 2 printed
a specific before/after hash pair as evidence; the "after" hash reproduces nowhere — the claim
stands on the description change itself, which is measured.)

> **WITHDRAWN at implementation, and the reasoning above is wrong in its load-bearing clause.**
> Two independent reviews of the 0.23.0 branch measured it: `hashViolation()` never reads
> `HASH_VERSION` (`baseline.ts` — the hash is `sha256(rule::element::message)`), so the bump
> changes no hash and no entry matches differently. Every clause that followed from "without
> the bump, `matched === 0` fires" is therefore false: the description change makes a **partial**
> miss, and `unmatchedBaselineFinding` is gated on `matched === 0`, so it stays silent either
> way. Worse, the bump makes the version-mismatch branch fire for every pre-0.23.0 baseline
> that matches nothing for an unrelated reason, naming the format as "the likely cause" when
> the format cannot be a cause — and burying the root-mismatch branch that usually is.
>
> The paragraph was written from the same understanding as the code, which is why it read as
> justified: this is ADR-008 rule 5 in the plan's own prose, and the thing that disagreed with
> it was reading `hashViolation()`. `HASH_VERSION` stays at **2**. The real consequence —
> descriptions change, so those entries must be re-accepted — is disclosed in the CHANGELOG
> as a content change rather than a format change. See [bug 0027](../../bugs/fixed/0027-an-unmatched-baseline-entry-cannot-be-diagnosed.md)
> for the diagnosis gap this leaves open, which is the fix the bump was reaching for and did
> not achieve.

**Blast radius, re-measured against shipped 0.22.0 (2394 tests, 2026-07-29).** The earlier
table said the gate breaks 1; it breaks **6**, and only two of the six were in it. Each
disposition below is a decision, and the five reversals belong in the CHANGELOG as reversals
rather than as quiet edits — the discipline the tsconfig row already established:

| Test                                                                                    | Kind                  | Disposition                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/tsconfig.test.ts` — "an empty spec produces no violations"                      | **policy reversal**   | Someone pinned the assertion-less state as correct. Retire it, and say so                                                                                                           |
| `smells/inconsistent-siblings.test.ts` — "returns no violations when no pattern is set" | **policy reversal**   | Same shape, second builder. The row the 0.22.0 review predicted                                                                                                                     |
| `builders/correspondence-builder.test.ts` — "throws when no assertion is chosen"        | planned               | The `RangeError` becomes the finding. Assert the finding, not the throw                                                                                                             |
| `core/assertion-gate.test.ts` ×2 — the two 0.22.0 CONTROLs                              | by design             | They pin "nothing throws" and "zero-condition rules report no violations" — i.e. 0.22.0's contract. Both must invert, and their comments should say the release that made them true |
| `core/rule-builder.test.ts` — `.expectNonEmpty()` bypass-flagged finding                | **the ordering call** | See below. This is item 5's collision arriving in a shipped test                                                                                                                    |
| `core/held-builder-is-immutable.test.ts:286`                                            | accumulate            | Replaced (with `:268`) per items 9/10; the naive flip is satisfied by a sabotaged `copy()`                                                                                          |

**The `.expectNonEmpty()` collision, decided.** That test builds a rule with
`.expectNonEmpty()` and **no condition**, then asserts the _selector_ finding. Under gate-first
the assertion-less finding wins and the message stops matching. Item 5 predicted exactly this
and the decision stands: an assertion-less rule cannot fail whatever its selector does, so the
missing assertion is the root cause, and the selector fault resurfaces on the next run once a
condition exists. The cost, stated: `.expectNonEmpty()` on a rule with no condition stops being
the thing that reports. Rewrite that test to carry a condition — which is what any real
`.expectNonEmpty()` rule has — and add its no-condition twin as an ordering pin.

### Upgrading — 0.23.0

**One audience, not three, and it is silence → failure for all of them.** The earlier draft
split by "did you see a warning before?" — that split is gone, because 0.22.0 ships no warning.
Nobody has ever had a runtime signal for any of the seven states. What every consumer does have
is a diagnostic they can run on 0.22.0 before upgrading, and the note must say so in the first
line rather than the fourth.

The instrument sequence, named: upgrade to 0.22.0 → run `npx ts-archunit doctor <rule files>`,
or `diagnose(rules)` for rules written inside a test body → fix everything it names (every
remedy is backward-compatible on 0.22.0, so this whole step lands green) → upgrade to 0.23.0 →
**regenerate the baseline** (the same-line-reported-twice note from the
`should()`-twice shape included). Every remedy is backward-compatible under 0.22.0, so the
sequence has no red step.

There is **no opt-out**, stated as the deliberate decision it is: `.warn()` throws,
`.excluding()` refuses (with the corrected, cause-neutral text), diff and baseline skip it. The
empty-selector guard is opt-in because empty is sometimes legitimate; a rule with subjects and
no assertion has no reading under which it is doing its job. `.expectEmpty()` is not the hatch
here and does not exist in `src/`.

## Why this is not R3b

The lead argument, per round 2's product review, is no longer the test count: **the fault is
decidable from the rule's own text with no filesystem** — under this mechanism that is a
property of the implementation, not just the argument — **so a consumer measures their exact
blast radius on 0.22.0 before 0.23.0 flips it.** R3b's criterion ("reds on globs the adopting
team wrote") never applied to proposal 019; `0069:451` rejected moving 019 for a different
reason (routing around a broken gate), which does not bear on this. The in-repo numbers
(3 + 1 + 1 of 2368, dispositions above) are the secondary evidence, and this draft's are
measured against this draft's mechanism — draft 2 reprinted draft 1's number under a new
design, which round 2 caught.

## Test inventory

Every case states its failing direction. The exit criterion is at the bottom, and round 2 ran
it against draft 2's inventory: 5 of 28 reverts survived everything. Those five are items now.

**0019 — must fail**

1. **Each of the seven states fails at `.check()`**, one test per state, on non-empty inputs —
   including slice/schema/resolver runtime cases (draft 2 reached those builders only through
   `diagnose()`, and its own Upgrading section called them "the one that will actually fire"),
   the tsconfig state, the inconsistentSiblings state, and correspondence (which must now fail
   with a finding, not crash with a `RangeError` — assert the error type).
2. **The control:** a rule with subjects and one real condition passes — with its own vacuity
   anchor, `expect(sel().subjects()).toHaveLength(4)`, so the control is not satisfied by an
   empty fixture.
3. **Each state's message contains its own remedy and no other state's** — asserted on message
   text, including state 2 naming the misplaced predicate (`"are async" is a predicate`), and
   state 2 arising from a 4-subject selector so a resurrected count claim would be caught.
   3b. **Each remedy actually remediates** — [ADR-008](../../adr/008-agent-first-failure-surfaces.md)
   rule 2's behavioural corollary, which is new since draft 3 and is the guard this plan most
   needs. For every one of the seven states: apply the fix the message states, and assert the
   finding **clears**. A contains-assertion and the message are written from the same
   understanding and agree even when it is wrong — bug 0017 is a remedy that reads perfectly and
   reproduces the violation it claims to fix, and bug 0021 is a remedy that could not apply at
   all. Both were rated High. These seven are mechanical (`add a condition`, `move the predicate
before .should()`, `add .requires({...})`, `add .forPattern(...)`, `add .beComplete()`, `add
the missing .side(...)`, `add .should()` + a condition), so there is no excuse for any of them
   being unverified. This is also the pin that would have caught the correspondence arity remedy
   naming an assertion, which shipped in 0.22.0 and was found by review rather than by a test.
4. **Through the machinery, not the flag:** the finding survives a `withBaseline` replay built
   from its own hash; `.warn()` throws (round 2: unwiring `warn()` was caught by nothing);
   `.asSeverity('warn')` still reports `error`; diff mode keeps it; `.excluding()` refuses
   **with the cause-neutral text** (assert the refusal message — the old text asserted the
   selector remedy for every cause).
5. **Gate-first ordering:** `.expectNonEmpty()` + dead glob + no condition reports the
   no-assertion finding **only** — and the same rule with a condition reports the selector
   finding, so the ordering is pinned from both sides. (Without `.expectNonEmpty()` there is no
   selector finding to order against; that is item 1's state, stated here so nobody writes the
   vacuous version — round 2 caught draft 1 and draft 2 each mis-specifying this item.)
6. **Classification, all three cases of the precedent** (`glob-declaration.test.ts:56-134`,
   not `:56-86` — the third case is the load-bearing one): the two lists with per-builder
   reasons; discovery (a new export must land in one); and **"every `CAN_BE_ASSERTIONLESS`
   entry overrides `assertsSomething` on its own prototype"** — the case that fails when a hook
   is deleted, which draft 2's version survived. `PairFinalBuilder` is not exported and is
   covered behaviourally, with the same recorded caveat the glob file uses. Known residual,
   stated: a _wrong_ `ASSERTION_IS_STRUCTURAL` entry is caught only by item 1's behavioural
   cases, and the inherit-`true` default makes a new builder exempt by default — the opposite
   polarity from `globs()`'s empty default, worth knowing when reviewing a new builder.
7. **`diagnose()` parity:** reports the condition-less rule for all seven hooks; its `advice`
   is **`toBe`-equal to the runtime message** (round 2 measured them diverging, and no item
   compared them); names are bounded (`not.toContain('.ts,')`) rather than "usable"; and a rule
   that asserts something produces no finding.
8. **The new finding is the fourth producer** in
   `tests/core/config-findings-carry-their-own-remedy.test.ts`: carries its own `suggestion`,
   keeps `because` and `ruleId`, inherits nothing — the three sabotages round 2 found caught by
   nothing.

**0020 — must keep both**

9. `.should().notExist().should().beAsync()` (both conditions produce violations on the poc
   fixture — round 2 verified `beAsync` yields 4 with distinguishable messages, where draft 2's
   `beExported` yields 0): the derived rule's findings contain **both** condition texts, the
   held rule's exactly one, asserted as kind-lists. Discriminates correct (8/4) from
   reverted-to-clear (4/4, wrong kind) from `copy()`-sharing (8/8).
10. The two retired bug-0016 guards (`:286`, `:268`) are **replaced** by item 9's form, not
    flipped — the naive flip is satisfied by a sabotaged `copy()`, and `:268`'s sabotage stops
    existing once `fork()` clears nothing.
11. `.andShould()` and a second `.should()` produce identical findings, **including the
    repeated-condition case** (both yield the same doubled report), pinning the equivalence the
    CHANGELOG claims. Draft 2's item 10 (single-`should()` snapshot) is folded into item 9's
    held-rule assertion as an exact element list; as a standalone item it certified nothing.
12. **The hierarchies are pinned to one semantics, not to each other:** the same
    two-assertions-off-one-held-rule shape asserted on `SliceRuleBuilder` (which accumulates by
    never having had a `fork()`), from the same fixture expectations as item 9.

**Sabotage exit criterion.** Enumerate every one-at-a-time revert of this plan's production
changes — round 2's enumeration of draft 2 found 28; this draft adds the advice hook, the two
fields, the five deletions and the ordering, so re-derive the list — run each against the full
suite plus this inventory, and report **caught-by-nothing as a number, which must be 0**.

## Documentation

- `docs/violation-reporting.md:52-58` — the unsilenceable list gains this finding; state the
  no-opt-out decision.
- `docs/cli.md:117` + `src/core/diagnose.ts:102` — replaced by `assertionAdvice()` (one string,
  one place, now enforced by item 7 rather than by intention).
- `docs/api-reference.md:493` — "Nothing here fails a build" becomes false at 0.23.0.
- `docs/core-concepts.md:104-124` — the grammar becomes an enforced contract (one sentence);
  `:192` gains the repeated-condition sentence beside `.andShould()`.
- `docs/troubleshooting.md:17` — "A rule I added isn't firing" is the page this symptom lands
  on, and its current answer is unrelated; add the state table's remedies. `:83`'s "warnings
  never fail CI" gains the config-finding exception.
- `docs/running-in-tests.md` — the 0.22.0 warn is this audience's pre-flight; say so, plus the
  `checkAll`-vs-per-rule note.
- `docs/config-rules.md` — a bare `tsconfig(p)` is now invalid; say it where the builder is
  taught.
- The shipped TSDoc on `should()` (_"empty conditions"_) and on `fork()` — both become false in
  every editor hover; they change with the code, in the same commit.

## Implementation notes — 0.22.0, as implemented

Reviewed twice as code after being reviewed twice as a plan. The second code review
withdrew a mechanism this plan had specified, so read this section in preference to
§Releases above where they disagree.

**The runtime warning is withdrawn.** Draft 3's 0.22.0 emitted `assertionAdvice()` as a
warning at every terminal. Shipped that way, it was measured to be invisible under
vitest's default reporter (which drops intercepted console output from passing tests, and
this release fails nothing by design), so it was changed to a direct `process.stderr`
write — and that channel then produced, in one round: an EPIPE crash where `console.warn`
had swallowed it, a once-per-instance latch that silenced a _derived_ rule in a
_different_ assertion-less state, a name that dropped the rule id its own remedy tells
the reader to look up, a `describeRule()` override that stripped the condition out of
`explain --format agent` for every id-less slice rule, and no coverage at all in
`check --format json` — the channel the library's own agent preamble tells agents to read.

Five defects at five seams, all of them seams the library already has working code for.
The warn path was bespoke: it bypassed the formatter, the JSON payload, the annotation
surface and the exit code. So 0.22.0 ships **the instrument without the channel** —
`assertsSomething()`, `assertionAdvice()`, `describeRule()`, and `diagnose()`/`doctor`
parity — and 0.23.0's gate produces an `ArchViolation`, which reaches all four surfaces
by construction and needs none of the withdrawn machinery.

The consumer cost is stated rather than hidden: a rule written inside a test body has no
zero-effort pre-flight, because `doctor` cannot load a file that imports a test runner.
Those consumers call `diagnose([...])` directly, which `docs/running-in-tests.md` now
shows. That is weaker than an automatic warning and stronger than a warning nobody sees.

**Other deviations from draft 3, all forced and all measured:**

- `assertionAdvice()` is **public**, not the drafted `protected` — a protected member
  cannot satisfy the structural `DiagnosableRule` interface `diagnose()` consumes. §1's
  own text was internally contradictory on this point.
- The four `console.warn + return []` deletions moved from 0.23.0 into 0.22.0. With the
  advice channel in place, keeping them meant two texts for one state.
- `describeRule()` landed on **six** builders, not five: `InconsistentSiblingsBuilder`
  (this plan's own late-added seventh hook) had missed the naming pass. Slice and smell
  names stayed semantic rather than becoming call-site locators, because `explain` reads
  the same field.
- `diagnose()` falls back to `TerminalBuilder.prototype.assertionAdvice` rather than a
  duplicated literal — an interim revision hard-coded the generic text a second time, in
  the mechanism whose whole purpose is one string in one place.
- `CorrespondenceBuilder.assertionAdvice()` branches on side count: with fewer than two
  sides the fix is another `.side(...)`, and naming an assertion would be a remedy that
  cannot apply.
- `format-github` escapes `,` and `:` in **both** property values (`file=` and `title=`),
  per the workflow-command spec — verified against `@actions/core`'s `escapeProperty` and
  `actions/runner`'s `UnescapeProperty`.
- `doctor` reports load failures as **identities** (`loadFailures: [{ file, error }]`),
  not a boolean, and emits its JSON document on every exit path.

**Deferred to 0.23.0, recorded so its implementer does not assume they shipped:**
`execute-rule.ts`'s exclusion-refusal text still says "Fix the rule's selector instead" —
it becomes cause-neutral at 0.23.0, where inventory item 4 pins it. The correspondence
missing-assertion `RangeError` → finding conversion is 0.23.0. `inconsistent-siblings`'
`if (!this._pattern) return []` stays until the flip. `tests/smells/inconsistent-siblings.test.ts`
› "returns no violations when no pattern is set" pins a state the flip inverts — one more
in-repo break than §Releases' table lists. And `--format github`'s ten-annotations-per-step
cap becomes relevant when config findings are common: a 35-finding run renders ten and
silently drops the rest from the annotation surface.

**Also outstanding, filed separately:** `executeWarn` still uses `console.warn`
(five sites), so `.warn()` inside a vitest test is invisible for the same reason the gate's
warning was — pre-existing, out of this plan's scope, and now documented rather than left
to be rediscovered.

**Sabotage-matrix history, because the number moved twice.** The 0.22.0 branch first
reported caught-by-nothing 0 of 8; a review enumerated the surface properly and measured
**11 caught by nothing**. Those eleven were pinned and re-measured at 0 — and a second
review then derived **65** reverts from the diff and found **9** still uncaught, six of
them behavioural. The lesson, for 0.23.0's matrix: enumerate from the diff, verify each
patch applies non-trivially, and read the verdict from the exit code — a `grep` over
reporter output was itself the source of one false "all caught" pass.

## Documents amended on merge## Documents amended on merge

Round 2 found five stale cross-references draft 2 would have left. On merge, in the same PR:

- `plans/0069-no-rule-may-certify-nothing.md:3` (0019/0020 are no longer R3b preconditions —
  this plan closes them), `:5` (019 is absorbed here, not there), `:339` (R3b loses proposal
  019), `:343` (spent sentence, marked resolved).
- `plans/ROADMAP.md`: the open-plans count and table gain 0070; 0019/0020 rows point here;
  `:76-83`'s "All four are still there" becomes "deleted by 0070"; the Releases table gains
  0.22.0/0.23.0 rows when tagged.
- `bugs/0019` / `bugs/0020` move to `bugs/fixed/` with the `**Fixed:**` header and the link
  depth fixed — the 0016 filing established the checklist.

## Out of scope

- **The glob flip and `emptyIsPass`** — still R3b, still gated. R3b inherits one constraint
  (the exemption is defined over a condition _set_; accumulate widens reachable sets) and one
  correction (its 019 half is gone; `0069`'s R3b section shrinks to the glob guard and
  `emptyIsPass`).
- **Proposal 019's override-key ask** (`src/presets/shared.ts:91`) — a preset misconfiguration
  is not a false certification. Follow-up, named so absorbing 019 does not retire it silently.
- **Dropping assertion-less builders in `collectRule()`** — rejected: silently skipping a
  preset rule is a false green that hides the preset author's bug; the finding names the rule
  instead.
- **Collapsing `fork()` into `copy()`** — after the deletion `fork()` differs only in the
  `_reason` line. A refactor, not this behaviour change.
- **Bug 0015** — same vacuity family, one layer down (∀ over an empty edge set); not reachable
  by any condition count.
- **`doctor` promotion** — it stays experimental/hidden; 0.22.0 fixes its crash and its advice,
  but the sanctioned pre-flight is the warn, not the hidden command.

## Existing code survey (delta for draft 3)

Unchanged rows from draft 2 remain verified (`bypassFilters`, `severityFor`, the finding shape,
the classification-test precedent, `correspondence()`'s throw, `.expectEmpty()`'s
non-existence). New in this draft:

| Ask                            | Status                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertionAdvice()` hook       | **Genuinely new.** `DiagnosableRule` carries one bit today (`diagnose.ts:32`); round 2 proved a bool cannot serve seven states and one string |
| `_reachedShould`, `_misplaced` | **Genuinely new.** Round 2 proved states 1/2 and 3/4-vs-`.should().that()` are undecidable from existing state                                |
| Gate-first ordering            | Replaces draft 2's `bypassFilters`-wins, which round 2 showed only functioned for opted-in rules and was dead for the one builder that throws |
| Warn-as-instrument (0.22.0)    | The four warn sites prove the channel exists; the gate's warn replaces them from one site with one string                                     |

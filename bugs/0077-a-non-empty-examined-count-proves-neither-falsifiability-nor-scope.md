# Bug 0077: a non-empty examined count proves neither falsifiability nor the intended scope

**Reported:** 2026-08-09 · **Fixed:** not yet
**Found in:** pointing the shipped families at this repository for the first time
(`tests/archunit/dogfood.test.ts`). Both cases were found by writing rules that passed, then asking
ADR-008 rule 5's question of them.
**Severity:** **High, and it is about the standard rather than the code.** Nothing here is a defect in
a shipped rule. Two rules satisfied [ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md)
**completely** — every part of the Decision, the floor, the vacuity matrix, the compiler — and were
still worth nothing. ADR-009 is `Proposed`; this is the argument that its four parts, read alone,
imply more than they establish.

## Why this is filed as a bug rather than an ADR edit

An ADR records a decision. These are two measurements that a future revision has to answer, and
whoever ratifies ADR-009 should decide what to do about them rather than inherit an amendment written
by the person who tripped over them. Filed so the finding is not lost between now and ratification.

---

## A. Examined is not falsifiable

ADR-009's standard is _"a non-empty set of examined units, counted at the family's own examining
seam"_. That establishes a family **looked** at units. It does not establish that any state of those
units could have produced a finding.

Measured:

```ts
smells.inconsistentSiblings(p).inFolder('**/src/builders/**').forPattern(call('this.copy'))
// examined: 11   violations: 0
```

(Corrected 2026-08-12, during plan 0102's implementation: the call sites are `this.copy()`, and `call()`
does exact-text matching, so the original bare `call('copy')` matched zero of them — a `matching === 0`
dead-pattern reading, not the `matching: 4` no-majority reading this section describes. The "cannot fail"
conclusion holds either way; the mechanism it holds for does not. `grep` confirms which files mention
`copy(` as text; it does not confirm what the AST matcher matches, which is the gap that produced the
original claim.)

Eleven files examined — every file in the folder — and the rule **cannot fail**. `inconsistentSiblings`
reports a _minority diverging from its siblings_ ("5 of 7 files use call to X"), and only 4 of the 11
builders hold the pattern, so there is no majority for anyone to diverge from. No edit to that corpus
short of rewriting seven builders produces a finding.

Every mechanical guard is green on this rule:

| Guard              | Verdict                                            |
| ------------------ | -------------------------------------------------- |
| The floor (0099)   | passes — `examined` is 11, not 0                   |
| The vacuity matrix | passes — the cell reports a finding when it should |
| The compiler       | passes — evidence is present and correctly sited   |
| `diagnose()`       | silent — no dead glob, the glob matches 11 files   |

ADR-008 rule 5's question — _what would this do if the thing it guards were broken_ — answers "pass".
That is the sentence ADR-008 opens with, surviving ADR-009's mechanical test intact.

**Why it probably cannot be mechanised.** Falsifiability is a property of the interaction between a
condition's semantics and a specific corpus, not of a seam. The type system sees seams. So the
plausible answer is review-enforced residue, in the same class as the user-written `Condition` that
part 1 already names: when a rule is added, ask which corpus edit turns it red, and if the answer is
"none", the rule is decoration however healthy its count.

That is a claim, not a decision — someone should check whether a cheaper mechanical proxy exists
before accepting it. One candidate worth testing: a rule is falsifiable if some single-element
perturbation of its examined set changes its verdict, which is expensive but not obviously impossible
for the smell families.

---

## B. Examined is not the intended corpus

Evidence counts units. It carries no claim about **which** units — and a large, healthy count is
exactly what a misdirected scope produces.

Measured: all four preset rows in the dogfood suite were written with `include: '**/src/**'`. Preset
includes match the **absolute** path, so that glob matched `tests/fixtures/*/src/**`. The rows were
grading deliberately-bad fixtures, and reported

```
preset/recommended/no-eval :: src/dangerous.ts:1 :: runEval contains call to 'eval'
preset/recommended/no-function-constructor :: src/security-class.ts:11 :: … new 'Function'
```

which read exactly like findings about our own source, and were reported as such until the paths were
looked at. Correctly scoped to this repository's `src/`, those seven findings disappear entirely.

This is a dead glob's failure mode with none of a dead glob's symptoms, and **it is invisible to every
guard we have precisely because the count is high**:

| Guard              | Verdict                                  |
| ------------------ | ---------------------------------------- |
| The floor (0099)   | passes — a large non-zero examined count |
| `diagnose()`       | silent — the glob is emphatically alive  |
| The vacuity matrix | passes — rules construct and report      |

`RecommendedOptions.include` documents the hazard in prose ("an ancestor directory named `src` widens
scope"). [Bug 0075](./0075-agentguardrails-copy-paste-rule-ignores-src.md) is the same shape inside a
preset — a rule reading a wider tree than the caller's `src` option names. This bug is the general
case: **prose is the only thing standing between a user and a rule that grades the wrong tree.**

**Fix direction, not chosen.** A mechanical answer needs the rule to state the tree it intends and the
evidence to be checked against it — e.g. an optional project-root anchor, with the examined set
asserted to fall inside it. That is a real API decision and it belongs in a plan. Deliberately not
proposed here: inventing a mechanism from the one instance that bit us is how the four waves in
ADR-009's Context table each closed an enumeration and missed the next family.

---

## What this does not claim

Neither case is an argument against ADR-009. The floor closed a real class and closed it well; bug
0066's 401-findings-reported-as-clean is not reachable any more. The claim is narrower: a non-empty
examined count is **necessary and not sufficient**, and the four parts read, alone, as though it
settled the question. Ratification should say which of A and B is mechanised, which is review-enforced
residue, and which is accepted as out of scope.

## Guard

Whatever is decided, the guard for A already exists as a worked example and should stay: the
`inconsistentSiblings` row in `tests/archunit/dogfood.test.ts` carries the whole story in its comment
— the `call('copy')` version that examined 11 and could not fail, and the `validateOverrides` version
that replaced it, which a one-line deletion from any preset turns red (sabotage: CAUGHT).

## Resolution (2026-08-12)

**A is review-enforced residue, and ADR-009 already says so — it was not a gap in the ADR, it was a gap
in reading the ADR's own Notes section against this bug.** `adr/009-a-pass-is-constructed-from-evidence.md`'s
Notes name three honest limits explicitly: **Adequacy** ("a check can examine 500 subjects and still
assert nothing worth knowing; ADR-008's rules own that"), **Provenance** ("evidence wired from the wrong
layer... lives between them, and only review catches it, family by family"), and **User conditions** (a
`defineCondition` body that internally skips every subject is invisible to a seam that counts what was
handed to it). Part A of this bug **is** Adequacy — restated with a measured worked example rather than
argued in the abstract. Part B **is** Provenance — restated with a measured worked example too (the
`include: '**/src/**'` absolute-path collision). Both were already scoped out of ADR-009's unrepresentable-vacuity
floor, on the day the ADR was drafted, for the reason this bug's own "Why it probably cannot be
mechanised" section re-derives independently: falsifiability and intended-scope are properties of the
interaction between a condition's semantics and a specific corpus, which the type system cannot see and
a structural seam cannot audit for every family in advance.

**Recommendation: ratify ADR-009 (Proposed → Accepted).** Its own stated gate — "goes to Accepted on
0095's measurement" (`plans/ROADMAP.md`) — has been satisfied since 0095 shipped; the status line is
stale, not blocked. Ratifying should add one line to the Notes section citing this bug by number next to
Adequacy and Provenance, so a future reader finds the measured instance next to the limit it measures,
rather than rediscovering the same gap a third time. **Not done unilaterally here** — an ADR is binding
project policy (`CLAUDE.md`), so the status flip is left for the user to confirm rather than executed as
a side effect of closing this bug.

**A's "cheaper mechanical proxy" candidate (single-element perturbation of the examined set changes the
verdict) — considered and declined, not adopted.** It only ever answers the question for the ONE corpus
state under test, not the corpus the rule will actually run against next; it requires re-evaluating the
condition N times per rule (N = examined-set size) on every `check()`, which is the kind of per-run cost
this project's own performance-sensitive families (ADR-008 rule 6, "an internal check over a corpus we
control") have consistently declined to pay for a signal that is itself only a local approximation, not a
proof. Recorded as declined rather than silently dropped, matching this project's convention for
rejected alternatives (see e.g. plan 0103's rejected LCS-augmentation options).

**A is partly mechanised already, and that is consistent, not contradictory.** [Plan 0102](../plans/0102-a-detector-that-cannot-fire-says-so.md)
ships a cheap, family-specific falsifiability check for exactly the measured instance this bug's Part A
used as its worked example (`inconsistentSiblings`'s majority-threshold arithmetic) — proving a cheap
proxy CAN exist for a specific family's specific shape, while the general case (arbitrary
`defineCondition` bodies, arbitrary predicates) still cannot be audited structurally. "Review-enforced
residue in general, mechanised per-family where a cheap proxy is found" is the honest state, not
"review-enforced, full stop" — and it matches how ADR-009 itself was built (wave by wave, family by
family, per its own Context table).

**B needs a plan, not a decision made here.** The "project-root anchor" sketch above is a real, new,
generic API surface (every family's `include`/`inFolder`/discovery glob would need to state and be
checked against an intended root) — exactly the shape this project's `review-proposal` skill exists to
survey before a plan is drafted, and inventing the mechanism from this one bug's instance is the same
narrow-enumeration mistake ADR-009's own Context table names four times over. **Not filed as a plan in
this pass** — recommend a proposal survey first (does `within()`, `assignedFrom()`, or any existing
project-root resolution already give this for free? `src/core/identity-root.ts` resolves a root today for
baseline portability and may be the seam to extend rather than a new one to invent) before committing to
the sketch verbatim.

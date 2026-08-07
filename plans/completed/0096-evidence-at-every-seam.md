# Plan 0096 — evidence at every seam, and the preview that reads it

**Status:** **DONE 2026-08-07.** Amended 2026-08-07 after a five-persona review of a first attempt (branch
`feat/0096-evidence-at-every-seam`, one WIP commit, no PR). The amendment is structural, not a fix list:
the first attempt built evidence as a **second derivation** parallel to the one 0098 will create, and
that drift is already measurable inside its single commit. Rework against this text, do not patch that
branch. Filed 2026-08-07, split out of plan 0095's Phase 1.
**Depends on:** [0095](./0095-the-vacuity-matrix-and-the-conformance-audit.md) — its truth table names
which families need wiring, and the matrix is what independently checks this plan's work.
**Priority:** High. It is the diagnostic-first half of the migration
[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 1's corollary requires: the release that
previews the flip has to ship before the release that flips.
**Effort:** Medium. Five families, one accessor, one diagnostic kind.
**Blast radius:** **Published API, additive** — `check()` behaviour does not change, but `diagnose()`
gains a finding kind and both hosts stop being "without running any of them". Middle row of ADR-008
rule 6, with one top-row edge: `DiagnosticFinding['kind']` is a documented JSON contract.

## Problem

[ADR-009](../../adr/009-a-pass-is-constructed-from-evidence.md) requires a passing verdict to be constructed
from evidence of examination. Nothing computes that evidence today. Before the seam can require it
([0098](../0098-the-evidence-seam-and-the-floor.md)), every family has to produce it — and the consumer
has to be able to see what the flip will do to them before it happens.

## The work

### One selection per family, two readers — the amendment's whole point

**Each family extracts the set its conditions receive into ONE private method, and both
`collectViolations()` and the evidence accessor call it.** Not "each family counts at its seam", which is
what the first attempt implemented and what produced the defect:

| family              | first attempt                                           | what `collectViolations()` actually hands its conditions |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| graphql `schema`    | post-predicate — correct, with a comment explaining why | post-predicate                                           |
| graphql `resolvers` | **pre-predicate**                                       | post-predicate                                           |

Two sibling classes, one commit, opposite answers — and the wrong one preserves the fail-open cell this
programme exists to close. Measured: a resolvers chain whose `.that()` selects nothing reported
`examined: 14`, handed its conditions **0**, and passed green with `diagnose()` silent. The schema
builder's own comment states the rule the resolver builder broke: _"counting `getElements()` would report
a healthy number for a chain whose `.that()` narrowed to nothing, which is the fiction ADR-009 part 1
forbids."_

Sharing the method is not tidiness. It is the difference between _"the preview derives from the same
computation the gate will use"_ being true **structurally** and being true **by inspection** — and
inspection is what just failed. It also decides 0098's cost: with one method per family, 0098 retypes one
call site each and the accessor becomes a one-liner over the same set or disappears. Without it, 0098
inherits two derivations of one number that can drift, and the only alternatives there are bad ones.

**The accessor is public** on `DiagnosableRule`. Public is forced, not chosen: a protected member cannot
satisfy that structural interface, which is the recorded reason `assertsSomething()` is public.

The `RuleBuilder` grammar needs no wiring — measured, not assumed: `filterElements()` returns the one set
that is both the selection and what conditions receive, and the one builder suspected of narrowing
outside it (`within()`'s scoped functions) narrows by overriding `getElements()`, which `filterElements()`
calls. Probed with 2 calls matched and zero callbacks extracted: it threw. So for that grammar,
examined ≡ selection, and the 0.34.0 guard already **is** ADR-009's floor. Recorded as an equivalence.

| family               | examined unit                                                    |
| -------------------- | ---------------------------------------------------------------- |
| duplicateBodies      | bodies entering pairwise comparison, post-`minLines`             |
| inconsistentSiblings | the grouped sibling-file set entering `partitionByPattern`       |
| correspondence       | keys of both sides, summed                                       |
| graphql schema       | schema fields entering the chain                                 |
| graphql resolvers    | collected resolver functions                                     |
| tsconfig             | `no-corpus` — the requirements object is the input, not a corpus |

Two families in that table were measured **unreachable** from `diagnose()` in the first attempt, and the
plan must decide the fix rather than leave it to implementation. `CorrespondenceBuilder` and
`SchemaRuleBuilder` both return `undefined` from `getProject()` — correspondence discards its project by
documented design, `schemaFromSDL` never has one — so `diagnose()` hits its `if (!target) … continue`
and never reaches the evidence check. `doctor` calls `diagnose(loaded)` with no project, so those users
get **no preview at all** and then a red build. **Decision: the evidence check must not be gated on
`target`.** Move it above the project resolution, or resolve evidence independently of it — a family's
examined count is a fact about the family, not about whether we could name its project.

### Precedence, ruled here rather than discovered in 0098

`zero-subjects` is emitted **last, and only when nothing else already explained the emptiness for that
rule** — after the glob walk, gated on the rule having produced no other finding. The first attempt
emitted it first and unconditionally, which measured as `['zero-subjects', 'dead-glob']` for one typo and
`['no-condition', 'zero-subjects', 'dead-glob']` for a resolvers rule: the derived symptom printed above
the root cause, with advice (_"its own filters removed everything"_) that is false on both paths.

That also broke a named invariant — `tests/core/a-dead-discovery-glob-fails.test.ts` exists because
`diagnose()` and the gate disagreeing about a dead discovery glob **is** bug 0040 — and it contradicts
this plan's own requirement that the preview derive from the computation the gate uses. The gate has an
explicit precedence at `terminal-builder.ts` (assertion-less → dead selector → dead discovery → collect,
each _replacing_ what follows); `diagnose()` already mirrors it for `project-empty` via a `continue`, and
must mirror it here too.

**The advice must be per-cause**, not one string. ADR-009 part 4 already enumerates three causes with
three remedies and forbids naming one as universal; and the _filters_ cause must name the **actual
excluder including internal defaults** (`minLines` defaults to 5), because "fix your filters" sends a
user who wrote none looking for filters that do not exist. Do not pin a single-cause message in a test —
the first attempt did, which guarded the violation into the suite.

**`zero-subjects` lands in `src/core/diagnose.ts`, not in the doctor wrapper.** Doctor stays a renderer,
"two hosts, one diagnosis" stays true, and — the reason it matters — a rule file that imports a test
runner gets a preview after all: `expect(diagnose(rules)).toEqual([])` runs inside the consumer's own
suite. ADR-008 rule 1's corollary admits doctor cannot load those files; putting the kind in the core is
what stops that admission from being the end of the story.

The preview must derive from **the same computation** 0098 will gate on. A migration instrument derived
differently from its own gate is a rule 5 violation inside the migration.

## Priced honestly in the release notes

`check()` is unchanged, but this is not "nothing breaks": doctor-in-CI users see new findings (doctor
exits non-zero on anything it reports), the documented `DiagnosticFinding['kind']` union grows a member,
diagnosing now **runs** each family's selection-and-filter counting, and suites calling `diagnose()` get
a time increase. The changelog leads with the instruction, not the description: _run `doctor` /
`diagnose()` now; what it reports under `zero-subjects` goes red next release._

## Files changed

The five family files above, `src/core/diagnose.ts`, `src/cli/commands/doctor.ts`, `docs/cli.md` (the
"without running" sentence and the kind table), `docs/api-reference.md` (the JSON contract),
`CHANGELOG.md`, `plans/ROADMAP.md`; this plan moves to `plans/completed/`.

## Test inventory

- **Per family, a files>0 / units=0 fixture** — five of them, one per family outside the `RuleBuilder`
  grammar. Each must hold **every upstream count non-zero** (files loaded, globs matched, pre-filter
  selection non-empty) while the seam count is zero. That makes the fixtures a behavioural provenance
  guard: evidence wired to any upstream layer (`examined: sourceFiles.length` and its cousins) reds them.
  The residue — same-layer miswirings — stays review-enforced, per ADR-009's Notes.
- **The rule-family equivalence recorded, not re-tested**, with the `within()` regression row asserting
  the guard that is now load-bearing as the floor.
- **diagnose/doctor**: `zero-subjects` fires on a files>0/units=0 fixture — **and does not fire beside
  `project-empty` on a zero-file project**. Without that negative row, release A double-reports every
  empty project and prefigures 0098's precedence wrongly.
- **Sabotage**: break one family's evidence computation → diagnose's row moves with it. Same-derivation
  by design; and note honestly what the 0095 matrix does and does not provide here — it probes
  `check()`/`warn()` over a zero-file corpus and this plan changes neither, so **for this release the
  evidence has only same-derivation guards**. Rule 5 permits that where it is stated; the first attempt
  claimed the matrix as the independent check, which it is not for this change. Verdicts read **per
  test**, not per row.
- **Every family reached through `diagnose()`, not through the accessor.** The first attempt asserted
  `examinedUnits()` directly for correspondence and schema and routed only `duplicateBodies` through
  `diagnose()` — which is exactly why 8 of 8 passed while the preview was inert for two families. A row
  that calls the accessor proves the accessor; only a row that calls `diagnose()` proves the feature.
- **Precedence rows**: a dead glob yields `['dead-glob']` and not `['zero-subjects','dead-glob']`; a
  condition-less rule yields `['no-condition']` alone. These are the four tests the first attempt broke,
  and three of them are the invariant, not stale expectations.
- **A boundary row for `duplicateBodies`**: one body examined. The unit is _"bodies entering pairwise
  comparison"_, and one body enters no pair — so a floor gating on `> 0` would let a provably
  unfireable rule through. `inconsistentSiblings` already applies `>= 2` at the folder level; the two
  smell families must agree, and the plan should say which way.
- **An error boundary.** `examinedUnits()` now runs user code — a `correspondence` `keyFn`, full AST
  walks. `diagnose()` has no catch, so the documented `expect(diagnose(rules)).toEqual([])` recipe
  throws a stack instead of reporting; in `doctor` a throw lands in the load-failure catch and is
  reported as _"could not be loaded — if this file imports a test runner"_, a false cause. One row per
  host.

## What 0097 changed for this plan

0097 landed first, deliberately, so this plan's remedy could name an API that exists: `.expectEmpty()` is
now reachable on every family. Two consequences to build against rather than rediscover:

- **The `filters excluded everything` remedy may now say "declare the empty state"** and mean it. It
  could not when the first attempt was written, which was an ADR-008 rule 2 violation the reordering
  exists to prevent.
- **`correspondence().expectEmpty()` with no argument throws**, and `declaresEmpty()` is `protected` on
  `TerminalBuilder` with a per-side override on correspondence. Evidence code must not assume the
  whole-rule flag is reachable on every family.

## Performance, decided rather than discovered

`examinedUnits()` re-runs each family's materialization, and `diagnose()` calls it per rule. Measured on
this repo (605 files): ~500ms per `duplicateBodies` rule cold, and `doctor` calls `diagnose()` once per
rule file — a rule file with ten smell rules paid ~2s to compute ten integers. Two requirements:

- **Memoize per builder instance**, so `violations()` after `diagnose()` does not redo the walk. The
  shared-selection method above is where the memo belongs, which is another reason it is one method.
- **`duplicateBodies` must not fingerprint to count.** `meetsMinLines` already returns false for a
  bodyless function, so `fingerprintAll(xs).length === xs.length` always — the fingerprint pass is
  provably dead work on what becomes the hot path of every consumer's `diagnose()` call.

## Out of scope

The seam retype and anything that changes `check()` — [0098](../0098-the-evidence-seam-and-the-floor.md).
The declared-empty grammar — [0097](./0097-the-declared-empty-grammar.md). Evidence inside a
user-written `defineCondition` body: ADR-009's named residue, invisible to a seam that counts what was
handed to it.

---

## Outcome

Reworked clean from `main` — the amendment said rework, not patch, and the first attempt's branch was
kept only as a record of what was measured.

**The structural requirement holds — for four families on the first pass, and for the fifth only after
review.** Each family extracts the set its conditions receive into one `selected()`, called by both
`collectViolations()` and `examinedUnits()`. `inconsistentSiblings` shipped the accessor and left
`detect()` re-deriving the same threshold inline: two derivations of one number, in the family the
amendment was written to prevent, and a reviewer rewrote its `selected()` to `sourceFiles.length` with
the whole suite still green. `detect()` now iterates the shared set.
Reverting `resolvers` to its pre-predicate form is caught by the **existing graphql violation tests** —
because both readers see the change. That is the difference between "the preview derives from the same
computation the gate uses" being structural and being a claim, and it is the whole reason for the
amendment.

**Memoized through a WeakMap keyed on the builder, not an instance field**, because a field would have
been _wrong_: `shallowClone` is `Object.assign` over own properties, so a memo is copied onto a builder
that was just given a different filter, and the clone answers with its parent's selection. Plausible
number, stale evidence. A clone is a different key, so the hazard cannot arise — and the row that pins
it materializes a parent, narrows it, and checks the parent is unchanged.

**Two of the three rulings landed as written; the third landed by halves and was corrected.** Not gated
on `target` — right first time, and proved through `diagnose()`. Advice that names the narrowing without
claiming the author wrote it — right first time. **Precedence** landed for `dead-glob` and
`project-empty` and NOT for `no-condition`, because `const before` was captured after that push, so the
tail could never see a missing assertion — while the comment on the tail claimed it did. The code
contradicted its own comment, and the plan had pre-registered `['no-condition']` alone as a required row.
The no-project branch was ungated for the same reason.

**A fourth thing the plan required and the first pass did not do: the advice must remediate.**
`zeroSubjectsFinding` never consulted `declaresEmpty()` — the hook 0097 created for exactly this
question, whose docstring says it exists "ahead of the floor that reads it". 0096 was its first reader
and did not read it, so a rule that declared the empty state was still reported, and the printed remedy
was one the reader had already applied. On `correspondence` the remedy as literally written throws,
which this plan warned about in its own text. `declaresEmpty()` is now public — the same structural
forcing that made `assertsSomething()` public — and the row that guards it applies the advice and
asserts the finding clears, rather than asserting the advice's text.

**Two `diagnose()` tests were fixed by changing the fixture, not the assertion.** `**/domain/**` held no
body over the default `minLines(5)`, so a detector scoped there examined zero and could never fire —
those tests had been pinning glob liveness through a vacuous detector, which is precisely what this plan
exists to surface. `diagnose.test.ts` forbids the alternative in writing.

### What the review round changed, and what it says about the matrix

Three reviewers, three criticals, all measured and all things this Outcome had claimed landed. The
testing reviewer's matrix was 34 rows split per call site against my 5, and scored **12 caught by
nothing** against my 5-of-5 — including every row touching `inconsistentSiblings`, the family my matrix
had no row for. Four of my positive rows used `toContain`, which `diagnose.test.ts` bans in writing as
"the cheap green the plan bans", and the two rules I chose to prove the no-project fix were exactly the
two that co-reported `['no-condition','zero-subjects']` — so the assertions could not see it. The test
file's header also claimed every family was reached through `diagnose()`; it was three of five.

Corrected: rows are `toEqual`, the no-project rows use assertion-complete rules, and the missing rows
exist — `['no-condition']` alone, the declaration clearing the finding, resolvers through `diagnose()`,
and `inconsistentSiblings` at a folder of exactly one file, which is the only shape where its threshold
is semantic rather than an optimisation.

### The sabotage matrix, and why TWO runs were void

5 rows, verdicts by exit code, green baseline both ends: precedence removed → caught; the no-project
branch skipped → caught; fires regardless of the count → caught; never fires → caught; `resolvers`
reverted to pre-predicate → caught.

**Two runs were void, for two different harness faults, and both were caught by an assertion rather than
by a verdict.** The first: zsh does not word-split unquoted parameters, so the file list reached vitest
as one nonexistent filename and every row exited 1 — **including the baseline**, which is the literal
failure ADR-008 rule 5 records, reproduced while building an ADR-009 instrument. The second, after the
review: a shell helper did not forward its arguments to `python3 -c`, so **no patch applied at all** and
every row would have scored "caught by nothing" had the tracebacks not been visible.

The lesson is not "be careful with shells". It is that a sabotage harness needs the same two assertions
it demands of the code it audits: a **green baseline** and a **patch that provably applied**. Both faults
were invisible in the verdicts and obvious in the assertions.

### Deferred, and named

- **The effectiveness half of `.expectEmpty()` on `SmellBuilder`** stays in
  [0098](../0098-the-evidence-seam-and-the-floor.md)'s inventory, where the floor makes it possible. This
  plan makes it _reachable_; nothing reads the flag yet outside the rule builders and `correspondence`.
- **A boundary row for `duplicateBodies` at exactly one examined body.** The unit is "bodies entering
  pairwise comparison" and one body enters no pair, so a floor gating on `> 0` would let a provably
  unfireable rule through. `inconsistentSiblings` already applies `>= 2` at the folder level. The two
  smell families should agree, and 0098 is where the floor decides it.
- **An error boundary.** `examinedUnits()` now runs user code — a `correspondence` `keyFn`, full AST
  walks — and `diagnose()` has no catch, so a throwing `keyFn` gives a stack rather than a report. In
  `doctor` it lands in the load-failure catch and is described as a rule file that could not be loaded,
  which is a false cause. Filed rather than fixed here because the right shape is a decision about
  `diagnose()`'s contract, not a `try` in this plan.

### What the DELTA review changed — a fix commit that reintroduced the bug it fixed

The delta round found one critical, and it was **mine, in the fix**. Correcting the advice string, I
replaced "from a later minor this becomes a failing finding" — true under every ordering — with "in this
same release it is a failing configuration finding". Measured: four of the five families it can print
for **pass green** at `check()` with zero examined, and the fifth fails only via its own pre-existing
per-side finding. The floor is 0098, whose header still reads _Open, not started_ and lists ADR-010
ratification as a dependency. So the commit that fixed a false remedy shipped a false remedy on the same
ADR-008 rule 2 axis, in a string the library prints, guarded by nothing — the row asserts `'0 subjects'`
and `'did not write'`, so the claim could rot silently. Reverted to release-agnostic wording; the
CHANGELOG carries the sequencing note, where a slip is cheap to correct.

**A recorded equivalence expired one commit after it was written.** `CorrespondenceBuilder.declaresEmpty()`
carried an ADR-008 split-row note — "unobservable until 0098, recorded rather than guarded, no shipped
code reads it, measured". This plan's fix made `diagnose()` its first reader, which ended that
equivalence, and the docstring still asserted it. Reverting the override to the base body left all 3219
tests green. The lesson generalises: **a recorded equivalence is a claim with a lifetime**, and the
commit that gives it a reader is the commit that must retire it.

**Three items the review had raised and the fix had not applied were closed rather than deferred**, all
because 0098 needs each of them anyway:

- `selectionMemo` now registers with `cache-registry.ts`, like `element-cache.ts`. The hazard is worse
  here than there: **both** readers go through this memo, so a stale entry is a stale verdict and a
  stale count that agree with each other.
- A classification census forces the hooks. `examinedUnits?` and `declaresEmpty?` are optional on
  `DiagnosableRule` and fail in **opposite** silent directions — forget the first and the family gets no
  preview at all; forget the second and a per-side family inherits `_expectEmpty`, which is always false
  there, so the preview tells an author to declare what they declared. That second one is the defect
  this plan had just fixed for `correspondence`, reachable again for the next family.
- The remedy is now per family. `emptyDeclarationAdvice()` joins `assertionAdvice()` as a sibling on the
  same root rather than becoming a third bare optional, and the row **calls what the advice names** and
  asserts the finding clears — `.expectEmpty()` is a `TypeError` on `correspondence`.

Sabotage on the delta: 7 rows, exit codes, green baseline both ends, patch-application asserted — all 7
caught. **One row was not caught on the first run, and the cause was the fix itself never applying**: a
`python` replace matched a block prettier had since collapsed to one line, wrote nothing, and I read
"16 passed" as success when 16 was also the count before. The same class as the two void sabotage runs
above, one layer up: I had been asserting that _sabotage_ patches applied while not asserting that the
_fix_ did. Every edit in this round now asserts its own application.

**Left for the user, not done here:** ADR-010 rule 1's table names four contract members and should name
`declaresEmpty()` and `emptyDeclarationAdvice()`. An ADR is a decision, and 010 is Proposed and awaiting
joint ratification — so this is recorded for that moment rather than edited in.

### Independence, stated rather than implied

The 0095 matrix is **not** an independent check for this change: it probes `check()`/`warn()` over a
zero-file corpus, and this plan changes neither. For this release the evidence has only same-derivation
guards. Rule 5 permits that where it is stated; the first attempt claimed the matrix and that claim was
wrong.

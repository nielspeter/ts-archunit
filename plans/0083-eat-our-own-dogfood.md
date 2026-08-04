# Plan 0083 — eat our own dogfood

**Status:** **Phase 1 DONE (v0.47.0). Phase 3's two hard requirements DONE (v0.51.0); its reference-consumer wrapper split out as [plan 0093](./0093-a-reference-consumer-for-the-presets.md). Phase 0 and 2 not started.** Phase 1's result is recorded below: 34 of 36 rows caught, 2 caught by nothing, both fixed as [bug 0052](../bugs/fixed/0052-nostubcomments-cannot-see-a-functions-own-docstring.md) and [bug 0053](../bugs/fixed/0053-the-stub-rule-matched-prose-about-stubs.md). The gated population is **44** rules now, not the 36 Phase 1 measured; a re-run would need to cover the eight added since.

**Phase 3's central claim, as it stood at v0.49.2 — now fixed, kept because it is the measurement that justified the work.** `package.json` declares **12 `exports` subpaths and not one of them is ever resolved by anything.** The only two test files that mention `@nielspeter/ts-archunit` treat it as a _string_: `tests/cli/init.test.ts` asserts that the scaffolded rule file **contains the text** `import { recommended } from '@nielspeter/ts-archunit/presets'`, which is the opposite of resolving it. Were that subpath missing from the map, the test still passes and every scaffolded project fails on its first run. Nothing packs a tarball. **Four releases shipped on 2026-08-04 across that gap**, and `npm pack --dry-run` confirming the file list is not the same evidence as resolving the map. Filed 2026-08-04 out of the question "are we dogfooding all the ADR-008
features?", answered **no** by measurement. **Restructured 2026-08-04 after a five-persona review
broke both of its measurements and inverted its phase order** — see "What the review changed".
**Priority:** Phase 1 high, Phase 3 high, Phase 2 medium. Not for a count: two features built to fix
our own bugs were never aimed at us, and nothing was watching the watchers.
**Effort:** Per phase, because "medium" across all of them was not credible: Phase 0 ~half a day,
Phase 1 ~1 day (36 planted violations with verdict discipline), Phase 2 ~1–2 days, Phase 3 multi-day.
**Blast radius:** Split, and that split is doing work rather than labelling. Phases 0–2 are an internal
audit over a corpus we control — rule 6's floor. **Phase 3 exercises the shipped library as an adopter
does, so its findings are published-behaviour findings** — rule 6's top row. One exception, stated
because it would otherwise be silent: **if enforcing a class-B item needs a library change, it leaves
Phase 2 and is filed as its own plan** — that is bug 0049's shape, where the honest rule required a
module-scoped variant.

## Problem

We ship a library whose entire thesis is that architecture rules must be **executable and
enforced**, and we do not enforce most of ours on ourselves.

Two gaps were found by asking the question once, and both were the same shape — a feature built to
fix our own bug, then never aimed at us:

| Feature                        | Built for                                                                                                                                  | Self-applied before 2026-08-04?                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orphanExclusions`             | [Bug 0044](../bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md) — a directive naming a renamed rule is inert forever | **No.** Exercised only in its own unit test — while v0.45.6 had just put two real waivers into `src/`. Renaming the rule would have silently voided both. |
| comment-suppression disclosure | [Bug 0041](../bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md)                                                      | **No.** We built a channel to report what comments silenced, then never pointed it at ourselves.                                                          |

Both are now checked, and both checks were proven to fire. That is not the finding. **The finding is
that nothing was watching the watchers**, and the same audit that found two will find more.

### The number does not reproduce, and that is the first finding

The first draft of this plan said **166** enforceable primitives, "derived from source — every
exported function in `src/conditions/`, `src/predicates/`, `src/rules/` and `src/smells/`". A product
review re-ran exactly that and got **185**. Re-running it again got **187**.

Three numbers, one stated derivation, **no committed script.** So it is not a derivation; it is a
recollection with a method attached. This plan cites
[plan 0079](./completed/0079-triage-the-cardinality-only-assertions.md)'s lesson — _the filed number
came with no script, so it could not be reproduced or audited_ — and then repeated it one level up,
applying the discipline to the numerator's work list and not to the denominator.

Worse, the definition was already wrong on its own terms: the `src/smells/` entries it counted are
`buildFingerprint` and `computeSimilarity`, internal helpers, not primitives you point at code —
the same category error this plan rejects for `TerminalBuilder` and `STANDARD_HTML_TAGS`.

**The ratio is withdrawn**, including from `plans/ROADMAP.md`, and it is not to be requoted. What
survives is the qualitative finding, which needs no denominator: two features built to fix our own
bugs were never aimed at us, and nothing was watching the watchers.

### Phase 0 — a committed derivation, or no number at all

Before any triage: a script in the repo that produces the population, with the same standing as
`tests/tools/scan-cardinality-assertions.ts`. It must exclude internal helpers, and its output is the
input to Phase 1.

**If a defensible definition of "enforceable primitive" cannot be written, that is the answer** — the
plan proceeds on classification alone, with no ratio, and the absence of a clean definition is itself
recorded. A number nobody can reproduce is worse than no number: it invites exactly the coverage
chase the rest of this plan is written to avoid.

## Phase 1 — plant the violation, over the 36 rules we already have. Run this FIRST.

Standalone, before any classification, because it depends on nothing else and because if it finds
another bug 0049 then **class A is not a safe bucket** and the meaning of the whole triage changes.

For each rule in `tests/archunit/arch-rules.test.ts`: introduce the violation it forbids, assert it
reds, revert. Two reviewers independently identified this as the highest-yield item in the plan, and
it is the operator that would have caught both bug 0011 and bug 0049.

**Cheap route for a third of them:** `tests/fixtures/` is a corpus built to _violate_ these rules —
this file's own comment records that scoping to the fixture tree "reds 13 rules on 89 hits". Dirty
corpus versus clean corpus is real independence in rule 5's sense, and nearly free.

**Verdict discipline is not optional here** (ADR-008 rule 5's verdict-mechanism corollary, which this
repo has paid for repeatedly): an isolated `git worktree` held exclusively — two agents in one checkout
has already poisoned one matrix this week; a green baseline asserted before each patch; each patch
proven to apply non-trivially; the **exit code** read from an unpiped command; the failing test asserted
to be the _expected_ one, and the violation identity asserted to name the planted element. **Report
caught-by-nothing as a number.** "Watch it red" credits any red — a plant that trips a neighbouring
rule, or the `BUILT.length === terminals` identity at `:940`, scores CAUGHT for the wrong reason.

**Mechanics that bite:** `BUILT` fills as `it()` callbacks execute, so each row must run the **whole
file** — a `-t`-filtered run reds `:940` on a half-filled array. 36 full runs is ~70 minutes; budget it
or scope the matrix. And derive the population from `BUILT`, never type it: the file currently carries
**36, 39, 41 and 43** in four separate comments for one population, in the file whose subject is
distrusting hand-maintained claims. Fixing those four is a free side effect.

**Leave something behind.** "Revert and move on" proves firing once at a moment nobody can reproduce,
and the record is a line in a write-up — ADR-008's own "a hand-typed measurement in a plan" row. This
file already ships the durable form (`would report a fault if one were introduced`). Keep a permanent
positive control **per mechanism class**, not per rule: the 14 `core must not import from X` rules share
one mechanism and differ only by glob, so one control covers them. ~36 rules becomes ~12 controls.

### Phase 1 result — 36 rows, 34 caught, **2 caught by nothing**

Run 2026-08-04 in an isolated `git worktree`, green baseline asserted before every row, each plant
proven to apply, exit codes read unpiped, and each row checked that the **expected** test failed rather
than crediting any red. Tree restored green after. 1.63s per run, so the whole matrix cost about a
minute — the plan's ~70-minute estimate was for `-t`-filtered runs it then forbade.

Population **derived** from `BUILT`: **37 rules, 37 distinct ids.** All four hand-typed counts in
`arch-rules.test.ts` (36, 39, 41, 43) are wrong.

|                          |                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Rows                     | 36 (the 37th, `api/no-single-glob-predicates`, needs an in-place edit rather than a planted file — deferred) |
| Expected test red        | **34**                                                                                                       |
| Red for the wrong reason | **0**                                                                                                        |
| **Caught by nothing**    | **2**                                                                                                        |

Both misses became filings, and **neither would have been found by the deletion audit this plan
originally specified**:

- **`hygiene/no-stubs`** — a `TODO` planted in `src/` did not red.
  [Bug 0052](../bugs/fixed/0052-nostubcomments-cannot-see-a-functions-own-docstring.md): the condition
  searches function _bodies_, so a marker in the function's own docstring is invisible.
- **`arch/no-cycles`** — a planted cycle did not red, and neither does the **real one already in our
  source**. The rule is `.warn()` by a documented decision whose stated blocker is type-only imports.
  [Plan 0084](./completed/0084-cycle-detection-that-ignores-type-only-imports.md).

The result also answers the question the plan raised about class A: **A is not a safe bucket.** Two of
37 rules in it were enforcing nothing, which is the same finding as bugs 0011 and 0049 and now the
third instance. Phase 2's classification must treat "already enforced" as a claim to test, not a state
to record.

## Phase 2 — the census, measured rather than read

The first draft classified 166 items **by reading**, which inherits 0079's recorded residue: one reader
classifying everything proves consistency, not correctness — and 0083 has no sample, so it had _less_
protection than 0079 did.

**The library is its own oracle.** For each primitive, write the widest honest scope and record two
numbers — **subjects selected** and **violations**:

| Measurement                | Class                    | Why it is mechanical                                                                                                       |
| -------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 0 subjects                 | **C**                    | "we do not have this shape" _is_ "the selector selects nothing" — which `diagnose()` and the dead-glob gate already decide |
| subjects > 0, 0 violations | **B**                    | the repo has the property and nothing asserts it. Free rule.                                                               |
| violations > 0             | **B-with-debt** or **D** | and now the D claim carries a reproducible price                                                                           |

That removes judgement from the actionable class entirely, and leaves it only where it belongs: on
belief, priced. **Class A is mechanical too** — derive it from the rule file (imported functions plus
builder-method call sites), do not hand-list it.

**Class D is sharpened, because as first written it was an unfalsifiable dumping ground** — ADR-008
rule 3's corollary: a marker an agent can stamp on anything to go green is worse than no marker.

- **D must name the property, not the primitive.** "`beAsync()` — this repo has no rule about which
  functions are async" is checkable. "We do not believe it" is not.
- **D and C must be separable by measurement.** C is "the shape does not exist here". D is "the shape
  exists and we decline to constrain it" — which always admits _what would the rule red on today?_ If
  the answer is zero, that is **class B with a free rule**, not D.
- **D has a ceiling.** The first draft pre-registered a threshold only on B — the branch that can
  _stop_ work — and none on the branch that can _excuse_ it. A result of A 41 / B 12 / C 8 / D 100 would
  have fired "under 10%, we're fine" while 60% sat in an unfalsifiable bucket. **D above 40% triggers a
  re-read**, and that is registered now, before looking.

**The stop rule, which the first draft did not have.** It said: under ~10%, Phase 2 is the whole of the
remedial work; over, Phase 2 grows. Both branches say _enforce all of class B_ — it forbade nothing.
0079's worked because one branch **deleted a phase**. So:

> **If B > 25 items, Phase 2 ships only the top five by blast radius and the remainder is filed as its
> own plan.** A census is not a licence to write sixty rules in one change.

And **a second reader classifies 20 items blind**, reporting the disagreement rate. That is the number
0079 explicitly did not produce, it is cheap here, and it is the only thing making the census auditable
by someone who did not do it.

## Phase 3 — DONE for both hard requirements (v0.51.0), and split

**Both hard requirements shipped; the "reference consumer" wrapper did not, deliberately.** Phase 3 as
written bundled three things, and only two were the requirements:

|                                                                 | Needed the reference consumer?                        |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| Resolve the package by name through the `exports` map           | **No** — `scripts/verify-package.mjs`                 |
| Same rule array twice in one process                            | **No** — `tests/presets/rules-are-idempotent.test.ts` |
| Every preset, one project, one process, per-rule-id finding map | That _is_ it — see below                              |

### Requirement 1 shipped by a cheaper method than this plan proposed

The plan said `npm pack` → install → import. **Node self-references a package by its own name when it
declares `exports`**, so the real map resolves through the real algorithm with no install and no network.
Three checks, because sabotage killed the first two:

1. every subpath resolves _and exports something_ — a subpath resolving to an empty module is a subpath
   nobody can use;
2. every declared target appears in `npm pack --dry-run --json` — the failure self-referencing cannot see,
   a target that resolves locally and is absent from the tarball;
3. **every specifier the repo itself writes is IN the map**, derived from `src/` and `docs/`. Checks 1 and
   2 both pass when a subpath is _removed_ — the rest still resolve and still ship. Deleting `./presets`
   now names `src/cli/commands/init.ts` as the file that would break, which is the file that scaffolds it
   into every new project.

**It is a script, not a test**, because all three need `dist/` and `npm run validate` runs the suite
_before_ `npm run build`. A vitest row that skipped on a missing `dist/` would be a check that cannot fail.
Wired into `ci.yml`, `publish.yml` and `prepublishOnly`; `publish.yml` also gained the `shellcheck` step it
was missing (part of [bug 0062](../bugs/0062-the-release-pipelines-gates-drift-and-its-diagnostics-misname-the-cause.md)).

### Requirement 2 shipped, and the first version could not see the bug it cites

`tests/presets/rules-are-idempotent.test.ts` builds each preset's array **once** and evaluates it twice —
no reference project, no snapshot, nothing to hand-edit when detection improves.

Two rounds were needed, and both are the point:

- **The first version was blind to bug 0034.** Its `agentGuardrails` options set only `noInlineLogic`, so
  the preset never constructed the stub rule, `comment()` was never reached, and reintroducing bug 0034's
  exact mechanism — a `Set` in that matcher's closure, never reset — left all six rows green. Fixed by
  enabling every guardrail option, chosen to reach the code the bug lived in. _A test that cites a bug it
  cannot see is worse than no test._
- **Declaration order turned out to be part of the derivation.** Leaked state is module-level, so it
  survives between `it()` blocks: with the union row last, the rows above had already warmed the leak and
  its own first run saw the degraded answer. Only the row that runs **first** sees cold state, so exactly
  one row can catch a module-level leak. The union row is declared first now, and the comment says so.

### What was NOT built, and why

The reference consumer proper — every preset over one project with a `Record<ruleId, elements>` map — is
re-filed as [plan 0093](./0093-a-reference-consumer-for-the-presets.md). It does not gate either
requirement, it is the expensive part, and this plan already warns it is "a snapshot in all but name".
Shipping the two cheap guards first was the right order; whether the third earns its keep is a separate
decision and should be made on its own.

## Phase 3 — the original text, for the record

**Ungated.** The first draft said "Phases 2 and 3 only happen if Phase 1 says so" and then admitted
Phase 3 "is judged on its own merits" — so the staging only delayed the one phase with user-facing
value behind the one with none. Reviewers were unanimous: Phases 0–2 are internal confidence an adopter
never perceives; Phase 3 is the only part they would feel. It is also cheaper to act on its findings at
0.46 than after 1.0.

**Its scope is INTERACTION, not shape.** `tests/fixtures/presets/` already holds seven per-preset
mini-projects, and `tests/integration/shape-presets-check.test.ts` already spreads two presets through
the real `check` pipeline. The honest novelty is: **every preset, one project, one process** — plus the
two things nothing covers, each now a hard requirement:

1. **Consume the packed tarball by package name.** All 217 test files import from `../../src/`. Nothing
   resolves `@nielspeter/ts-archunit` through the twelve-subpath `exports` map, and nothing packs a
   tarball. A typo there, a `.d.ts` that will not resolve under `Node16`, or a `dist/` file missing from
   `files[]` is a day-one blocker caught by nothing — and `tests/docs/shipped-links.test.ts` exists
   _because_ v0.25.0 shipped links that resolved to nothing from the tarball. Same shape, one layer down.
   `npm pack` → install → import by name, or it is a bigger fixture and not a consumer.
2. **Run the same rule array twice in one process and assert identical findings.** Bug 0034 was not
   "presets fan out" — it was a `Set` in a matcher closure that was never reset, so `evaluate()` returned
   2 findings then 0. A reference project that builds fresh rule objects per assertion never exercises
   that. If bug 0034 is the justification, this is a _required_ assertion.

**Assert one canonical violation per rule id, not the finding set.** Every preset over a whole project
is a snapshot in all but name — with a snapshot's churn and none of the `-u` escape hatch, so every
genuine detection improvement reds the file and gets hand-edited. Instead: `Record<ruleId, elements>`
where keys are asserted against the declared-id set derived from `describeRule().id` (the trick
`orphanExclusions` already uses, and it handles `agentGuardrails`' template-literal ids), and values are
pinned only for designated instances — each commented with which bug shape it stands for. A rule that
stops firing then shows as a key with an empty array rather than vanishing from a shorter list.

**The vacuity floor as first written is satisfied by total vacuity.** `assertDiscovered` returns a
`bypassFilters: true, file: ''` finding when a preset's glob discovers nothing — so a reference project
whose every glob misses produces a **non-empty** finding list, and a cardinality band accepts it. That
is 0079's headline discovery reproduced one level up, in the plan that cites it. Three rows instead:
configuration findings asserted `toEqual([])` by identity; the set of ruleIds producing _ordinary_
findings asserted against the declared set; and an explicit justified-silent list, so "this rule
reported nothing" fails closed.

**Assert through the JSON/`checkAll` path, not `.check()` terminals.** `recommended` ships two
deliberate warn-level rules, and a `.warn()` finding inside a test reaches nobody (bug 0024). Through
`.check()` every warn-severity rule in the reference project is invisible and silently uncovered.

**Identity must be machine-portable.** Do not assert `hashViolation` hashes — the rule string is the
assembled description, so editing any preset's predicates reds the file on an unrelated refactor. And
the smell detectors interpolate **absolute paths** into `message` and `identity`. Assert tuples of
`(ruleId, toPortablePath(file, root), element)` and scrub message text through `normalizeIdentityText`;
`src/core/identity-root.ts` already exists for exactly this and Phase 3 is its first consumer outside
the baseline. Assert **sets**, not ordered arrays: source-file order is stable, but `groupByFolder`
sorts with ICU-dependent `localeCompare` and this machine is on Node 26 while CI is on Node 24.

**The anti-rot guard, mechanised.** The first draft said "model it on the structures `docs/what-to-check.md`
teaches, so a divergence shows up as a failure" — and nothing mechanised it; no test references that
file. The repo has already recorded what hand-transcription costs (`combinator-examples.test.ts`: "the
transcription is the weak link"). The mechanical version: `docs/what-to-check.md` carries 31 `typescript`
fences with concrete glob literals — extract them and assert **every one selects at least one file in
the reference project**. Docs text versus project filesystem is a genuine second derivation, it turns
"we teach a shape we cannot enforce" into a red, and it doubles as the vacuity floor.

**Operational constraints, measured, and all three must land in the first commit** — each turns the
build red in a step _before_ the tests run, the failure that looks like nothing in the working tree:

- `strictBoundaries({ isolateTests: true })` only fires on `${dir}/**/*.test.*`, so the reference project
  must contain such files — and vitest's `include: ['tests/**/*.test.ts']` would collect and fail them.
  Use the existing `*.test.fixture.ts` convention (verified compatible with the preset's glob).
- The 14 layering rules scope by `resideInFolder('**/src/core/**')` with **no** `inProjectSrc()` guard,
  and `tsconfig.json` includes `tests`. A reference project containing `src/core/` would be enforced by
  our own dogfood rules, and the cheap fix (`.excluding()`) weakens them. Name the directories
  differently. Same hazard for `pathUniverse`, whose `keep` filter drops only `tests/fixtures/`: a glob
  dead against `src/` could read as alive by matching a reference file.
- ESLint ignores only `tests/fixtures/**` and lints with `projectService`. Excluding from tsconfig
  without an eslint `ignores` entry produces "file not found in any project".
- `format:check` enumerates pathspecs and has no `*.tsx` or `*.graphql`, while `npm run format`
  rewrites both — drift with no signal.

**Prove it by running `npm run validate` with the reference project present and its rule file not yet
written.**

**Cost is measured and is not the objection.** Full suite: 23.0s wall / 246s CPU. Every preset over a
571-file program: ~2.8s wall / 4.0s CPU — about **1.5% of the suite's CPU**, against 15- and 20-minute
workflow timeouts. **Flakiness is the real risk and it is localised**: `noCopyPaste` alone is 1984ms and
2776 findings on 571 files, and `duplicate-bodies` is pairwise O(n²) over every function in the program.
Under full parallelism the recorded multiplier is 10–16x, which puts a single 2.8s `it()` past the 30s
timeout. So: split the assertions across several `it()`s in one file (the program cache is per tsconfig
path, so that costs one load), scope `duplicateBodies` to boundary folders rather than the whole program,
and **state a file-count ceiling** — "shaped like an adopter's codebase" has no size bound and the
quadratic term does.

**Record a wall-clock ceiling.** There is no perf test anywhere in the repo and `docs/` never tells an
adopter what to expect. The reference project will be the only realistic-scale artifact this project
has: assert "all presets over N files under X seconds", failing if it doubles. Without it, the first
accidentally-quadratic condition is found on someone's repo.

## Test inventory

1. **Phase 0's derivation is a committed script**, not a table — and the class-A column is generated
   from the rule file and asserted against the committed classification. One column with a free oracle.
2. Phase 1's plant matrix, with caught-by-nothing reported as a number.
3. ~12 permanent positive controls, one per mechanism class, surviving Phase 1.
4. Phase 2's blind-second-reader disagreement rate on 20 items.
5. Phase 3's three vacuity rows (configuration findings empty; ordinary-finding ruleIds versus the
   declared set; justified-silent list), the twice-in-one-process assertion, the packed-tarball import,
   and the docs-glob extraction.
6. A ratchet — **renamed to what it measures.** "Which primitives are enforced" is not decidable from
   text: bug 0011 had 17 rules present and selecting nothing, bug 0049 had one pointed at the wrong
   element kind, and a presence-ratchet would have been green through both while its name claimed
   enforcement was pinned. Call it `PRIMITIVES_REFERENCED`, key it on the **classification** so an
   honest class-D retirement does not red it, and give it the probe row 0079's ratchet has — an
   over-matching extractor is silently green forever, which is the direction nobody checks.

## Out of scope

- **Raising the number.** Stated three times now on purpose.
- **Publishing the ratio.** Withdrawn from the roadmap. As a published figure it reads as "75% of this
  library is unproven on real code", which is false — those primitives are covered by fixtures, they are
  _not self-applied_, a much weaker claim. What is worth publishing is the **class-C list** framed as
  "these have no host in our own architecture, so here is how we prove them instead", and the **Phase 1
  result** — "we planted a violation against each of our own 36 rules; N caught it" is a stronger honesty
  signal than any ratio.
- **Any change to `src/presets/`, `src/rules/`, or a default severity, originating from Phases 1–2.**
  `docs/presets.md` promises adopters that new rules enter at `warn` or `off` in a minor. A dogfooding
  sprint is the classic way to break that promise while feeling virtuous.
- **The JSX gap**, now [bug 0051](../bugs/fixed/0051-the-jsx-entry-point-has-never-run-against-a-file-on-disk.md).
  It is a fixture and a test, not a plan phase, and filing it here would have let a stop rule defer it.
- **Compiling the `docs/` fences.** Raised by the customer review as a better use of Phase 2's budget:
  8,813 lines of markdown, never compiled, and plan 0069 found all three `@example` blocks in one source
  file broken. Chain _shape_ is what greps cannot see. Deserves its own plan; noted so it is not lost.

## What the review changed

Five personas. The framing survived; both measurements did not.

| Finding                                                                                                                                                                                                                            | Status                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| The delete-each-rule audit was **pre-determined** — deleting a passing check from a green suite leaves it green (measured: removing a rule leaves 45/45 passing). Its inference would have reclassified all of class A as class B. | Operator inverted              |
| The population **does not reproduce**: 166 filed, 185 / 161 / 187 on re-runs. Three reviewers got three numbers.                                                                                                                   | Ratio withdrawn; Phase 0 added |
| The stop rule **forbade nothing** — both branches said "enforce all of B".                                                                                                                                                         | Rewritten with a prohibition   |
| Class D had **no ceiling** — only the branch that can stop work was registered, not the one that can excuse it.                                                                                                                    | 40% ceiling registered         |
| Phase 3's vacuity floor is **satisfied by total vacuity** (`assertDiscovered` emits a finding on zero discovery).                                                                                                                  | Three identity rows            |
| Phase 3 was **gated behind the phase with no user value**.                                                                                                                                                                         | Ungated and promoted           |
| JSX: **zero `.tsx` files exist on disk**; the plan filed that as reassurance.                                                                                                                                                      | Bug 0051                       |
| One premise in my own review brief was wrong: `graphql` is already a devDependency and already required by the suite.                                                                                                              | Corrected here                 |

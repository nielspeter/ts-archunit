# Plan 0102 — A Detector That Cannot Fire Says So

**Status:** DONE (v0.60.0). Phases 1–4 implemented and shipped. The N+1 flip (`INERT_FINDING_EMIT = true`)
is out of this plan's own scope by design — tracked separately in
[plan 0105](../0105-the-inert-finding-flipped.md), per this plan's own Release section.
**Implements:** [proposal 027](../../proposals/027-a-rule-that-cannot-fire-says-so.md). Corrected twice since:
once against the proposal itself (see "The framing, corrected from the proposal" below), and once by a
five-persona review of this plan (2026-08-12) that found a compile error in the Phase 3 code sample (verified
against this repo's own `tsc`), a silently-dropped `groupByFolder()` ordering contract, an existing test this
plan's own predicate would break at the flip with no mention in Files Changed, an unguarded "one pass, not
two" performance claim, and a release-mechanism gap (nothing forces the N+1 flip to happen, and the plan
originally mis-cited 0.59.0 as precedent for a shape 0.59.0 did not use). All five are fixed inline below
rather than left for the implementer to rediscover.
**Depends on:** the plan for [proposal 026](../../proposals/026-sabotage-is-a-command-not-a-ritual.md) — 027's
regression guard ("deleting `validateOverrides` still reds") is itself a 026-shaped sabotage; 026 mechanises
that class of guard first, 027 leaves it hand-run. File together; 026 unblocks 027's guard, not its construction.
**Priority:** High — liquidates [bug 0077(A)](../../bugs/0077-a-non-empty-examined-count-proves-neither-falsifiability-nor-scope.md),
an on-record High-severity fail-open the vacuity matrix already audits, and the offending rule is this
project's own dogfood corpus's worked example of the exact failure the tool exists to prevent. Priority and
blast radius sit on different axes and are not in tension: priority tracks the severity of the lie (a
first-party showcase case), blast radius (below) tracks how far ADR-008 rule 6 says to chase the guard.
**Effort:** Medium. The _design_ is small and localized — a pure accessor, one violation producer, one
diagnose hook, in one file. The _surface_ is not: a public interface addition (`DiagnosableRule.inertAdvice?`),
a new `DiagnosticFinding['kind']` literal, a two-release version-gated migration with its own scheduling
requirement (see Release), a fix to an existing test this plan's predicate would otherwise silently break
(see Files Changed), and a 15-row sabotage matrix. Rate the work by the surface, not just the shape.
**New public API:** one optional, non-breaking member on `DiagnosableRule` — `inertAdvice?(): string` —
parallel to `zeroSubjectsAdvice()`. Optional (`?`) so external dialects (ADR-010) keep compiling; the precedent
is `assertionAdvice`/`zeroSubjectsAdvice`, which the `DiagnosableRule` contract already documents as verbatim-shared.
Also adds one `DiagnosticFinding['kind']` literal (`'inert'`) — see Phase 4.
**Blast radius:** **Published-API surface — small adoptership.** `smells.inconsistentSiblings` is a public
export and this flips currently-green rules red on the flip release, so ADR-008 rule 1's migration corollary
(diagnose-first on N, fail on N+1) applies and the finding is error / unsuppressable. But it has **no preset
conduit** (only `duplicateBodies` reaches presets). **Citation corrected by review:** the "used ~zero times"
figure does not come from ADR-009's context table — it traces to
[`plans/ROADMAP.md:162`](../ROADMAP.md) (proposal 018's discovery-surface measurement), and it is a
**combined** count for `duplicateBodies` **and** `inconsistentSiblings` together against one external corpus,
not a detector-specific figure. No evidence contradicting "small adoptership" turned up elsewhere in this
repo (README, spec, tests, docs — only dogfood usage found), but the number itself is secondhand and
combined; stated honestly rather than with false precision. So by rule 6 the depth is **guard the
construction + one sabotage round**. A second round is the fallback if a real adopter fires in the N-phase.
Do not inherit "strangers depend on it"; the measured surface is a direct caller of a niche detector.

---

## Problem

A detector whose stated purpose is "green must mean something" shipped a green that means nothing.

```ts
smells.inconsistentSiblings(p).inFolder('**/src/builders/**').forPattern(call('this.copy'))
// examined: 11   violations: 0
```

`inconsistentSiblings` reports a **minority diverging from its majority**. Only 4 of 11 builders call
`this.copy()` — `4/11 = 0.36 < 0.6` — so there is no majority for anyone to diverge from, and the rule is
structurally incapable of a finding. Every guard passes it: the floor (0099) sees `examined = 11 ≠ 0`;
ADR-009's evidence seam is satisfied (counted, correctly provenanced); `diagnose()` is silent because the
glob is alive; the compiler is silent because evidence is present.

**Measured 2026-08-10 (this repo), corrected 2026-08-12 during implementation:** `examined: 11 /
violations: 0`, exactly 4 of 11 builders call `this.copy()`. The original text wrote the pattern as
`call('copy')` (bare) and verified the file count with `grep`, which confirms which files contain the
text `copy(` but not what the AST matcher actually matches: `call()` does exact-text equality against the
callee expression, and every call site here is `this.copy()`, so `call('copy')` matches **zero** of them
— a silent `matching === 0` (dead-pattern) rather than the intended `matching: 4` (no-majority) case. Running
the rule, not grepping the files, is what this plan's own thesis says to do; re-running it against
`call('this.copy')` reproduces the claimed numbers exactly. The rule passes today either way, and the
test file that shipped it green has nothing to say about it.

**This is not discovery; it is liquidation.** [Bug 0077(A)](../../bugs/0077-a-non-empty-examined-count-proves-neither-falsifiability-nor-scope.md)
filed this exact case — the identical rule, the identical measurement, all four guards green — on 2026-08-09,
and its "why it probably cannot be mechanised" section proposed the candidate: _"a rule is falsifiable if some
single-element perturbation of its examined set changes its verdict, which is expensive but not obviously
impossible for the smell families."_ The vacuity matrix audits `.:smells.inconsistentSiblings: 'fail-open'`
(`tests/matrix/vacuity-matrix.test.ts:118`). This plan answers 0077's explicit request that someone check
whether a cheaper mechanical proxy exists — one does. The mission of ts-archunit is to **catch bad
architecture**; a divergence-policing detector on a majority-less corpus catches none, while being counted as
coverage. That is the worst state this project exists to make unrepresentable.

## The framing, corrected from the proposal

Proposal 027 sells this as _"extending ADR-009's evidence standard."_ That is the one thing wrong in it, and
it matters because it misplaces the argument.

- **This is not a vacuity hole.** Vacuum is ∀ over ∅ — a rule that examined nothing. ADR-009 is
  **satisfied** here: `examined: 11` is non-empty, counted at the family's own seam, faithfully. The floor
  is _correct_ to pass it. If this were vacuity, 0099 would already catch it and this plan would be redundant.
- **It is the adequacy hole** — ADR-009's own Notes name it and hand it off: _"a check can examine 500
  subjects and still assert nothing worth knowing; ADR-008's rules own that."_ Adequacy is explicitly
  **not** ADR-009's job; the compiler enforces evidence is _present_, not that it can _fail_.

So this plan is argued **entirely under ADR-008**, not ADR-009:

- **Rule 1** — "your rule cannot fire" has a non-optional remedy → `bypassFilters`, `error`, unsuppressable.
- **Rule 2** — the remedy must be verified to remediate, and the message must be **true** (drives the pure
  accessor and the strong predicate).
- **Rule 3** — no escape hatch; say what to do instead (the leading remedy, below).
- **Rule 5** — the finding's predicate must have an independent derivation (drives the pure accessor shared
  by both surfaces).
- **Rule 6** — depth ∝ blast radius (small adoptership → one sabotage round).

The distinction is the load-bearing sentence of the plan: **a rule with non-empty evidence that is provably
unable to fire is a different lie than vacuity, and needs a floor ADR-009 deliberately does not draw.**

## The work

All of it lives in `detect()` + one structural hook on `InconsistentSiblingsBuilder`
(`src/smells/inconsistent-siblings.ts`), plus one `DiagnosableRule` member (`src/core/diagnose.ts`). The
split is recomputed by a **pure accessor** — no mutable field state, so both `detect()` and `diagnose()` can
compute it and repeated invocation cannot accumulate. No change to the terminal, the kernel, dedupe, or any
existing public API.

### Phase 1 — a pure split accessor, shared by `detect()` and `diagnose()`

The finding's numbers and truth come from **one pure function**, mirroring `examinedUnits()`'s contract —
_"the SAME method its `collectViolations()` uses — not a parallel derivation"_ (`diagnose.ts:53-56`). A pure
accessor recomputes the partition from scratch every call, so:

- `diagnose()` can call it on a freshly-constructed builder and get **truthful** numbers (the C1 fix);
- repeated terminal invocation cannot double-count, because nothing is accumulated on `this` (the C2 fix).

```ts
/** The corpus split for one pattern — the single type both surfaces share. */
type Assessment = {
  matching: number
  total: number
  canFireSoon: boolean
  folders: { folder: string; matching: SourceFile[]; nonMatching: SourceFile[] }[]
}

/**
 * Pure recomputation of the corpus split — never accumulated on `this`. It is
 * the SINGLE source the finding's message, the gate, and the diagnostic preview
 * all read, so the preview and the finding cannot diverge, and calling it twice
 * cannot double-count (each call recomputes). Mirrors examinedUnits(): one
 * derivation, not an instance field.
 *
 * `canFireSoon` is true when any folder is at or within ONE edit of a majority —
 * such a folder can fire, so it is not inert even though it does not fire today.
 *
 * The GUARD lives here, not at the emit site. A preview read through this
 * accessor can then never report on a rule that can fire: a healthy control
 * (majority present, `editsToMajority <= 1`) gets `canFireSoon = true`, and the
 * hook below returns the empty string for it. The check-time emit and the
 * diagnostic preview share this one predicate by construction.
 */
private inertAssessment(pattern: ExpressionMatcher): Assessment {
  let matching = 0
  let total = 0
  let canFireSoon = false
  const folders: Assessment['folders'] = []
  for (const [folder, files] of this.selected()) {
    const { matching: m, nonMatching } = this.partitionByPattern(files, pattern)
    const t = m.length + nonMatching.length
    // Unreachable today: selected() already filters to files.length >= 2
    // (inconsistent-siblings.ts:65-69) and partitionByPattern drops nothing,
    // so t always equals a folder's file count and is never 0 here. Kept as
    // future-proofing against a change to selected(), not a live branch —
    // review looked for a small-t off-by-one and found none (t ∈ {2, 3} can
    // never be inert for any m; the smallest reachable inert shape is t=4, m=1).
    if (t === 0) continue
    matching += m.length
    total += t
    folders.push({ folder, matching: m, nonMatching })
    // A folder at or within one edit of a majority is a live tripwire. Latched
    // regardless of nonMatching===0: a fully-conforming majority folder is one
    // divergent file away from firing, so it must suppress the inert finding.
    const editsToMajority = Math.ceil(MAJORITY_THRESHOLD * t) - m.length
    if (editsToMajority <= 1) canFireSoon = true
  }
  return { matching, total, canFireSoon, folders }
}
```

**The strong predicate and the guard are the same computation.** The finding fires only when **no** folder is
within one edit of a majority. A 2-of-4 folder (one adopter → reaches threshold) is `canFireSoon = true` → not
inert — and reporting "cannot produce a finding" on it would be false (rule 2) and would spam the least-broken,
most-worth-keeping corpus. The measured 4-of-11 needs three edits to reach 7/11 ≥ 0.6, so it stays inert.

**One pass, not two.** `inertAssessment()` is the ONLY partition walk: it returns the aggregates, and
`detect()` consumes its per-folder partitions for the real violations rather than re-partitioning
(`selected()` is memoized, but the `searchFunctionBody` walk is the dominant cost — do not run it twice per
`check()`). `inertAssessment()` is called once by `detect()` and once inside `inertAdvice()` (for `diagnose()`,
which by design re-runs the pure walk on its own schedule). If implementations find a second walk unavoidable
in `detect()`, that is a measured cost to state, not to absorb silently.

### Phase 2 — the version-gated emit in `detect()`

`detect()` proceeds as today for its real work (producing per-file violations), then consults the pure
accessor for the adequacy branch. No accumulator is stored on the instance — the accessor recomputes.

```ts
protected detect(): ArchViolation[] {
  const pattern = this._pattern
  if (!pattern) return []

  const ruleDescription = this.describe()
  const patternDesc = pattern.description
  const violations: ArchViolation[] = []

  // ONE assessment — the single partition walk. It returns the aggregate
  // (matching/total/canFireSoon) AND the per-folder partitions; detect() uses
  // both. Do NOT call partitionByPattern again below: the searchFunctionBody
  // walk is the dominant cost and must run once per check() (architect I2).
  const a = this.inertAssessment(pattern)

  // Preserves groupByFolder()'s existing violation-ordering contract
  // (tests/integration/coverage-gaps.test.ts: "groupByFolder produces
  // violations sorted by directory") — review caught that an earlier draft
  // dropped this silently, which would have broken a tested public-API
  // guarantee for a smell that never touched groupByFolder() at all. Sorting
  // the returned folder array is O(k log k) on folder COUNT, not a second
  // AST walk: inertAssessment()'s searchFunctionBody pass already ran once,
  // above, and this sort touches only its already-computed output.
  const folders = this._groupByFolder
    ? [...a.folders].sort((x, y) => x.folder.localeCompare(y.folder))
    : a.folders

  for (const { folder, matching, nonMatching } of folders) {
    const total = matching.length + nonMatching.length
    if (matching.length / total < MAJORITY_THRESHOLD) continue
    if (nonMatching.length === 0) continue
    violations.push(
      ...this.buildFolderViolations(folder, matching, nonMatching, ruleDescription, patternDesc),
    )
  }

  // The adequacy floor, VERSION-GATED and SHARED-SOURCE. NOT a floor extension —
  // the real floor fires at violations===0 && examined===0; this fires at
  // violations===0 && examined>0 && no folder is within one edit of a majority.
  // The guard lives in the shared advice function, not here: the emit and the
  // diagnostic preview are the same derivation, so the preview can never report
  // on a rule that can fire. detect() passes the assessment it ALREADY computed
  // (no second partition walk); the empty-string return means "not inert".
  // Calls inertAdviceFor(a) — the private, one-argument shape — directly, NOT
  // the public no-arg inertAdvice() override below: they are two different
  // methods (review caught an earlier draft naming them identically, which
  // does not compile — TS rejects two implementations under one name).
  const advice = this.inertAdviceFor(a)
  if (violations.length === 0 && this.inertEmitEnabled() && advice !== '') {
    return [this.inertViolation(advice, patternDesc), ...violations]
  }
  return violations
}
```

Three gating decisions, each from an existing standard:

- **`a.matching > 0`** — when _no_ examined file matches the pattern, the cause is a dead or narrowed
  pattern, not majority arithmetic. `fileMatchesPattern` is gated on `lineCount >= this._minLines`
  (`inconsistent-siblings.ts:44-48`), so a folder whose candidate bodies are all below `minLines` yields
  `matching === 0` and the message "only 0 of N hold the pattern" would be **false** — it names majority
  arithmetic for what is really a narrowing fault. ADR-008 rule 2's loop. `matching === 0` is **not** routed
  to `narrowingHint()` — that path is guarded on `examinedUnits() === 0` and cannot reach an 11-file corpus.
  It is simply suppressed: the all-below-`minLines` corpus stays silent, exactly as it is today. This is a
  known, honest edge (flagged in Out of scope), not an improvement this plan makes and not a regression.
- **`a.matching > 0` already separates this from the floor.** The real floor fires at
  `violations === 0 && examined === 0` (`terminal-builder.ts:385`); `matching > 0` guarantees `examined > 0`
  (every match is part of the examined set), so the two cannot both fire. The clause stands in for the explicit
  `examinedUnits() > 0` and documents the disjointness.
- **`bypassFilters: true`** → `error` via `severityFor` (`violation.ts:175`), past `.asSeverity('warn')`,
  refused by `.excluding()`, skipped by diff/baseline. Rule 1's shape.

### Phase 3 — the finding producer and the shared message

The message is **one pure function** (`inertMessage`) fed by `inertAssessment`, and **both** `detect()`'s emit
and `diagnose()`'s preview build from it. This is the rule-5 guarantee: the preview string and the finding
string cannot diverge, because they are the same function of the same pure input — not two texts, and not a
field one caller populates before the other reads.

```ts
/**
 * The `DiagnosableRule` hook — public, no-arg, exactly the shape the
 * interface requires. Recomputes `inertAssessment()` fresh, so `diagnose()`
 * on a builder that never ran `check()` still gets truthful numbers.
 *
 * NOT an overload of the private helper below — TypeScript has no such thing
 * as two same-named implementations with different arity/visibility (review
 * caught an earlier draft that wrote it that way; it does not compile). Two
 * distinct methods, one shared derivation: this one recomputes for diagnose();
 * `detect()` calls `inertAdviceFor()` directly with the assessment it already
 * has, so the check-time walk never runs twice.
 */
override inertAdvice(): string {
  const pattern = this._pattern
  if (!pattern) return ''
  return this.inertAdviceFor(this.inertAssessment(pattern))
}

/**
 * THE single derivation for both surfaces, and the guard. Returns the empty
 * string unless the rule is genuinely inert (`matching > 0 && !canFireSoon`),
 * so a healthy control (majority present, or within one edit of one) gets
 * `''` and diagnose() reports nothing for it. Both `inertAdvice()` above and
 * `detect()`'s emit call this with an `Assessment` — the SAME guard and the
 * SAME message either way, so the preview and the finding cannot diverge —
 * the "two texts for one state" trust guarantee from plan 0070.
 */
private inertAdviceFor(a: Assessment): string {
  if (a.matching === 0 || a.canFireSoon) return ''   // the GUARD lives here
  return this.inertMessage(a, this._pattern?.description ?? 'unknown pattern')
}

/** Single source of the inert message. Pure — takes the assessment, returns text. */
private inertMessage(a: { matching: number; total: number }, patternDesc: string): string {
  return (
    `This detector examined ${String(a.total)} sibling files, but only ${String(a.matching)} of them ` +
    `hold the pattern '${patternDesc}', and no folder is within an edit of a majority — so as written it ` +
    `cannot produce a finding today. It reports a file that diverges from what its siblings do; with no ` +
    `majority reachable by adopting files, there is no divergence to report. ` +
    `If this rule asserts a convention the codebase is still adopting, replace it with ` +
    `correspondence().side(...).beComplete(), which fails the day a file falls short — until adoption is ` +
    `complete, so expect that red. If the intent is to police divergence rather than the convention itself, ` +
    `widen the folder so a majority forms, or choose a pattern the sibling files already share.`
  )
}
```

Note the message says "no … majority reachable by adopting files," not "by any single-file edit": a _removal_
of a non-matching file can also raise the ratio toward a majority (4-of-9 → deleting non-matching files reaches
0.6), and deletion is not a sanctioned remedy — so the accessible claim is about the adopter route, and the
message stays literally true. The `''` guard on a non-inert rule means the healthy control is invisible to the
preview — the exact shape diagnose() needs (report nothing that isn't a finding) — and the patternless state
is already reported by `assertionAdvice()` before `detect()` runs.

The finding mirrors `zeroSubjectsViolation` (`terminal-builder.ts:925-953`) and the family-raised config
findings (`correspondence-builder.ts:572/601/626`):

```ts
private inertViolation(advice: string, patternDesc: string): ArchViolation {
  return {
    rule: this.describe(),
    ruleId: this._metadata?.id,
    element: this.inertElement(), // scope-aware — see below and Phase 5 correction 2
    file: '',
    line: 0,
    message: advice,
    // Its own remedy, never the author's (bug 0021): the message IS the remedy.
    suggestion: advice,
    because: this._reason,
    // Adequacy finding: the rule enforces nothing, which is not a severity the
    // author grades (ADR-008 rule 1). Config-level: no file to attribute, so it
    // must survive diff/baseline or the guard re-greens under standard CI.
    bypassFilters: true,
  }
}

/**
 * Dedupe key for the inert finding. `dedupeConfigFindings` keys on
 * `${file} ${ruleId ?? rule} ${element}` (`dedupe-config-findings.ts:111-123`);
 * `file` is always `''` here and `rule`/`ruleId` fall back to `describe()`,
 * which is scope-blind (reads `_pattern` only — `inconsistent-siblings.ts:210-213`).
 * So without a scope-aware `element`, two same-pattern/different-scope inert
 * detectors with no explicit `.rule({id})` would collapse into one finding
 * under `checkAll` — review named this as the risk this method exists to close.
 *
 * Folds in every field `groupFilesByFolder()`/`fileMatchesPattern()` read to
 * decide what's examined — `_folders`, `_ignorePaths`, `_ignoreTests`,
 * `_minLines` — sorted so option order cannot split one semantic scope into
 * two keys. Two rules with identical scope correctly collapse to one finding
 * (one edit fixes both); two rules differing in ANY of these stay distinct.
 */
private inertElement(): string {
  const patternDesc = this._pattern?.description ?? 'unknown pattern'
  const folders = [...this._folders].sort().join('|')
  const ignorePaths = [...this._ignorePaths].sort().join('|')
  return `inert:${patternDesc}:${folders}:${ignorePaths}:${String(this._ignoreTests)}:${String(this._minLines)}`
}
```

**The leading remedy is `correspondence().beComplete()`, and it is the resolution of the forming-team case.**
A team mid-way through adopting a convention across 4-of-11 files is doing something reasonable — and the
finding must not force them to either widen (changes what the rule enforces) or abandon the pattern (drops the
convention). The correct instrument for "every builder will eventually call `copy()`" already exists:
`correspondence().side(...).beComplete()`. It leads the remedy because it is the **only one structurally
guaranteed to remediate** any "every X holds Y" intent regardless of current adoption: `beComplete()` asserts
the positive, preserves the author's actual goal, and fails — honestly, until adoption is complete — the day a
file falls short. The message says that explicitly (a mid-adoption team swapping rules should expect the red),
so the remedy does not surprise the reader. Widen-the-folder and choose-a-shared-pattern follow as the
intent-flexible alternatives, and the message says so — rule-2's ordering matters because an agent applies the
first remedy listed. Naming the guaranteed instrument makes rule-2's non-optionality honest — the reader is
told the sanctioned path for their _actual_ intent — and satisfies ADR-008 rule 3 ("no escape hatch, say what
to do instead"). The finding is error because a divergence-policing detector with no majority reachable by
adopting files is policing nothing while being counted as coverage; the message is complete because the
legitimate still-forming intent has a named home.

**Review found the remedy named but not shown — no worked example of the `.side()`/`KeyFn` construction
existed anywhere in the docs or codebase, and the finding is `bypassFilters: true` (unsuppressable), so a
reader who cannot self-serve the swap is stuck.** `correspondence()`'s `.side()` needs a selection plus a
`KeyFn` per side (`docs/api-reference.md:378`); there is no existing predicate for "selection by call-body
content," only conditions (`contain()`/`notContain()`), so the second side has to come from the `calls()`
entry point with a hand-written `KeyFn`. For the measured case (`inFolder('**/src/builders/**')
.forPattern(call('this.copy'))`), the replacement that makes the same intent falsifiable is:

```ts
import { correspondence, classes, calls, byName, type KeyFn } from '@nielspeter/ts-archunit'
import type { ArchCall } from '@nielspeter/ts-archunit'

const byEnclosingFile: KeyFn<ArchCall> = (c) => c.getSourceFile().getBaseNameWithoutExtension()

correspondence(p)
  .side('builders', classes(p).that().resideInFolder('src/builders/**'), byName())
  .side('callers-of-copy', calls(p).that().withMethod('copy'), byEnclosingFile)
  .should()
  .beComplete()
  .rule({ id: 'builders/every-builder-copies', because: 'every builder must implement copy()' })
  .check()
```

This is the artifact the inert message's leading remedy points to — it belongs in the shipped docs (the
message text or `docs/smell-detection.md`), not only in this plan, so an agent reading the error at N+1 can
copy it rather than invent a `.side()` wiring under review pressure.

**Severity derives from the leading remedy.** The error slot is justified only because
`correspondence().beComplete()` exists as a structurally-verifiable replacement. If a future revision trims or
weakens that remedy, the severity must be re-reviewed — this dependency should be stated in the release note
so a change to the remedy forces a severity decision, not a silent text edit.

### Phase 4 — the `DiagnosableRule` member and the version gate

Two mechanical additions, both following existing precedent:

**The hook.** Add `inertAdvice?(): string` to the `DiagnosableRule` interface (`src/core/diagnose.ts:23-102`)
and implement it on `InconsistentSiblingsBuilder`. **`diagnose()` must be given a distinct emission branch**
(not the `zeroSubjectsFinding` path — that is guarded on `examinedUnits() === 0`, and the inert case has
`examined = 11`, so it can never fire for this finding): when `rule.inertAdvice?.()` returns a non-empty
string, report it verbatim, exactly as `zeroSubjectsAdvice` is reported (`diagnose.ts:431`). The predicate is
already in the hook: `''` for any non-inert rule, so diagnose reports nothing for the healthy control. Because
the guard lives in the same method as the message, the preview and the check-time finding share one
derivation — the "two texts for one state" trust guarantee, and the check-time emit cannot diverge from what
the preview showed. Optional, so no existing rule or external dialect (ADR-010) is affected — the same
non-breaking shape `assertionAdvice`, `zeroSubjectsAdvice`, `declaresEmpty` all use. It is read by `diagnose()`
on **every** release; only the check-time emit is version-gated.

**The new `DiagnosticFinding['kind']` literal.** Review named this as unspecified; it is a closed union
(`src/core/diagnose.ts:113-140`) so the branch will not compile without one. Add `'inert'`, doc-commented in
the same style as the existing members — distinct from `'zero-subjects'` (`examinedUnits() === 0`; this fires
when `examinedUnits() > 0`) and citing ADR-009's own Notes, which hand exactly this class to ADR-008:

```ts
readonly kind:
  | 'dead-glob'
  | 'no-condition'
  | 'project-unknown'
  | 'project-empty'
  | 'zero-subjects'
  /**
   * A rule whose evidence is non-empty but which is structurally unable to
   * ever produce a finding as configured — plan 0102. Distinct from
   * `'zero-subjects'`: that fires when `examinedUnits() === 0`; this fires
   * when `examinedUnits() > 0` but the family's own adequacy predicate
   * (`inertAdvice?()`) says the rule can never fail regardless. ADR-009's
   * Notes hand this class to ADR-008 explicitly: "a check can examine 500
   * subjects and still assert nothing worth knowing."
   */
  | 'inert'
  | 'orphan-exclusion'
```

The producer mirrors `zeroSubjectsFinding` (`diagnose.ts:395-434`) — a small function that reads
`rule.inertAdvice?.()`, returns `undefined` when it's absent or empty, and otherwise returns
`{ kind: 'inert', rule: name, advice }` — called from the same tail of `diagnose()`'s per-rule pipeline that
already calls `zeroSubjectsFinding`. `tests/archunit/dogfood.test.ts`'s existing
`diagnose(BUILT).map(f => \`${f.kind}: …\`)` assertion (`dogfood.test.ts:412-417`) is the place a wrong or
missing `kind` literal surfaces first — add it to the Test inventory below.

**The gate.** A module-level feature constant that the flip release turns on, read by `inertEmitEnabled()`:

```ts
// src/smells/inconsistent-siblings.ts
/** 0102: diagnostic-first. N ships false (diagnose previews, check passes); the
 *  flip release sets true (check fails). Not a warn-first migration. */
const INERT_FINDING_EMIT = false

// ...
protected inertEmitEnabled(): boolean {
  return INERT_FINDING_EMIT && !this.declaresEmpty()
}
```

`&& !this.declaresEmpty()` is the `_expectEmpty` precedence (correction below) — a declared-empty rule
reports its expiry, not the inert finding, so the two never double-report.

`INERT_FINDING_EMIT` is deliberately a bare, non-exported module `const` — not an env var, constructor
option, or per-project override. State this explicitly in the implementation (not just in this plan): the
`bypassFilters: true` / unsuppressable design in Phase 3 depends on there being no configuration surface a
future contributor could "helpfully" expose, which would undermine it silently.

### Phase 5 — the corrections the proposal got wrong

1. **The corpus-level counts are not "already held."** The proposal claims the rule "already knows" the
   numbers. True per-folder, false corpus-wide: `detect()` computes a split and discards it each iteration.
   `inertAssessment()` is the honest recomputation behind that sentence. Do not let the plan or its review
   assert the numbers exist for free.
2. **checkAll dedupe keys on `(file, ruleId ?? rule, element)`, not on `ArchViolation.identity`.**
   `dedupe-config-findings.ts:111-123`. `identity` is baseline hashing (`violation.ts:328`), a different job.
   Non-collision with per-file findings is **structural**: this finding has `file: ''`, every per-file finding
   has a real path, so the keys cannot collide on the `file` component regardless of any string. But
   `element: 'inert'` as a constant is **not** enough: two detectors with the same `forPattern` but different
   `inFolder` scopes, both inert, with no `.rule({ id })` set, would collapse into one under `checkAll` — and
   same-pattern/different-scope is the most common way to deploy this detector. `inertElement()` (implemented
   in Phase 3, above) derives the dedupe key from the pattern **and** every scope-affecting field
   (`_folders`, `_ignorePaths`, `_ignoreTests`, `_minLines`, all sorted so option order can't split one scope
   into two keys) so distinct rules stay distinct; identical rules still collapse (one edit → one finding).
3. **The `expectEmpty`/expiry precedence.** If a user declares `.expectEmpty()` on a majority-less corpus,
   the expiry branch (`terminal-builder.ts:420-422`) returns `[expiredDeclarationViolation, ...violations]`;
   `inertEmitEnabled()`'s `&& !this.declaresEmpty()` suppresses the inert emit, so one rule yields one finding.
4. **`groupByFolder()`'s violation-ordering contract is preserved, not silently dropped.** An earlier draft's
   `inertAssessment()` built `folders` by iterating `selected()` directly, and Phase 2's `detect()` consumed
   that order unmodified — silently losing the sort `detect()` applies today when `_groupByFolder` is true
   (`inconsistent-siblings.ts:189-190`), which `tests/integration/coverage-gaps.test.ts` tests by name
   ("groupByFolder produces violations sorted by directory") and which the plan's own "no change to any
   existing public API" claim depends on. Review caught this by tracing the real source, not by reading the
   plan's prose. Fixed in Phase 2: `detect()` sorts the folder array returned by `inertAssessment()` — an
   O(k log k) sort on folder count, not a second AST walk — when `_groupByFolder` is set, exactly reproducing
   today's order.

## Files changed

| File                                                                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/diagnose.ts`                                                                                     | add `inertAdvice?(): string` to `DiagnosableRule` (optional structural member, parallel to `zeroSubjectsAdvice`); add the `'inert'` `DiagnosticFinding['kind']` literal (Phase 4); add the `inertFinding()` producer, mirroring `zeroSubjectsFinding`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/smells/inconsistent-siblings.ts`                                                                      | `Assessment` type + `inertAssessment()` (pure split accessor) + version-gated emit in `detect()` (now also preserving `_groupByFolder`'s existing sort — Phase 5 correction 4) + `inertViolation()` + `inertMessage()` + `inertElement()` + `inertAdvice()` override + `inertAdviceFor()` + `inertEmitEnabled()` + the `INERT_FINDING_EMIT` gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/smells/inconsistent-siblings.test.ts` + `tests/fixtures/smells/inconsistent-siblings/repositories/` | corrected from an earlier draft, which named a test file (`tests/archunit/inconsistent-siblings.test.ts`) that does not exist and never mentioned the real one. **This is the file the existing `'does not flag when no majority exists'` test lives in, and review found it structurally inert under the new predicate as written** (`forPattern(call('parseInt'))` is 1-of-4, `editsToMajority = 2 > 1`) — it would start throwing at the N+1 flip with no plan-side acknowledgment. Fix: add a fifth fixture file to the existing corpus (also calling `parseInt`, mirroring `legacy-repo.ts`'s shape) so the pattern becomes 2-of-5 — still below majority (`.not.toThrow()` still holds, unchanged intent) but `editsToMajority = ceil(3.0) − 2 = 1 ≤ 1`, so `canFireSoon = true` and the fixture is no longer inert. This single addition also supplies the "2-of-N boundary, not inert" fixture the Test inventory needs (see below) — no separate new fixture directory required. |
| `tests/archunit/dogfood.test.ts`                                                                           | the poisoned row is re-added as the _asserted_ finding, not the shipped green; extend the existing `diagnose(BUILT).map(f => \`${f.kind}: …\`)`assertion to cover the new`'inert'` kind                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/smell-detection.md`, `docs/upgrading.md`, `docs/api-reference.md`                                    | the new finding + the N/N+1 upgrading row (see Release, including the affected-population sentence and rollback guidance review asked for) + the worked `correspondence().beComplete()` example (Phase 3) landing where the message points, not only in this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

No change to `terminal-builder.ts`, `smell-builder.ts`, `dedupe-config-findings.ts`, or `violation.ts`. The
public surface this adds to `DiagnosableRule` is one optional-structural member — `?` on the interface — so
no external dialect (ADR-010) breaks. This is the ADR-008 adequacy floor at a per-family seam — it must not
touch the ADR-009 machinery.

**`tests/matrix/vacuity-matrix.test.ts:118`'s `.:smells.inconsistentSiblings: 'fail-open'` row does NOT
change, and review flagged this needs saying explicitly rather than left to be inferred.** It is tempting to
read the Problem section's citation of that row as implying it becomes stale once this ships; it does not.
The row audits _vacuity_ (an empty `examined` set passing), and this plan's own central argument — "The
framing, corrected from the proposal," above — is that the measured case is **not** a vacuity hole:
`examined: 11` is non-empty and the floor is correctly satisfied. `'fail-open'` remains the honest label for
the vacuity axis; this plan adds a finding on the separate adequacy axis ADR-009's Notes hand to ADR-008. If
a future change makes the matrix track adequacy too, that is out of scope here.

## Test inventory

**The measured case fails with the numbers in the message.** `inFolder('**/src/builders/**')
.forPattern(call('this.copy'))` → the inert finding, `examined: 11` / `matching: 4` readable in the message.
(Replaces today's green assertion on exactly this rule.)

**The healthy control stays green — and can fire.** `forPattern(call('validateOverrides'))` over
`src/presets/**` (excluding `index.ts`, `shared.ts`): measured 5 examined, all 5 call it in a function body,
`matching = 5/5` majority, `nonMatching = 0`. It stays green (no inert finding — `canFireSoon` is latched), is
one edit from red, **and its preview is silent**: `diagnose(rule)` on the healthy control reports nothing,
because `inertAdvice()` returns `''` when `canFireSoon` is true. This is the C1 regression test — the preview
must not report on a rule that can fire.

**The sabotage still reds.** Deleting `validateOverrides` from one preset (the 026-descendant guard) →
`4/5 ≥ 0.6` majority, `nonMatching = 1` → the real finding fires, and the inert finding does not mask it.

**The mixed-folder corpus does not raise it.** `inFolder('**/src/**')` across a majority folder (presets)
and a non-majority folder (builders): `canFireSoon` true (presets are majority) → no inert finding, real
violation still fires.

**All-conforming majority is NOT inert (the latch placement).** A folder where matching is total
(`nonMatching === 0`) but `≥ 0.6` — the presets control is exactly this — must **not** report inert. This is
the sabotage row for the latch: it is computed from `editsToMajority <= 1`, i.e. before the `nonMatching===0`
notion enters, so a reversion to "latch only when a divergent file exists" makes the healthy control fail.

**Strong vs weak (the resolved open question), on a real fixture, not a hypothetical.** Review found the
plan described a "2-of-4 folder" for this row without naming where it comes from, and separately found that
the _existing_ `tests/smells/inconsistent-siblings.test.ts` fixture (`repositories/`, `forPattern(call('parseInt'))`,
1-of-4) is itself inert under the new predicate and would silently start throwing at the N+1 flip. One fixture
change fixes both: add a fifth file to `repositories/` that also calls `parseInt`, making it 2-of-5 —
`canFireSoon` is true because `ceil(0.6 × 5) − 2 = 1 <= 1`, so it does **not** report inert (the existing
`'does not flag when no majority exists'` test's `.not.toThrow()` keeps holding, unchanged intent, and stays
true at N+1 too). The measured 4-of-11 (`ceil(0.6 × 11) − 4 = 3 > 1`) still reports inert. This pins the
strong predicate against a real fixture the suite already runs, not an invented one.

**`matching === 0` is never reported as inert.** A folder whose bodies are all below `minLines` (or a dead
pattern) yields zero matches; the inert finding is suppressed and the existing narrowing/dead-pattern
diagnosis owns it. The message "only 0 of N hold the pattern" must never fire (rule 2).

**Diagnose does not require the flip — the pure-accessor guarantee.** On `INERT_FINDING_EMIT = false` (N),
`diagnose(rule)` on a **freshly-constructed builder** reports the inert advice with **truthful** numbers
(`examined 11 / matching 4`), because `inertAdvice()` recomputes via `inertAssessment()` — `diagnose()` does
not need to have run `detect()` first. This is the test that was impossible when the message read
detect-populated state. Assert the numbers by pattern (`toMatch(/examined \d+.*only \d+/)`) rather than
pinning the literal `11`/`4` a second time — the literal is already pinned once, in the measured-case row
above; review flagged that pinning it twice couples an unrelated future change to `src/builders/` to two
tests instead of one.

**`diagnose()` reports the new `'inert'` kind, not `'zero-subjects'`.** `diagnose([measuredCaseRule])` returns
a finding with `kind: 'inert'` (not `'zero-subjects'`, which cannot fire here since `examinedUnits() === 11`).
Extend `tests/archunit/dogfood.test.ts`'s existing `diagnose(BUILT).map(f => \`${f.kind}: …\`)`assertion to
cover it — the place review named as where a missing or wrong`kind` literal would first surface.

**The "one pass, not two" claim is guarded, not just commented.** Review found no test could distinguish one
`searchFunctionBody` walk from two — `partitionByPattern` is pure, so re-partitioning would silently produce
identical output. Add a call-count assertion (`vi.spyOn` the module's `searchFunctionBody` import, or the
class's `partitionByPattern`) around one `check()` on the measured case, asserting it runs once per file, not
twice. Without this, the sabotage row "re-partition in `detect()` instead of consuming `inertAssessment()`'s
folders" (below) has nothing to catch it failing.

**`groupByFolder()`'s ordering survives the rewrite.** `smells.inconsistentSiblings(p).forPattern(...).groupByFolder()`
against a multi-folder inert-and-real-violation mix produces violations in the same folder-sorted order the
pre-0102 `detect()` produced — verified by comparing against `tests/integration/coverage-gaps.test.ts`'s
existing "groupByFolder produces violations sorted by directory" assertion pattern for a fixture with more
than one violating folder.

**Repeated invocation cannot double-count.** A held builder called through `check()` then `violations()`, or
twice through `checkAll`, reports `examined 11 / matching 4` both times — never `22 / 8` — because
`inertAssessment()` recomputes and nothing accumulates on the instance.

**The flip is one line and it is pinned.** On `INERT_FINDING_EMIT = true` (N+1), the same rule fails
`check()` with the identical string `diagnose()` previewed on N — both build from `inertMessage(inertAssessment())`.

**Remedies are verified to remediate (ADR-008 rule 2), in the order the message presents them.** The
`correspondence().beComplete()` replacement leads, because it is the only one structurally guaranteed to
remediate regardless of adoption: the exact `.side()`/`KeyFn` construction from Phase 3's worked example
(`correspondence(p).side('builders', ...).side('callers-of-copy', calls(p)..., byEnclosingFile).should().beComplete()`)
clears the inert finding, run as a real fixture test — not just asserted in prose (do not re-test
`correspondence()` itself — only that the swap clears). "Choose a shared pattern" is verified against the
`validateOverrides` replacement, which clears the inert finding. "Widen the folder" is verified against the
measured case: a rule inert at `inFolder('**/src/builders/**')` widened to `inFolder('**/src/**')` reaches a
majority and produces real rather than inert findings — but this is corpus-conditional, which is precisely
why it is not the leading remedy.

**Sabotage matrix** (each row must red, one sabotage round per rule 6):

| Revert                                                                                                                     | Must red because                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete `inertViolation()` and the emit                                                                                     | The measured case reverts to green                                                                                                                                                             |
| Turn `inertAssessment()` into accumulated fields                                                                           | `inertAdvice()` on a fresh builder reports 0/0 (false), or repeated `check()`+`violations()` double-counts — the diagnostic-first guarantee breaks                                             |
| Make `inertAssessment()` return a stale/cached value it doesn't recompute                                                  | A held builder's second `check()` reports old counts                                                                                                                                           |
| Move the `canFireSoon` latch to "only when a divergent file exists"                                                        | The all-conforming presets control falsely reports inert                                                                                                                                       |
| Drop the `editsToMajority <= 1` suppression (weak predicate)                                                               | The 2-of-5 fixture (`repositories/` + the added `parseInt` caller) falsely reports inert — rule 2 message is false                                                                             |
| Remove the `matching > 0` gate                                                                                             | The all-below-minLines corpus reports "0 of N hold the pattern"                                                                                                                                |
| Change `bypassFilters` to false / sever to warn                                                                            | The finding becomes suppressible/optional — rule 1 violated                                                                                                                                    |
| Constant `element: 'inert'` instead of scope-aware `inertElement()`                                                        | Two same-pattern/different-scope inert detectors collapse under `checkAll`                                                                                                                     |
| Drop any one field (`_folders`/`_ignorePaths`/`_ignoreTests`/`_minLines`) from `inertElement()`'s fold, or don't sort them | Two rules differing only in that field collapse under `checkAll`; unsorted, `inFolder('a').inFolder('b')` and `inFolder('b').inFolder('a')` — the same scope — falsely split into two findings |
| Emit the inert finding when `declaresEmpty()`                                                                              | The `expectEmpty` expiry double-reports one rule                                                                                                                                               |
| **`inertAdvice()` and the finding use different message functions**                                                        | `diagnose()` previews one string, the finding says another — plan 0070's exact trust defect                                                                                                    |
| **Move the guard out of `inertAdvice()` back to the emit site**                                                            | The healthy-control preview reports falsely ("5 of 5 hold the pattern… no majority") — C1 regression                                                                                           |
| **`inertAdvice()` returns a message (not `''`) for a non-inert rule**                                                      | The healthy-control preview and the check-time emit both report on a rule that can fire                                                                                                        |
| **Revert the `INERT_FINDING_EMIT` gate to false** on the flip                                                              | The N+1 `check()` tests go green — the flip is masked                                                                                                                                          |
| `diagnose()` stops reading `inertAdvice()`                                                                                 | The N-phase loses its preview — the migration instrument disappears before the flip                                                                                                            |
| **Re-partition in `detect()` instead of consuming `inertAssessment()`'s folders**                                          | The `searchFunctionBody` walk runs twice per `check()` — caught only by the call-count assertion above, not by any functional test (review: architect + testing, independently)                |
| **Drop the `_groupByFolder` sort on `inertAssessment()`'s returned folders**                                               | A multi-folder `groupByFolder()` rule's violations stop being directory-sorted — silently breaks a tested public-API guarantee (review, verified against `inconsistent-siblings.ts:189-190`)   |
| Add the fifth `repositories/` fixture file without also calling `parseInt`                                                 | The `'does not flag when no majority exists'` test's fixture stays 1-of-4 (genuinely inert) and starts throwing at the N+1 flip, unnoticed by this plan — the exact gap review found           |

## Release

Two events, per ADR-008 rule 1's migration corollary. The mechanism is a **version-gated emit**: the finding
is always _computable_ via the pure accessor, and `diagnose()` can always reach it through the structural
hook; only the check-time emit is turned on by the flip.

**Correction (review):** an earlier draft called this "identical to the 0.59.0 vacuity-gate migration."
Checked against `docs/upgrading.md:40,99`, that is not accurate — 0.59.0 is explicitly the **exception** to
the usual shape: it shipped its diagnostic and its gate **together, in one release**, with "pin to 0.58.x" as
the rollback valve. What this plan proposes — a genuine two-release, same-source-tree, hand-flipped-constant
migration — has no prior instance in this repo's history that review could find. Say that plainly rather than
borrow an authority that does not transfer: this is the first time this exact mechanism is exercised, so the
sabotage-matrix rows guarding it (below) carry more weight than precedent does. What 0.59.0 _does_ share with
this plan is narrower and still true: the doctor preview cannot reach rule files that import a test runner
(ADR-008 rule 1's corollary), and `diagnose()` inside the suite is the documented path for those users, same
as 0.59.0.

- **N (diagnose-first, `INERT_FINDING_EMIT = false`).** `inertAdvice()` is added to `DiagnosableRule` and
  reported verbatim by `diagnose()`/`doctor`, but `inertEmitEnabled()` returns false, so `check()` still
  passes. The migration instrument derives from the **new** finding path by construction: `diagnose()` reads
  the same `inertMessage(inertAssessment())` the flip emit composes — a pure function of pure input, so there
  is no second text for the preview to drift from, and `diagnose()` needs no prior `detect()` run to report
  truthful numbers. No `warn()`-first migration: a warning is invisible in a test run (bug 0024) and trains
  suppression.
  - **Self-check before upgrading, without waiting for N.** `docs/smell-detection.md` already documents the
    60% majority rule publicly, so a user can check today, on their current version, without adding a
    `diagnose()` assertion: _"if your `forPattern` matches in under 60% of a scoped folder's files, this
    plan will eventually flag that rule."_ State this plainly in the `docs/upgrading.md` row — review found
    the only self-check this plan otherwise offers is "upgrade to N, then proactively add a `diagnose()`
    assertion in a test file," which is opt-in and easy to skip, unlike the runnable preview commands the
    other rows in that file give.
- **N+1 (flip, `INERT_FINDING_EMIT = true`).** `check()` fails on the rules `diagnose()` previewed on N. The
  `docs/upgrading.md` row must give this the same level of detail as its 0.57.0–0.59.0 neighbours (review:
  those rows each state the affected population up front, enumerate every suppression mechanism that does
  _not_ work, and give a rollback path — this plan's Release section only gestured at assembling that, so
  spell it out here):
  - **Affected population:** a `smells.inconsistentSiblings(...)` rule that passes today with
    `examined > 0 / violations: 0` and no folder within one edit of a majority.
  - **There is no suppression flag.** `.excluding()`, baseline, and `.asSeverity('warn')` do not apply
    (`bypassFilters: true`) — this is a deliberate ADR-008 rule-1 choice (Out of scope), not an oversight.
  - **Remedies**, in the order the message presents them: `correspondence().beComplete()` (structurally
    guaranteed, Phase 3's worked example), widen the folder, or choose a pattern the siblings already share.
  - **Rollback:** pin to the last N-series version while applying a remedy, the same guidance this project
    gives for every other unsuppressable finding (0.59.0's floor). State it here now, not improvised at
    flip time.
  - **The flip must be a scheduled deliverable, not a hoped-for follow-up.** Review's strongest release-level
    finding: nothing in the plan as drafted _forces_ N+1 to happen — the only guard is a sabotage row for
    _reverting_ an already-shipped flip, which cannot exist until the flip PR does, and no flip PR is
    scheduled. `INERT_FINDING_EMIT = false` sitting in `main` indefinitely is the same "permanent, trained
    suppression" shape this project designed against with `.expectEmpty()` (CHANGELOG 0.59.0), with the
    emit gate replacing the escape hatch. Before N ships, file the N+1 flip as its own tracked plan
    (referenced from this plan's header and from `INERT_FINDING_EMIT`'s own code comment, e.g. "flip
    tracked in plan NNNN"), so the flip is a scheduled deliverable with an owner and a landing point — not a
    property of this plan's prose. The N+1 test (`check()` fails with the identical string `diagnose()`
    previewed on N) cannot be written until that PR exists; it belongs to that PR's own test inventory, not
    to this one's. **Filed: [plan 0105](../0105-the-inert-finding-flipped.md).**

The gate is a single module constant, so the flip is one owned, reviewed line and the sabotage matrix can pin
it (row: reverting the gate to false makes the N+1 tests green — the flip is not masked).

## Out of scope

- **Not general falsifiability.** No claim about families that cannot cheaply self-assess, and none about
  `defineCondition` bodies — ADR-009's Notes name these as review-enforced residue.
- **Not a replacement for sabotage** (026 is the general method; this catches one species at runtime).
- **Set-membership families stay out, by measurement.** `correspondence` / `crossLayer.haveMatchingCounterpart`
  emit on `missing = A \ B` — falsifiable by one insertion always; "silent today" is mere absence, not
  impossibility. Only a threshold predicate over held counts has an inert region. Do not port the hook.
- **Partial inertness out of scope.** The finding is corpus-level, raised when **no** folder is within one
  edit of a majority. A rule that fires in some folders and is inert in others reports nothing — documented
  as a follow-on, not silently shipped as "covered."
- **The `minLines` boundary is a known edge, not solved here.** `fileMatchesPattern` counts below-theshold
  bodies as non-matching (`inconsistent-siblings.ts:44-48`), so a corpus where the real pattern-holders sit
  just under `minLines` can be mis-measured by the assessment. The `matching > 0` gate catches the all-below
  case; the _partial_ case (some holders under `minLines`) is a pre-existing ambiguity in how this detector
  counts, orthogonal to inertness, and is flagged as an open question rather than claimed resolved.
- **`duplicateBodies` stays untouched** (it is itself broken — bug 0076). This plan does not fix that detector.
- **Deletion, not just adoption, can also raise a folder toward a majority — deliberately excluded from
  `canFireSoon`.** `editsToMajority` only counts the adopter route (a non-matching file starting to match);
  removing a non-matching file (4-of-9 → delete the 5 non-matching → 4/4) also raises the ratio, but deletion
  is not a sanctioned remedy, so it must not suppress the finding. This was previously a parenthetical under
  Phase 3's message text; review asked that it be named as a scope boundary here too, where a reader
  scanning Out of scope would expect to find it.
- **No declaration escape hatch.** A self-arming "dormant until a majority forms" declaration is refused
  deliberately. The finding already self-disarms the moment any folder reaches a majority, so a declaration
  buys nothing except permanent silence for a rule that is policing nothing — the trained-suppression dynamic
  ADR-008 rule 1 and the `allowEmpty`→`expectEmpty` history exist to prevent. The legitimate still-forming
  intent is served by the leading remedy (`correspondence().beComplete()`), which is a different, correct
  instrument, not a hatch on this one.

## Resolved by review

Two rounds: an initial architect+product pass during authoring resolved the two items below; a five-persona
review of the finished plan (2026-08-12) found and fixed the compile error, the `groupByFolder` regression,
the existing-test gap, the unguarded performance claim, and the release-mechanism issues threaded throughout
the sections above (see **Implements**, at the top, for the summary).

**Weak vs strong predicate: resolved to strong.** Both review lenses independently concluded it, and bug
0077(A) filed the exact candidate ("single-element perturbation changes its verdict") that the strong reading
implements. Weak is false at the margin: a 2-of-4 folder _can_ fire on one edit, so "cannot produce a finding"
would be untrue (rule 2) and would spam the least-broken corpus. Strong is true of everything it reports,
drops the near-threshold cases that are one adopter from working, and preserves the 4-of-11 case this plan
exists to catch.

**The diagnostic-first preview is rebuilt around a pure accessor.** Earlier drafts raised the finding's
message from instance fields populated by `detect()`; `diagnose()` does not run `detect()`, so the preview
could not have reported truthful numbers on a fresh builder, and repeated invocation double-counted. The shift
to pure `inertAssessment()` — recomputed per call, read by both `detect()` and `diagnose()` — makes the
two-surfaces-one-string guarantee real rather than asserted, and is safe under repeated terminal invocation.
This is the same "one derivation, not a field" lesson `examinedUnits()` records (`diagnose.ts:53-56`), applied
one level down.

# ADR-009: A Pass Is Constructed From Evidence

## Status

**Proposed** (2026-08-06; revised the same day after a two-lens review corrected two factual claims —
the GraphQL families are shipped, not scheduled, and a root-namespace enumeration cannot see them — and
added five rulings the first draft left open: presets, the empty-project precedence, `allowEmpty`, the
seam binding, and the enumeration source). This is the mechanical subset
[ADR-008](./008-agent-first-failure-surfaces.md)'s Alternatives section said to watch for — _"worth
revisiting if a mechanical subset emerges"_ — emerging on the fourth recurrence of the vacuous-pass class
([bug 0066](../bugs/fixed/0066-a-smell-detector-over-zero-files-passes.md)). It does not amend ADR-008. It
promotes one consequence of it — a check that examined nothing must not read as green — from
review-enforced to **unrepresentable**.

## Context

ts-archunit's one load-bearing asset is that its green is a measurement. The primary consumer is an AI
agent (ADR-008, Context): it does not skim logs, does not notice "0 files", and treats CI green as
permission to move on. A verifier whose instrument failure is indistinguishable from architectural
cleanliness is worth less than no verifier, because it is counted as coverage. That was the trap of every
release before 0.18.0: the tool **failed open**. A dead glob, a solution-style tsconfig loading zero
files, a selector narrowing to nothing — every misconfiguration collapsed into the same output as "the
architecture is clean".

Since 0.18.0 that class has been closed wave by wave. Each wave was complete over the families in view,
and each was followed by the discovery of a family outside the view:

| Wave                                                                                                                                                                            | What it closed                                                                                         | What was found outside it                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **v0.18.0** (2026-07-24) — discovery level                                                                                                                                      | Empty slice / crossLayer / boundary discovery fails; `.expectNonEmpty()` ships as opt-in               | Selection-level vacuity: 17 of our own dogfood rules selected nothing ([bug 0011](../bugs/fixed/0011-dogfood-rules-select-nothing.md))                                               |
| **v0.34.0** (2026-08-01) — selection level ([plan 0069](../plans/completed/0069-no-rule-may-certify-nothing.md), [0074](../plans/completed/0074-r3b-the-selector-glob-flip.md)) | An unsatisfiable selector glob and an empty selection are unsuppressable configuration findings        | An empty **project** was mis-blamed as a dead glob ([bug 0048](../bugs/fixed/0048-the-dead-glob-gate-blames-the-glob-when-the-project-is-empty.md))                                  |
| **Bug 0048's fix** — attribution                                                                                                                                                | The empty-project diagnosis, correctly attributed, with the message naming the project-references case | The diagnosis was sited inside the dead-glob gate, so it silently inherited that gate's precondition: _the rule declares a glob_                                                     |
| **Bug 0066** (2026-08-05) — the smell family                                                                                                                                    | Nothing yet                                                                                            | Bare `smells.duplicateBodies().check()` over zero source files passes. Measured cost on one corpus: **401 findings reported as clean** across two apps with solution-style tsconfigs |

The fifth surface is not scheduled — **it already shipped**. The spec still files the GraphQL extension
under Phase 3, but `src/graphql/` publishes two more `TerminalBuilder` families today behind the
`./graphql` subpath, and `package.json` exports twelve subpaths in all (the root, `./graphql`,
`./presets`, nine `./rules/*`). The only enumeration that guards any of them is a hand-maintained two-module list —
`[rootExports, graphqlExports]` in `tests/core/assertion-gate.test.ts` — which a thirteenth subpath will
not join. The first draft of this ADR itself claimed GraphQL was "scheduled for Phase 3", because the
spec's prose says so: a binding-ADR draft misstating which families exist is itself the argument for
deriving the enumeration from the shipped artifact rather than from anything hand-written.

Two facts from bug 0066 decide the shape of this ADR:

1. **Sharing the seam's code is not sharing its guarantee.** `SmellBuilder` extends `TerminalBuilder`
   (`src/smells/smell-builder.ts:16`). The family that failed open was _inside_ the shared base class the
   whole time. It failed open anyway, because the guard is written as a conditional fault-check —
   _"which of these declared globs is dead?"_ — and every precondition of a conditional check is an early
   return that reads as green. A guard that asks "is anything wrong?" has exits. An invariant that demands
   "prove something was examined" has none.
2. **No enumeration derived from the work will contain the next family.** ADR-008 rule 5's omission
   corollary — _code never written has no line to revert_ — is not just a review hazard here; it is the
   mechanism of all four waves. Every wave's scope was enumerated from the diffs and bug reports of the
   surface where the defect appeared. The next family, by construction, appears in none of them.

## Decision

> **A passing verdict is constructed from evidence of examination: a non-empty set of examined units,
> counted at the family's own examining seam — or an explicit declared-empty token. Zero loaded source
> files outranks any token. A pass that is merely "no violations were collected" is unrepresentable.**

Four parts, all binding on every current family and every future one.

### 1. Evidence is counted at the family's examining seam, and the family names its unit

"Examined" means the set the family's own semantics hands to its assertion logic, counted where that
hand-off happens. The unit differs per family, and **naming it is part of joining the enforcement
classification** (see Enforcement) — a reviewed, written claim rather than a private interpretation. For
the rule family it is the post-filter subject set handed to the conditions — already implemented, with
the correct exemption ordering, at `src/core/rule-builder.ts:577-585`. For the smell family it is the
bodies entering pairwise comparison after `minLines` filtering. For `correspondence` it is the key sets
of its sides.

Evidence is counted in units **iterated**, never in condition matches: a condition-glob tripwire that
iterates every subject and matches none has non-empty evidence, so the 0.34.0 carve-out for tripwires
survives untouched.

Two boundaries, stated so nobody relocates them:

- **Not inside `Condition.evaluate`.** `Condition` is public API with a sanctioned constructor
  (`defineCondition`); counting there changes its return type and breaks every user-written condition. A
  user condition that internally skips every subject is therefore outside this invariant — named in the
  Notes as review-enforced residue, not silently absorbed.
- **Not upstream.** Files loaded, globs matched, selection size before filtering — those are
  **diagnosis**, attached to the failure so the remedy can name the actual fault (ADR-008 rule 2).
  Evidence produced anywhere other than the examining seam satisfies the letter of the invariant over a
  fiction: `examined: sourceFiles.length` compiles, and lies. The compiler checks that evidence is
  present; **provenance** — that it came from the right layer — is what review checks, family by family,
  with ADR-008 rule 5's question.

### 2. The terminal seam's type requires the evidence

The single verdict site already exists: every published family's terminal path flows through
`TerminalBuilder`, over the abstract seam `collectViolations(): ArchViolation[]`
(`src/core/terminal-builder.ts:697`; the smell family delegates into it at
`src/smells/smell-builder.ts:122-128`). The decision is to change **that seam's return type** to carry
the evidence — `{ violations, examined }` in shape; the exact type is the implementing plan's — with the
root converting empty-undeclared evidence into the 0.34.0-style configuration finding. `check()`,
`violations()` and `.warn()` keep their signatures; ADR-003's grammar is untouched.

Not a free-standing verdict factory: nothing forces a terminal to call one — the "call exists" weakness
this ADR rejects in the dogfood alternative below. And no **third** token mechanism: two mints exist
today, each unforgeable against its own audience, and the declared-empty token **subsumes both behind
one consumer with one semantics**. The **`WeakSet` registry** (`src/core/cardinality.ts:25`,
`marksAssertsCardinality`) guards **user-constructible condition objects** — the surface with the
measured forgery record, its predecessor (a module-private `unique symbol`) having been forged in one
line through documented exports, as that file's own docstring records. The `_expectEmpty` boolean
(`src/core/rule-builder.ts:175`) guards **builders** — a protected field behind a sanctioned method,
carried by copy-on-write where registry membership keyed on a builder would be lost at the first
`copy()`, and reachable only to subclass authors, who are ADR-010's contract audience. ADR-005 is
discipline, not a mechanism; these two are the mechanisms, and nothing may add a third. (The first
draft said "minted through the registry" alone; the implementing plan's copy-on-write analysis
corrected it.)

**This is a break of the extension contract, executed under the contract.** The seam this ADR retypes
is the one abstract member [ADR-010](./010-the-extension-surface-is-a-contract.md) names in its rule 1
table, and external dialects build on it. So the change rides ADR-010's own process rather than ad-hoc
judgment: versioned and changelogged as breaking, the in-repo reference implementation updated in the
same commit (010 rule 2), the contract fixture recompiled against the new `.d.ts` (010 rule 4), with
eess's bump-time gate as the foreign derivation that proves the migration note suffices. The tempting
alternative — a concrete default so existing subclasses keep compiling — makes every new family
**exempt by default**, the exact polarity `assertsSomething`'s own docstring warns about. The break is
the honest choice, and pre-1.0 the cheap one.

### 3. Empty is a declaration, never a default — and no declaration outranks a dead instrument

The legitimate empty cases stay legitimate, and their mints are `.notExist()` (zero matching subjects
_is_ the assertion being satisfied — the 0.34.0 exemption) and `.expectEmpty()` (asserts emptiness, and
fails the day it stops being true), **lifted to `TerminalBuilder`** so every family, smells included,
reaches it — the hoist [ADR-010](./010-the-extension-surface-is-a-contract.md) rule 3(a) has already
accepted from the consumer's side: one mechanism, both documents served. Absent a declaration, zero
examined units is a configuration finding: failing,
`bypassFilters`, unsuppressable — the 0.34.0 mechanics as the floor for every family.

Three rulings the first draft left open:

- **Presets must thread the declaration.** Both shipped presets construct the currently fail-open
  configuration, and a preset user does not hold the builder — if the option cannot carry the user's
  declaration to the mint, their only reachable remedy is disabling the option, which deletes coverage
  permanently: ADR-008 rule 1's trained-suppression dynamic, reproduced by this ADR's own gate. Binding
  requirement: every preset exposes a **declaration carrier that reaches every check it constructs** —
  one shared option naming the affected rules satisfies this, and per-option unions are not required
  (an option like `noInlineLogic` constructs many rules from one entry; a per-option union cannot name
  which). A declaration that binds to no constructed rule — a typo, a stale id — is itself a **failing**
  configuration finding, never a warning (rule 1: a warning is invisible). The options shape is the
  plan's; the requirement is not optional. (The first draft said "every preset option accepts and
  threads"; the implementing plan's carrier analysis corrected the letter while keeping the substance.)
- **An empty project outranks every token.** A declaration asserts a fact about a loaded corpus; over
  zero loaded source files it asserts nothing, and the expiry property that justifies `.expectEmpty()`
  never engages — on a solution-style tsconfig the corpus never stops being empty, so an agent's one-line
  `.expectEmpty()` would restore bug 0066's 401-findings-reported-clean **forever**, through the
  sanctioned door. So zero loaded source files is a configuration finding under any declaration. This
  deliberately supersedes the precedence bug 0066's root-cause note endorsed (`assertsCardinality()`
  returning ahead of the empty-project check, `terminal-builder.ts:509`): that ordering stays correct at
  **selection** level — `.notExist()` over a loaded project with zero matching subjects is satisfaction —
  and is now wrong at **instrument** level.
- **`correspondence().allowEmpty()` is reconciled, not grandfathered.** It is the forbidden shape shipped
  before this ADR: a permanent, non-expiring "empty is fine" that the rule family has rejected twice with
  receipts (plan 0069's appendix; the cardinality hardening that made it unexpressible there). It
  converts to declared-empty semantics — the declared side must then _be_ empty, and the declaration
  fails the day it stops being true — a breaking change owned in Consequences. There is no third state
  ("sometimes empty, silently"); Alternatives rejects it explicitly.

### 4. The finding names its cause's remedy

The new configuration finding fires for at least three causes with three different remedies, and ADR-008
rule 2 forbids naming one as universal. An **empty project**: point at the tsconfig that holds the
sources — the shipped message for this case is already good, and it must **not** offer `.expectEmpty()`,
per the ruling above. A **dead selector glob**: fix the glob. **Filters excluded everything in a loaded
project** — the one judgment call: declare `.expectEmpty()` if the corpus is legitimately below
threshold, otherwise fix the filters. Per-cause remedies are part of the finding's contract, each
verified to remediate (rule 2's behavioural corollary).

### Enforcement

Two layers, differently derived — ADR-008 rule 5 applied to this ADR's own claim. **The compiler**
enforces the construction: no evidence, no build. **The vacuity matrix** — a table of every published
check-constructor, run against a zero-file project, asserting each one fails — enforces the behaviour of
the shipped artifact.

Its binding constraints. Everything below is a decision about what the matrix must be; the test
inventory that realises it — fixtures, invocation recipes, categories, build wiring — is the
implementing plan's, because an ADR decides and a plan implements:

- **Enumerated from the `package.json` exports map, imported from `dist`, recursing into
  namespace-object exports.** The root namespace alone sees none of the twelve shipped subpaths — as
  first drafted, this matrix could not see the GraphQL families or the presets — and a new `smells.*`
  member adds no top-level export. Type-only exports ride the static/runtime pairing this repo already
  uses.
- **Every export classified; unclassified fails.** A new family must touch the classification in
  writing before it can ship. That is the true claim — not "structurally cannot miss": a
  \_mis_classified family still passes, and review owns misclassification.
- **Probes are the bare construction, on `.check()` and `.warn()` both.** Bug 0066 measured why: bare
  `.check()` **passed** while `.inFolder(…)` **threw**, so a decorated probe certifies the guarded cell
  and misses the fail-open one. A family whose bare construction is impossible is probed in its
  nearest-bare cell, and the deviation is recorded in the classification.
- **A fresh build, and its own controls.** A `dist` matrix over yesterday's build certifies yesterday;
  and the matrix carries a deliberately fail-open fake plus a classification completeness check —
  rule 5's "every guard needs its own vacuity guard". The CLI binary — a published entry point in no
  module namespace — is named out of the matrix's scope and owned by the plan.

The independence is the point. The compiler's claim is static — every verdict was constructed with
evidence. The matrix's claim is behavioural — every published check-constructor actually reds over
nothing. They cannot fail the same way, and the enumeration source is the exports map: the one list a
published surface cannot avoid joining.

**Blast radius (ADR-008 rule 6): published API — top row.** Strangers depend on every one of these entry
points, and both shipped presets construct the currently fail-open configuration. Guard the guard:
adversarial review of the matrix, mutation of the seam.

## Consequences

### Positive

- Fail-open becomes unwritable, not just unwritten. The two GraphQL families — published today, guarded
  today only by a hand-maintained module list — join the matrix on day one; every family after them joins
  by being published.
- Bug 0066's open design question ("narrow: arm the check when the project is empty; wider: zero subjects
  examined is the finding, whatever the reason") is answered at the architecture layer: **wider, by
  construction** — with the false positive handled by declaration, and the silencer risk handled by the
  instrument-level precedence.
- The mission statement gets its enforcement: green is evidence, not a default.

### Negative

- **Breaking, third wave — and it must be the last of its class, said out loud.** Users have absorbed two
  "your green was a lie" waves (0.18.0, 0.34.0). A third erodes trust unless the release makes the claim
  the first two could not: **this closes the class, by construction**, with the matrix as the falsifiable
  evidence. Ship it as one red event — the seam change and the smell-family fix in the same minor, not as
  waves five and six.
- **The migration is diagnostic-first, and the diagnostic's reach is stated honestly.** `doctor` previews
  the flip on release N — but ADR-008 rule 1's corollary already admits doctor cannot load a rule file
  that imports a test runner, which is the primary documented usage. For those users this wave is
  red-on-upgrade with no **doctor** preview — but not with none: `diagnose()`, the same diagnosis
  behind a programmatic API, runs inside their own suite, and the changelog carries that recipe rather
  than hiding behind the doctor formula. The preview must derive from the **new evidence path**, not
  from the glob-gated path it is previewing — a migration instrument derived differently from its own
  gate is a rule 5 violation inside the migration.
- **An extension-contract break** for external dialects — named in part 2 and ridden through ADR-010's
  process. Acceptable pre-1.0, and only pre-1.0.
- **Authoring friction is the mechanism, so it is budgeted, not apologised for.** Writing a new entry
  point gets harder in exactly one place: evidence must be threaded from the examining seam to the
  verdict. That thread is the guarantee.
- **The declaration has churn and granularity costs, priced here.** A sometimes-empty corpus goes red
  twice: once when the gate lands (undeclared), and once when the first qualifying function appears
  (`.expectEmpty()` expires) — the second lands on the PR of whoever wrote a six-line function, by
  design, so the expiry finding carries the mechanical remedy ("remove `.expectEmpty()` from this rule"),
  verified per rule 2. And the token is per-rule while emptiness is per-project: a shared rule file
  across N packages cannot carry one declaration, and the honest answer is ADR-006's rules-are-code —
  branch per package — which is a real cost a monorepo pays.
- **`allowEmpty` users take a breaking change**: the permanent hatch becomes an expiring assertion.
- The matrix depends on a build, and its classification is a hand-maintained category-plus-recipe list —
  mitigated, not removed, by the completeness check: an omitted or new export cannot pass unclassified;
  a wrongly categorised one is review's to catch.

## Alternatives Considered

### A fifth wave — fix the smell family, per-family, now

Rejected on the wave evidence. Four completed waves, each correct over its enumeration, each followed by
a family outside the enumeration, with the mechanism (the omission corollary) understood and documented
before the fourth wave happened anyway. A fifth wave has the same enumeration source and therefore the
same blind spot — and the fifth family is already published.

### Dogfood it — a ts-archunit rule that every terminal routes through the guard

Rejected as the primary. "Every terminal calls X" is a property a rule could plausibly check, but it
guards the wrong layer — bug 0066's family _did_ route through the shared code and failed open behind a
precondition inside it. The compiler enforcing a required seam type is strictly stronger than a lint
asserting a call exists. Worth keeping as a belt-and-braces check once the seam exists; not a substitute
for it.

### Runtime assertion only — throw when a verdict is built without evidence

Weaker form of the same idea: converts a compile-time impossibility into a runtime bug class that needs
its own test to be seen. Acceptable as a fallback at boundaries the type shape cannot reach (JS interop),
per ADR-005's own carve-out. Rejected as the primary for the same reason ADR-005 exists: the compiler is
available, and evidence the compiler checks does not rot.

### A third state — "sometimes empty is fine", `allowEmpty` generalised

Rejected. It is the silent-green hatch by another name: a check carrying it can never fail on the corpus
going quietly unmeasured, which is the exact shape this ADR exists to make unrepresentable. The project
has rejected it twice with receipts (plan 0069's appendix for the rule family; the cardinality hardening
that made it unexpressible there). The churn cost of living without it is real and is priced in
Consequences — a price listed is a decision; a hatch is an accident waiting.

### Do nothing — treat bug 0066 as the last one

Rejected. It is the fourth, the mechanism that produced it is documented in our own ADR, and the fifth
family shipped before this ADR could be drafted — guarded, today, by a hand-maintained list.

## Notes

Relationship to ADR-008: this ADR is rule 3's corollary — _"prefer exclusion by construction (structure
the scope so the exception cannot arise) over any list, marker, or flag"_ — applied to our own core, and
it walks through the door 008's Alternatives left open. ADR-008 remains binding, review-enforced, for
everything the compiler cannot check: remedy quality (rule 2), warn-vs-fail judgment (rule 1), sabotage
discipline (rule 5), depth (rule 6).

Relationship to [ADR-010](./010-the-extension-surface-is-a-contract.md): the seam this ADR retypes is
the contract member that ADR names, and the two documents deliberately share one mechanism — part 3's
hoist of `.expectEmpty()` / `.expectNonEmpty()` is 010's rule 3(a), accepted there from the consumer's
side. A contract member changing type under a proposed contract is exactly why the two should be read,
and ratified, in sight of each other.

The honest limits, all three named. **Adequacy**: a check can examine 500 subjects and still assert
nothing worth knowing; ADR-008's rules own that. **Provenance**: the compiler checks that evidence is
present and the matrix checks the zero-file cell; evidence wired from the wrong layer
(`examined: sourceFiles.length`) lives between them, and only review catches it, family by family.
**User conditions**: a `defineCondition` body that internally skips every subject is invisible to a seam
that counts what was handed to it. Unrepresentable vacuity is the floor, not the ceiling.
[Bug 0077](../bugs/0077-a-non-empty-examined-count-proves-neither-falsifiability-nor-scope.md) measures
Adequacy and Provenance against worked examples (`inconsistentSiblings`'s majority arithmetic; a preset
`include` glob matching the absolute path) rather than arguing them in the abstract — and finds Adequacy
partly mechanisable per-family where a cheap proxy exists ([plan 0102](../plans/completed/0102-a-detector-that-cannot-fire-says-so.md)),
without contradicting that the general case stays review-enforced.

Prose-named cases become matrix rows (ADR-008's omission corollary — no diff will ever produce them):
bug 0066's "Not measured" items — `inconsistentSiblings`, `.expectEmpty()` reachability on a smell
builder (now guaranteed by construction, still asserted once), and the CLI path — are named rows in the
implementing plan.

The phrase that started it: _we cannot have tests that test nothing because of misconfiguration — that is
the trap of every version prior to 0.18.0._ This ADR is that sentence made structural.

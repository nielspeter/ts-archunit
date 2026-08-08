# ADR-010: The Extension Surface Is a Contract

## Status

**Proposed** (2026-08-06). Twin of eess ADR-009 ("Adopt ts-archunit as the Engine; Retire the
Fork") — the two are ratified together or not at all: eess's ADR flips to Accepted only when this
one does, and this one exists because that one needs it.

The trigger: eess — the multi-dialect spec compiler, same author — measured its forked copy of
this engine at **10,342 diff-lines behind across the 118 files the trees share, plus 37 modules it
never received**, and decided to delete the fork and depend on `@nielspeter/ts-archunit` instead,
with its dialects (mermaid, markdown, gherkin) extending the core builders the way `src/graphql/`
does. A spike (eess `work/spikes/0001-eess-over-ts-archunit/`) proved the joint on the published
0.57.0 dist: a foreign dialect over a non-TypeScript element type, built from exactly the members
this ADR names, with the assertion gate, the `Fix:`/`Docs:` surface, and copy-on-write all
arriving for free.

That makes the internal extension pattern a **consumed surface**. This ADR says so out loud,
rather than letting a dependent build on an accident.

## Context

1. **This package has always had two APIs, and only one of them is checked.** The first is the
   export surface of `src/index.ts` — 118 export lines that held stable across 0.24→0.57 (zero
   exports removed or renamed). The second is the _inherited_ surface: the protected members a
   dialect subclass touches. `src/graphql/schema-rule-builder.ts` and the slice builders consume
   that second API in-repo, so any break shows up in our own build the same commit it is made. An
   external dialect gets no such courtesy. Semver does not cover protected members; a rename that
   is a refactor here is a broken build there — or worse, a subtly wrong one, if a member's
   _semantics_ shift under an unchanged name (`copy()` reverting to shallow sharing would
   reintroduce [bug 0016](../bugs/fixed/0016-narrowing-a-named-selection-mutates-it.md) in every
   downstream dialect while our own suite stayed green).

2. **The consumable surface is small, and the spike enumerated it by use, not by memory.** A
   terminal-pattern dialect touches exactly: `copy()`, `collectViolations()`,
   `assertsSomething()`, `assertionAdvice()`, and reads `_reason`/`_metadata` when building its
   `ConditionContext`. Everything else it consumes — `Predicate<T>`, `Condition<T>`,
   `ConditionContext`, `ArchViolation`, `ArchRuleError`, the formatters, baseline, exclusion
   comments — is already public API. The generic machinery is genuinely element-type-agnostic:
   the spike's dialect compiled clean under TS 5.9 strict against the published `.d.ts` with no
   ts-morph anywhere in sight.

   That enumeration is **as measured on 0.57.0**, and the surface has grown since — rule 1's table,
   not this paragraph, is the contract. The growth is itself evidence for this ADR: two members
   were added and one widened in the following cycle, none of them noticed by a mechanism.

3. **A consumer that gates is an asset.** eess's ADR-009 rule 4 commits it to failing _its own
   build_ when this surface drifts, at bump time. That is ADR-008's philosophy pointed back at us
   as upstream: our most demanding consumer becomes a continuous, loud audit of exactly the
   surface this ADR declares. The alternative — the fork — was the silent version, and it
   accumulated two generations of divergence before anyone measured it.

## Decision

**The extension surface is a named, versioned contract.** Four rules.

### Rule 1 — The contract is these members, by name

On `TerminalBuilder` (`src/core/terminal-builder.ts`):

| Member                                     | Visibility  | Role in a dialect                                                                                                  |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `copy()`                                   | `protected` | copy-on-write carrier — override to clone the dialect's own lists                                                  |
| `collectViolations()`                      | `protected` | the one abstract member: filter, evaluate, return `{ violations, examined }`                                       |
| `_reason` / `_metadata`                    | `protected` | read-only from the subclass, when building its `ConditionContext`                                                  |
| `assertsSomething()` / `assertionAdvice()` | **public**  | feed the assertion gate; the dialect states its own remedy                                                         |
| `declaresEmpty()`                          | **public**  | whether the author declared this rule empty — read by the gate                                                     |
| `emptyDeclarationAdvice()`                 | **public**  | how _this_ dialect spells that declaration, so the remedy is callable                                              |
| `zeroSubjectsAdvice()`                     | **public**  | the sentence for a rule that examined nothing — `diagnose()` reports it verbatim, so preview and gate cannot drift |
| `narrowingHint()` / `examinedUnitNoun()`   | `protected` | what this dialect narrowed by, and what it counts — both feed `zeroSubjectsAdvice()`                               |

**`collectViolations()`'s semantics changed in 0.59.0, and that is a rule 1 break.** It returned
`ArchViolation[]` before [plan 0098](../plans/completed/0098-the-evidence-seam-and-the-floor.md) and now
returns `CollectResult`. More consequentially, [plan 0099](../plans/completed/0099-the-floor-no-family-can-be-born-below.md)
made `examined` **behaviour-defining**: a dialect that satisfied the type with a constant `0` was
previously unobserved and now hard-fails every rule it runs. 0098's own docstring recorded the
equivalence as expiring "in the commit that gives the claim its first reader"; this is that commit.
Migration: `examined` must be a real count of the units the dialect examined, from the same
materialization `collectViolations()` uses.

`zeroSubjectsAdvice()`, `narrowingHint()` and `examinedUnitNoun()` join in the same release. The
visibility split is forced by the same test as the rows above: `diagnose()` reads the first through the
structural `DiagnosableRule`, and a `protected` member cannot satisfy a structural interface; the other
two are read only by `zeroSubjectsAdvice()` from inside the class. A dialect that leaves
`examinedUnitNoun()` alone prints "subjects" for units that are not subjects — the category error the
in-repo families each override it to avoid.

plus the public vocabulary listed in Context §2, which is already covered by the export-surface
guarantee. `RuleBuilder<T>`'s subclass surface (`addPredicate`/`addCondition`, `getElements()`,
`filterElements()`, `fork()`) **joins the contract when rule 3(b) lands** and not before — today
it requires an `ArchProject`, which a non-TypeScript dialect can only stub.

**Why the split in visibility is forced, not chosen.** The lower three are the dialect's own
machinery and stay `protected` for the reason Alternative 4 gives. The upper three are read by
`diagnose()` through the **structural** interface `DiagnosableRule`, and a `protected` member
cannot satisfy a structural interface — so their visibility is decided by the reader, not by
preference. That is the line Alternative 4 draws: a member exists publicly when something outside
the class must read it, never merely because a subclass finds it convenient.

**The last two pairs are load-bearing together, and forgetting either fails silently in opposite
directions.** A dialect that omits `declaresEmpty()` inherits the whole-rule flag, which is wrong
for any dialect whose declaration is per-part — it then reports an author for not declaring what
they declared. A dialect that overrides `expectEmpty()` (rule 3(a)) but not `emptyDeclarationAdvice()`
ships a remedy that throws when followed. `CorrespondenceBuilder` is both cases in-repo:
`expectEmpty()` there is per side and the zero-arg form is a `TypeError`.

A change that breaks a conforming dialect — signature, visibility, or _semantics_ — is a breaking
change and is versioned and changelogged as one, exactly as if it had touched `src/index.ts`.

### Rule 2 — The reference implementation lives in-repo

`src/graphql/schema-rule-builder.ts` is the canonical demonstration of the pattern, and
`docs/graphql.md` teaches it. A commit that changes the contract updates the reference in the
same commit. External dialect authors are pointed at the reference, not at prose.

### Rule 3 — Two amendments the first consumer surfaced, accepted

- **(a) Hoist `expectNonEmpty()` / `expectEmpty()` from `RuleBuilder<T>` to `TerminalBuilder`**.
  Terminal-pattern dialects got the assertion gate but not the declared-empty / expect-non-empty
  opt-ins — which ADR-009 (fail closed) wants on every check constructor anyway. One mechanism,
  both ADRs served. **Landed** (plan 0097), ahead of ratification: the hoist was a prerequisite for
  ADR-009's evidence work, and holding it would have blocked that on a two-repo ceremony. The
  members are on `TerminalBuilder` today, and 0096 added the two readers the table now names.
- **(b) Make `RuleBuilder<T>`'s `ArchProject` constructor argument optional**, so a non-TS
  dialect can extend the full builder (filterElements, silent exclusions, glob diagnosis)
  without stubbing a two-member interface. Once true, rule 1's table grows accordingly.

These are decisions about the contract's shape; how and when they are built is a plan's
concern, not this document's.

### Rule 4 — The guard is a foreign dialect, differently derived

ADR-008 rule 5 applies to this ADR's own claim. The in-repo consumers (graphql, slices) share
our source tree and our understanding — same derivation; they compile even when the _published_
surface breaks, because they are not built against it. The guard is a **contract fixture that
plays the stranger**: a minimal foreign dialect over a non-TypeScript element type (the eess
spike is its working model) that

- subclasses via exactly the rule 1 members and nothing else,
- asserts a condition-less chain **reds** with the unsuppressable asserts-nothing finding (the
  gate observed firing, not presumed — a fixture that skipped the chain would go green),
- asserts copy-on-write across a held selection **by identity of the flagged elements**, not by
  count (bug 0016's shape; `1 === 1` coincidences are exactly what ADR-008's corollaries ban),
- asserts violations flow through the public formatter with `Why:`/`Fix:`/`Docs:` intact.

The independence: the fixture is derived from **this ADR's table and the published `.d.ts`**, not
from the implementation. A protected member renamed in source breaks the fixture's compile; a
semantic drift breaks its behavioural assertions; neither can be repaired by the refactor that
caused it without touching the fixture — which is the review event the contract exists to force.
(The residual same-derivation risk — table and fixture both maintained here — is bounded by the
second derivation nobody here controls: eess's bump-time gate, per its ADR-009 rule 4.)

**Blast radius (ADR-008 rule 6): published API — top row** the moment eess ships on this
surface. Guard the guard: the fixture carries its own vacuity controls (it must _observe_ the
red, not assert around it), and contract changes get adversarial review like any published-API
change.

## Consequences

### Positive

- **Drift between the repos becomes loud and versioned.** The measured alternative was 10,342
  silent diff-lines and a downstream builder still carrying a bug we fixed 36 releases ago.
- **The extension pattern gains a test that fails before an external consumer does.** Today a
  protected-surface break is discovered by whoever subclasses next; under rule 4 it is
  discovered by our own suite, with the contract fixture naming the broken member.
- **The engine gains its hardest customer as a standing audit** — a consumer that dogfoods
  spec-code agreement and gates its build on our behaviour.
- **Rule 3(a) is not a concession; it is ADR-009's own gap.** The fail-closed work wants
  declared-empty and expect-non-empty on every constructor; hoisting them to `TerminalBuilder`
  is the same mechanism serving both documents.

### Negative

- **Named protected members are now expensive to refactor.** A rename that was free is a
  breaking change with a migration note. That is the cost of having a consumer; the fork was
  the version of this cost paid silently and compounding.
- **The contract fixture is one more thing a core change must satisfy** — deliberately. It is
  cheap to run and exists to be inconvenient at exactly the right moments.
- **Rule 3 changes this API for a consumer's sake.** Two surface changes whose need arose in
  another repo — external pressure on this repo's shape, accepted knowingly.
- **The rule 1 table can rot relative to the fixture — and it did, before either existed.**
  Within one unreleased cycle the surface gained three members (`declaresEmpty()`,
  `emptyDeclarationAdvice()`, and a `protected`→`public` widening of the first) and the table
  named none of them. Nothing mechanical noticed; a reviewer did, which is the mitigation this
  bullet already predicted and not a reassuring one. Two things follow. **Rule 4's fixture is the
  enforcement and the table is only its input**, so the fixture cannot be deferred indefinitely
  without this bullet compounding. And the gap is wider than the table: per
  [bug 0071](../bugs/0071-nothing-guards-the-published-method-surface.md), **no existing gate sees
  a public method appear or vanish at all** — the vacuity matrix is a behavioural truth table over
  constructors and never opens a `.d.ts`. That bug and rule 4 are plausibly one piece of work.

## Alternatives Considered

### Alternative 1: Let eess keep the fork

**Rejected on the measurement.** Two generations of correctness work — the assertion gate,
finding identity, copy-on-write, comment-parser correctness — never arrived downstream, and the
divergence grew at 57 releases in ~12 days. A fork of a fast-moving engine is a decision to
re-derive its fixes by hand, forever.

### Alternative 2: Publish a separate `@nielspeter/archunit-core` package

**Rejected for now** (mirrors eess ADR-009 alternative 4). A third artifact with its own release
train and its own drift surface, created to solve drift. The published API already _is_ the
core, and the spike proved it consumable as-is. Revisit if a second external dialect family
appears.

### Alternative 3: Declare nothing — same author, he'll notice

**Rejected.** "The author will notice" is a hand-maintained claim nobody derives — the exact
shape ADR-008's Context table exists to kill. Author overlap is a mitigation; it is not a
mechanism. The day either repo gains a second contributor, the unstated contract is the first
thing they cannot know.

### Alternative 4: Make the extension members `public` instead of contracting `protected`

**Rejected as a blanket move.** The fluent DSL's phase discipline exists so a _rule author_ cannot
call `collectViolations()` or mutate metadata mid-chain; publicizing those would trade a declared
dialect-author contract for an undeclared rule-author footgun. `protected` + this contract keeps
both audiences honest.

The rejection is of publicizing **by preference**, and rule 1's table is not a counter-example: the
members that are public there are read from **outside** the class, through a structural interface
that `protected` cannot satisfy. The test is the reader, not the author — "a subclass finds this
handy" is the case this alternative rejects; "`diagnose()` cannot see it otherwise" is not.

## Notes

- **The table above was verified against the published `.d.ts`, not against the source, on the day
  it was written** — all eight members present with the stated visibility. That is a one-off
  measurement and deliberately not a test: bug 0071 and rule 4 want the same instrument, and
  building half of it here would make the harder half look done. What the measurement establishes
  is that ratification is being asked for on a table that was true when read, rather than on one
  reconstructed from memory — which is the failure the Negative bullet above describes.
- The twin: eess `adr/009-adopt-ts-archunit-retire-the-fork.md` (in the eess repo). Its Tier-5
  enforcement row conditions its own acceptance on this ADR's acceptance — the ratification is
  deliberately two-sided so neither repo can bless the arrangement alone.
- The spike this ADR leans on lives in eess (`work/spikes/0001-eess-over-ts-archunit/`): three
  proofs on the 0.57.0 dist — type-level (TS 5.9 strict against published `.d.ts`), behavioural
  (assertion gate + agent surface firing for a mermaid dialect), and copy-on-write across a held
  selection, verified by identity after the spike's own first verdict mechanism false-positived
  on a count-free grep (ADR-008 rule 5, demonstrated _inside_ the spike that motivated this ADR).
- Version note: at 0.x, a contract break ships as a `breaking`-flagged changelog entry with a
  migration line, per existing practice; from 1.0 it rides ordinary semver majors.
- Relationship to [ADR-007](./007-isolate-ast-engine-boundary.md): unchanged for this repo's
  internals — but note the symmetry. ADR-007 confines _our_ engine behind a boundary so it can
  be swapped; this ADR is eess applying the identical move one level up, with ts-archunit as the
  confined engine and this contract as the boundary's type sheet.

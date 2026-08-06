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

3. **A consumer that gates is an asset.** eess's ADR-009 rule 4 commits it to failing _its own
   build_ when this surface drifts, at bump time. That is ADR-008's philosophy pointed back at us
   as upstream: our most demanding consumer becomes a continuous, loud audit of exactly the
   surface this ADR declares. The alternative — the fork — was the silent version, and it
   accumulated two generations of divergence before anyone measured it.

## Decision

**The extension surface is a named, versioned contract.** Four rules.

### Rule 1 — The contract is these members, by name

On `TerminalBuilder` (`src/core/terminal-builder.ts`):

| Member                                     | Role in a dialect                                                 |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `copy()`                                   | copy-on-write carrier — override to clone the dialect's own lists |
| `collectViolations()`                      | the one abstract member: filter, evaluate, return violations      |
| `assertsSomething()` / `assertionAdvice()` | feed the assertion gate; the dialect states its own remedy        |
| `_reason` / `_metadata`                    | read-only from the subclass, when building its `ConditionContext` |

plus the public vocabulary listed in Context §2, which is already covered by the export-surface
guarantee. `RuleBuilder<T>`'s subclass surface (`addPredicate`/`addCondition`, `getElements()`,
`filterElements()`, `fork()`) **joins the contract when rule 3(b) lands** and not before — today
it requires an `ArchProject`, which a non-TypeScript dialect can only stub.

A change that breaks a conforming dialect — signature, visibility, or _semantics_ — is a breaking
change and is versioned and changelogged as one, exactly as if it had touched `src/index.ts`.

### Rule 2 — The reference implementation lives in-repo

`src/graphql/schema-rule-builder.ts` is the canonical demonstration of the pattern, and
`docs/graphql.md` teaches it. A commit that changes the contract updates the reference in the
same commit. External dialect authors are pointed at the reference, not at prose.

### Rule 3 — Two amendments the first consumer surfaced, accepted

- **(a) Hoist `expectNonEmpty()` / `expectEmpty()` from `RuleBuilder<T>` to `TerminalBuilder`**
  (`src/core/rule-builder.ts:140`). Terminal-pattern dialects currently get the assertion gate
  but not the declared-empty / expect-non-empty opt-ins — which ADR-009 (fail closed) wants on
  every check constructor anyway. One mechanism, both ADRs served.
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
- **The rule 1 table can rot relative to the fixture.** Mitigation is rule 4's derivation
  direction (fixture from table) plus review; the honest statement is that the fixture, not the
  prose, is the enforcement.

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

**Rejected.** The fluent DSL's phase discipline exists so a _rule author_ cannot call
`collectViolations()` or mutate metadata mid-chain; publicizing the members would trade a
declared dialect-author contract for an undeclared rule-author footgun. `protected` +
this contract keeps both audiences honest.

## Notes

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

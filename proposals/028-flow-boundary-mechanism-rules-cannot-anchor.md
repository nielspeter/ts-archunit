# Proposal 028 — A Call's Receiver Has a Producer: Mechanism Rules, Re-expressed at the Predicate Layer

**Status:** Proposed.
**Priority:** Medium — a rule-language capability, not a fix for an open finding. It is the
difference between "your code does not contain the string" and "your code does not call what
this function returns"; the concrete instance that surfaced it (a consumer session-write floor,
BUG-055) was resolved by **not** adding a rule, so this is not an enabler for a waiting fix. It
stands on the class: `call()` matches callee _text_, and there is today no way to express "a
method invoked on the value a scoped call returned".
**Affects:** the `calls()` predicate surface (`predicates/call.ts`, `models/arch-call.ts`) — a
new predicate factory. No change to any existing matcher or predicate's behaviour — additive
surface only. This is an ordinary `src/index.ts` export, **not** the protected `TerminalBuilder`
dialect-extension surface [ADR-010](../adr/010-the-extension-surface-is-a-contract.md) governs —
ADR-010's Context §1 explicitly defers ordinary exports to "the export-surface guarantee," and
its four rules are about `copy()`/`collectViolations()`/`_reason`/`_metadata`, none of which this
proposal touches. The ADR that actually bears on this change is
[ADR-007](../adr/007-isolate-ast-engine-boundary.md) — see the engine-boundary note in §Design —
and it does not alter any rule that passes today regardless of how that question is resolved.
**Blast radius:** Published-API surface, not an internal check. A new `Predicate<ArchCall>`
factory on the `calls()` surface is, per ADR-008 rule 6's own table, the **top** row —
"strangers depend on it, and we cannot fix it for them" — not the "internal check over a corpus
we control" row an earlier draft of this proposal invoked in §Acceptance to justify a lighter
guard; that citation was wrong and is corrected there. What keeps the _depth_ proportionate is
not the row (published API always gets "guard the guard, adversarial review, mutate") but the
adoption facts: it cannot change the verdict of any rule that exists today (no existing predicate
or matcher is touched), and adoption is zero — nothing in this repo or its docs calls it yet. So
the guard is adversarial-shaped (§Acceptance), not skipped: a positive/negative corpus pair, a
sabotage that reassigns through a local and must escape, and each named boundary (M0/M1/M2) run
and independently confirmed to escape, not asserted from the design alone.
**Related:** [ADR-007](../adr/007-isolate-ast-engine-boundary.md) — the ADR most specific to this
change (confines ts-morph access behind `src/core/engine/`; see the engine-boundary note in
§Design for the position taken), [ADR-002](../adr/002-ts-morph-ast-engine.md) (engine choice —
how the flow resolution is done, ts-morph symbol/initializer tracing, per ADR-005's type guards),
[ADR-010](../adr/010-the-extension-surface-is-a-contract.md) (cited above to rule out, not in —
it governs the protected dialect surface, not this ordinary export), `ts-archunit-spec.md`
§6.3.5 (rejected a same-scope data-flow feature this proposal must reconcile with — see Problem
§4) and §6.3.1 (`symbolOf()`/`resolvesTo()`, a Phase-2 sketch aimed at the same alias escape this
proposal leaves open — same section), and
[proposal 021](./021-consumer-run-time-where-it-actually-goes.md) — which first measured the
same seam from the other side. The concrete instance, bug 055 in the _frbkom-een-indgang_
consumer repo (a Nuxt session floor), lives outside this repository; its measurement is
reproduced in full under §Problem and cannot be linked internally.
**Evidence:** measured 2026-08-10 in two places. (1) In the _frbkom-een-indgang_ consumer repo
(a Nuxt application's session floor), by spiking a candidate `call('useSession')` rule against
four deliberate bypass forms — the numbers are in §Problem, reproduced against the source of
`call()` while writing this proposal. (2) The base-rate measurement that decides priority, run
the same day against the **originating corpus** (this project's own cmless `packages/*/src`,
281 files — the consumer repo is not available on this machine, and cmless is the more
meaningful corpus: it is the codebase ts-archunit exists to protect, and the exact rot from
plan 0212 lives in its routes/SDK). Methodology and full table in §Open questions #1; a
reproduction script is in the Appendix.

> **`const s = await useSession(event, cfg); await s.update({...})` — four forms, three
> completely escape `call('useSession')`, and the fourth is caught only at acquisition, never at
> the write.** `call(name)` matches a `CallExpression` whose callee text is exactly `name`
> (`matchers.ts:84`). A method call on a value an earlier call produced — `s.update(...)` — has
> callee text `s.update`, reachable by no matcher in the language. The dataflow through the local
> is the gap.

## Problem

### 1. The measurement

The consumer needed a rule "no identity-establishing write outside the wrapper." Two rules
covered the named command primitives (`setUserSession`, `replaceUserSession`). A reviewer noted
the underlying h3 primitive — `useSession(event, cfg).update(...)` — would bypass both, under
the exact deep-merge mechanism those rules exist to stop. The consumer's question was whether a
third rule could close the floor.

A candidate `call('useSession')` rule was spiked against four deliberate bypass forms:

```ts
// M0 — aliased import, then method on the local
const s = await useSessionAlias(event, cfg)
await s.update({ user })

// M1 — namespace import
await h3.useSession(event, cfg).then((s) => s.update({ user }))

// M2 — method destructured away; 'useSession' appears only as the import specifier
const { update } = await useSessionAlias(event, cfg)
await update({ user })

// M3 — bare, cleanest form
const s = await useSession(event, cfg)
await s.update({ user })
```

| pattern                               | `call('useSession')` verdict                       |
| ------------------------------------- | -------------------------------------------------- |
| M0 alias → `.update()`                | **miss**                                           |
| M1 `h3.useSession(...)` → `.update()` | **miss**                                           |
| M2 destructure `{ update }`           | **miss**                                           |
| M3 bare → `.update()`                 | catches the **acquisition call**, not the `update` |

The one it "caught" (M3) fired on `useSession(event, cfg)` — getting the handle — not on the
actual write. And `call('update')` is worse: it matches the _bare_ `update(...)` in M2 only,
missing `s.update` (property access) in M0/M1/M3.

### 2. Why it is a class and not this one call site

`call()` (and `access()`, `newExpr()`) match on **lexical text**. The body-analysis matchers
under `notContain()`/`contain()`/`useInsteadOf()` walk `SyntaxKind.CallExpression` nodes and
compare `node.getExpression().getText()` against the pattern (`matchers.ts:84-88`). That is a
decision about _how the code spells the call_, not about _what value flows into it_. The two
come apart the moment a value is bound to a name:

```ts
const client = getClient() // mechanism: 'getClient'
client.query('...') // spelling: 'client.query' — unreachable
```

This is the same boundary [proposal 021](./021-consumer-run-time-where-it-actually-goes.md)
measured from the speed side — its "correctness cost" paragraph reproduces it word-for-word:
`getExpression().getText()` yields `a.b.require`, not `require`. 021 was about a fast path
silently diverging; this proposal is about the **rule language** having no way to express the
intended semantic at all. Two consumers of one seam, opposite directions.

The class matters because mechanism rules are the ones that carry security invariants — "writes
must go through the wrapper", "this may only be reached through X" — and those invariants are
exactly the ones stated in terms of _construction_ ("call the wrapper") rather than _spelling_
("write no `setUserSession`") . Every `call()` ban on a command primitive is really a ban on
"derive a value from this command outside the sanctioned path", and the language can only
approximate that with "don't spell the command's name", which a single `const s = ...` defeats.

### 3. The spelling hole is wider than aliasing

The BUG-032 caveat ("`import { x as y }` escapes") is the **import** spelling. The flow hole is
broader: it needs no alias and no exotic import — the _plain_ way to use the function is to bind
its result to a name and call methods on it, which is M3 above, and M3 defeats the rule while
spelling `useSession` correctly. Aliasing is a subset of binding. The rule language cannot
distinguish "the code contains `useSession`" from "the code calls into a value derived from
`useSession`", and it is the second one the invariant is about.

### 4. Reconciling with spec §6.3.5 — this is not a new question for the project

`ts-archunit-spec.md` §6.3.5 already rejected a same-scope data-flow feature once:
`ensureValueIsProcessedBy()`, dropped because _"the semantics are ambiguous (what counts as
'processed'? what about intermediate variables? what about calls that happen after the value is
used?). Argument matching is precise, predictable, and sufficient for the real-world rules that
motivated this feature."_ §3.1's "Data-flow-lite rules (same function scope) are in scope" — the
sentence an earlier draft of this proposal leaned on — sits in the same Non-Goals list as that
rejection and does not survive quoting without it.

The two features are not identical. `ensureValueIsProcessedBy()` tracked a _value_ forward into
becoming an _argument somewhere_ — an open-ended "was this used" search, which is exactly where
"what about intermediate variables, what about calls after the value is used" bites. `onResultOf`
tracks a _receiver_ backward to its _producer_ — one symbol, one declaration, one initializer,
unwrap one `await`: a bounded lookup with a fixed answer per call site, not an open-ended forward
search. That is a narrower, more mechanical question, and it is why this proposal's own boundary
(§Non-goals: const-only, single binding, same function, no reassignment) reads as a precise
answer to §6.3.5's objections rather than a repeat of them — reassignment and intermediate
variables are named exclusions here, not unresolved ambiguity.

But the reconciliation needs to be made explicitly, not stepped past. And §6.3.1 already sketches
the project's planned answer to the _other_ half of this problem — `symbolOf()`/`resolvesTo()`,
type-checker-backed, tracing "through imports/re-exports" — aimed at exactly the M0 alias escape
this proposal leaves open. Both features need the same binder plumbing (`Symbol`,
`getDeclarations()`). Building `onResultOf`'s resolution ad hoc in `predicates/call.ts`, with no
stated relationship to that already-planned mechanism, risks two independently-built
symbol-resolution paths landing at different layers for the same underlying capability. Whoever
picks this up should decide: is `onResultOf`'s resolver meant to seed the shared facility
`symbolOf()`/`resolvesTo()` will need, or is it a deliberately separate, narrower one-off? This
proposal does not take a position on that question; a plan built from it should.

## The honesty line — what the spike does and does not claim

**Measured:** the four-forms table above, against the real `call()` implementation, in the
real consumer. That this is the _plain_ use of the primitive, not an adversarial alias.

**Measured (and retracted) — the four-forms claim did not survive the design.** An early draft
of this proposal claimed `callResult` flags **all four** of M0–M3. It does not, and the
retraction is the point (this is the ADR-008 "a pass is constructed from evidence" discipline,
applied to a proposal). The design's _producer_ match is **callee text** (`matchers.ts:84`), the
same seam `call()` uses — and that is exactly why aliases escape: the design resolves the
receiver's binding to its initializer (via ts-morph symbols), but does **not** resolve the
initializer's own callee text through an import alias. Applying the boundary to the four:

| pattern                                         | with the design's text-matching boundary                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| M0 alias → `.update()`                          | **escapes** — callee is `useSessionAlias`, not `useSession`; the design does not resolve import aliases |
| M1 `h3.useSession` → `.then(s => s.update())`   | **escapes** — the receiver `s` is a `.then` callback _parameter_, explicitly out of scope               |
| M2 destructure `{ update }`, bare `update()`    | **escapes** — a destructured binding and a bare call, not `receiver.method`                             |
| M3 bare `const s = useSession(...); s.update()` | **caught** — and at the **write**, not the acquisition                                                  |

M3 is the meaningful improvement: `call('useSession')` caught M3 only at _acquisition_ (the
`useSession(...)` call), while the new predicate catches `s.update(...)` — the actual write.
M0/M1/M2 require alias-resolution, a flow through a callback parameter, or a
destructure-then-bare-call — each a deliberate step beyond the plain idiom, and each is stated
as the honest residual frontier in §Non-goals rather than claimed. A second possible retraction
was measured and withdrawn: an early idea to ban `call('update')` in the same folder. `update`
is a near-universal spawner — the consumer has a dozen legitimate `.update()` calls on database
objects in the same directories. A method-name ban on the flow target is tenable; a method-name
ban on the bare name is noise. Hence the anchor is the **producer** (`useSession`), narrowed to
the method on its **result** — not the other way around.

**Not claimed:** that this makes the consumer's rule-wise. The consumer resolved BUG-055 by
_not_ adding a rule — `useSession` is also a legitimately-read handle, so a flow rule would
still flag reads, and the reviewer's honest recommendation was documentation. This proposal does
not revive that decision. It is a language capability the class needs regardless of whether this
one instance uses it: the next mechanism rule that _does_ want enforcement (a write-only
producer, e.g. a session _writer_ rather than a read/write handle) currently has no way to say
"no method on this call's result."

## Design — at the predicate layer, where the machinery already is

The earlier draft proposed a new **`ExpressionMatcher` factory** (`callResult`) that resolves a
receiver's binding inside `matches(node)`. Review of the actual code moved the design: the
`calls()` predicate layer already owns receiver/method resolution, and it is where the
value-flow question belongs.

`ArchCall` exposes `getObjectName()`, `getMethodName()`, `getArguments()`, and the underlying
ts-morph node (`models/arch-call.ts:48-76`). `predicates/call.ts` already has `onObject()`,
`withMethod()`, `withArgMatching()` — all `Predicate<ArchCall>` with a `description` and a
`test(call)`. The new predicate is one more of the same shape:

```ts
/**
 * Matches a call whose receiver is bound to the result of a scoped call.
 *
 * `onResultOf('useSession')` matches `s.update(...)` where `s` binds to the
 * result of a call whose callee text matches 'useSession', through a
 * lexically-scoped `const` binding. It does NOT match an import-alias of the
 * producer (M0), a flow through a callback parameter (M1), or a destructured
 * then-bare-call (M2) — see §Non-goals. Those escapes are the boundary, stated.
 *
 * The receiver provenance is resolved with ts-morph: `receiver.getSymbol()`
 * → `getDeclarations()` → `VariableDeclaration.getInitializer()` → the
 * producer call's callee text (unwrapping `await`). This is the "data-flow-lite
 * (same function scope)" row the spec already scopes in (Section 6.3).
 */
export function onResultOf(producer: string | RegExp): Predicate<ArchCall>
```

The fluent chain method — `CallRuleBuilder.onResultOf(...)`, wiring `this.addPredicate(...)` —
is not shown here but follows the same 1:1 pattern every other predicate on this builder already
has (`onObject`/`withMethod`/`withArgMatching`/`withStringArg` in `call-rule-builder.ts:119-133`);
it belongs in the same change and the same Files Changed list once this becomes a plan.

Composition is the existing machinery — no new combinator, no `.thenCall`:

```ts
calls(p).that().onResultOf('useSession').and().withMethod('update').should().notExist().check()
// or, the whole floor, reads and writes alike:
calls(p).that().onResultOf('useSession').should().notExist().check()
```

A second domain, to substantiate the _class_ rather than the one motivating case — nothing below
is session-specific:

```ts
// A transaction handle must be committed through the audit-logging wrapper, not directly:
calls(p)
  .that()
  .onResultOf('db.begin')
  .and()
  .withMethod('commit')
  .should()
  .notExist()
  .because('commits must go through commitTransaction() for audit logging')
  .check()
```

The shape is identical to the session case — a producer call, a receiver bound to its result, a
method on that receiver — with nothing session-specific in the mechanism. `onResultOf` closes the
same plain-spelling gap for transaction handles, feature-flag clients, lock handles, or any other
acquire-then-operate pattern; the session example is the one that happened to be measured, not
the only one the predicate serves.

`withMethod('update')` is the method-narrowing the earlier draft called `.thenCall(update)` — it
already exists (`predicates/call.ts:44-61`), and because it is a predicate it composes with
`and()`/`or()`/`not()` and `satisfy()` like every other predicate. The lego-bricks rule holds:
the value-flow question is one new predicate; the method-narrowing is the existing
`withMethod`. The producer-only form expresses the whole floor; the author narrows to the
write with the predicate that already exists.

Semantics, scoped to the honest boundary (ADR-005 type guards throughout — `Node.isIdentifier`,
`getSymbol()`, `Node.isVariableDeclaration`, `Node.isAwaitExpression`; no `as`):

1. **Direct receiver is the producer call** — `useSession(e, c).update(...)`: the receiver's
   expression text matches the producer → match.
2. **Receiver is a `const` whose initializer is the producer call** (optionally `await`-ed) —
   `const s = useSession(...); s.update(...)`: resolve via `receiver.getSymbol()?.getDeclarations()`
   — if that array's length is not exactly 1, no match (a symbol with multiple or zero
   declarations is not a single, provably-final binding, per point 3 below); otherwise read the
   sole declaration's initializer, unwrap one `await`, and compare its callee text to the
   producer. The Appendix's reproduction script gets this right (`decls.length !== 1` → skip); an
   earlier draft of this section showed the formula without that guard — the guard is load-bearing
   and must ship with the implementation, not just the Appendix's spike.
3. **Only local, single-binding, `const` flows.** Reassignment, `let` (whose initializer is not
   provably the final value), closure capture, array/object property access, function
   parameters, `this.x = producer(); this.x.update()` (instance-field receiver), and
   return-through are **out of scope** (§Non-goals). The point is to close the _plain_ spelling,
   not to build a taint tracker.

The predicate's `description` needs to be stable and human-readable, e.g.
`"on result of 'useSession'"` — a change orphans baselines. An earlier draft of this section
asserted the mechanism is `identifyMatches` keying finding/baseline identity on it; review found
`identifyMatches` (`src/conditions/match-identity.ts`) actually operates on **matcher**
descriptions inside body-analysis conditions, not on `.that()`-phase `Predicate<T>` descriptions
narrowing the selected population — `onResultOf`'s contribution to a `notExist()` violation's
identity more likely runs through `ArchCall.getName()`'s existing path instead. Whichever
mechanism is real, the stability requirement on `description` stands; the exact seam needs
confirming against `notExist()`'s actual identity derivation before the format is locked (see
§Open questions #4).

## Why the predicate layer is the right home (the rework from the first draft)

- **It is where receiver/method resolution already lives.** `onObject`/`withMethod` are
  `Predicate<ArchCall>` (`predicates/call.ts:25-61`); the value-flow question is the same shape,
  one more predicate. The first draft put it in the matcher layer, where the contract is a pure
  `matches(node)` over a single AST node — a value-flow matcher there is the first _dataflow_
  member of a purely _syntactic_ tier, and pulls `getSymbol()` (binder-level work) into a layer
  that is today AST-only and cached. The predicate layer is where the type checker is already on
  the (opt-in) path.
- **No parallel composition.** The first draft invented `.thenCall(update)` — a bespoke matcher
  pair where no matcher combinator exists. The predicate layer already has `withMethod`,
  `and()`, `or()`, `not()`, `satisfy()`. The method-narrowing is not new surface; it is the
  existing predicate.
- **It composes with the existing surface.** Same `Predicate<ArchCall>`, same `calls()` builder,
  just a smarter `test()`. `ArchCall`'s `getObjectName`/`getMethodName` are untouched — those
  answer "what object/method is this call on" (a different question than "what produced this
  object"), which is exactly the separation that keeps this additive.
- **A fourth option exists — an `Engine`-level operation, per [ADR-007](../adr/007-isolate-ast-engine-boundary.md)
  — and this proposal takes a position on it rather than staying silent.** ADR-007 confines all
  ts-morph access behind `src/core/engine/` and states plainly: "No predicate, condition,
  builder, helper, or smell detector imports ts-morph directly." It separately names the risk
  this predicate's design is the textbook case of — ts-morph's chatty, per-node API pattern
  (`getSymbol()`/`getDeclarations()` is exactly that) is what makes the whole engine dependency
  vulnerable under the TS7/Corsa migration ADR-007 is written against. `src/core/engine/` does
  not exist today — ADR-007 is 0% implemented, and ts-morph is imported directly in 66 files
  across this codebase already, not just here. Requiring this one additive, opt-in predicate to
  single-handedly bootstrap that boundary would be disproportionate to its own scope. **The
  position taken here: defer engine-boundary compliance, but scope the resolution chain behind
  one small, named, private function** — `resolveReceiverProducer(node: Node): { calleeText:
string } | undefined` — **living in its own module**, so that if/when `src/core/engine/` lands,
  migrating this predicate is a single-function swap, not a refactor of `predicates/call.ts`'s
  guts. That is a stated, deliberate trade-off, not an oversight — whoever ratifies this proposal
  should confirm or override it explicitly.

## Why it fits

- **It closes the plain-spelling hole, not just the alias.** M3 — the idiomatic way to use the
  function — is exactly what the new predicate catches and `call` cannot. That is the class's heart.
- **It is the other half of proposal 021's discovery.** 021 found the seam produces a different
  callee text than expected; this gives the rule language a way to state the invariant _despite_
  the seam.
- **ADR-008 rule 2's "remedy verified to remediate".** A rule built on `onResultOf` has a
  checkable remedy — "route the write through the wrapper" — and the positive case (M3 becomes
  a finding at the write, verifiable against the M0/M1/M2 residual as a stated non-goal) is the
  verification.
- **The project's own founding test.** A gate keyed on a name is routed around the moment an
  agent renames or relocates (`why-ts-archunit.md`'s first condition); the binding is the
  rename. This closes that gap for the mechanism-rule class, inside the function body — the
  project's differentiator.

## Non-goals / risks

- **Not a taint tracker.** No inter-procedural analysis, no flow through function arguments,
  return values, arrays, objects, closures, or reassignment-after-declare. Escaping is as easy
  as two hops (`const a = useSession(...); const b = a; b.update(...)`). That is stated
  honestly, not hidden. The three concrete escapes from §Problem are **M0** (import alias),
  **M1** (flow through a `.then` callback parameter), and **M2** (destructure-then-bare-call).
  They are residual by design, not unexamined.
- **`this.x = producer(); this.x.update()` (instance-field receiver) is out of scope, and is
  stated as a named boundary.** It shares M3's plain-spelling quality — the highest-value
  mechanism targets (a session _writer_) frequently live on instance fields — so it must not be
  silently assumed caught. Property receivers (`s.data.update()`) are likewise out of scope.
- **Read-write distinction stays the author's problem.** `onResultOf` does not know whether
  `s.data` is a read. A consumer who must allow reads scopes with `withMethod('update')` or
  accepts the overhead. (This is precisely why it did not un-block the consumer's BUG-055 — an
  honest limit, stated.)
- **Producer anchoring over method anchoring is required.** Anchoring on `withMethod('update')`
  alone (the method) instead of `onResultOf('useSession')` (the producer) is the measured trap
  from §honesty line — `update` is too common a name. The proposal's shape — producer-anchored,
  optionally method-narrowed — survives the measurement; the inverse does not.
- **`getSymbol()` is binder-level work on an opt-in predicate.** A rule built on `onResultOf`
  pulls binding resolution into a surface that today is AST-textual. It is opt-in, but the cost
  must be stated honestly (021 measured 1,423 `getSymbol()` calls for a 12-rule suite), not
  hidden behind "just a smarter `test()`".
- **Predicate evaluation order is not cost-based, and the natural word order is the expensive-first
  one.** `RuleBuilder.filterElements()` runs `.that()` predicates in insertion order with no
  reordering (`core/rule-builder.ts`), so `calls(p).that().onResultOf('useSession').and().withMethod('update')`
  — the natural English phrasing, and this proposal's own canonical example — runs the binder
  walk over every call in the population before `withMethod`'s cheap string-compare gets a chance
  to prune anything. Authors who care about cost should write the cheap predicate first
  (`withMethod('update').and().onResultOf('useSession')`); the DSL does not do this automatically,
  and this proposal does not add reordering. Stated here as an authoring gotcha, not fixed by
  this change.
- **The current boundary is this predicate's contract, not a v1 placeholder — stated so a future
  widening is a deliberate, visible decision.** const-only, single binding, same function, ≤1
  `await` is what `onResultOf` means today and, absent a documented reason otherwise, should keep
  meaning: widening it later (e.g. to close the M0 alias escape once `symbolOf()`/`resolvesTo()`
  plumbing exists, per Problem §4) would change which calls an _existing_ `.notExist()` rule
  flags, with no name change to signal it — "a member's semantics shift under an unchanged name"
  is exactly the hazard ADR-010's own history treats as a breaking event, not a routine
  minor-version enhancement. If a future widening is wanted, it should get a new predicate name
  or an explicit, changelog-called-out behavior change — not a silent expansion of what
  `onResultOf` already means.
- **Additive published surface, correctly-scoped guard.** A new exported predicate factory on an
  ordinary `src/index.ts` export (not the protected dialect-extension surface ADR-010 governs —
  see §Affects). Per ADR-008 rule 6's **published-API** row ("guard the guard, adversarial
  review, mutate" — not the lighter "internal check, fires once and stop" bar an earlier draft of
  this proposal cited in error, see §Blast radius), the guard is a positive/negative corpus pair,
  a sabotage that reassigns through a local and must escape, and independent confirmation that
  each named boundary (M0/M1/M2) actually escapes rather than asserting it from the design alone
  — no existing rule's verdict can change either way, because no existing predicate or matcher is
  modified.

## Acceptance

- **Positive:** `onResultOf('useSession')` flags **M3** — the plain, direct-binding write
  `const s = useSession(...); s.update(...)` — at the **write**, where `call('useSession')` could
  only ever flag the acquisition. M3 is the meaningful, honest claim.
- **Residual (explicitly NOT flagged — the boundary):** M0 (import alias), M1 (flow through a
  `.then` callback parameter), M2 (destructure-then-bare-call). Each is stated as an escape in
  §Non-goals; they require a deliberate step past the plain idiom.
- **Negative:** the same module's legitimate `db.select(...).update(...)` calls on a _different_
  producer are **not** flagged (the producer anchor holds); a `const b = a;` second-hop escape is
  **not** flagged (the honest boundary holds).
- **Composition:** `onResultOf('useSession').and().withMethod('update')` narrows the M3 catch to
  the `.update()` method specifically, so a bare `useSession(e, c).data` read is not flagged —
  using the existing `withMethod` predicate, no new combinator.
- **Guard / sabotage:** the negative case survives; deleting the positive case from the fixture
  still makes the test meaningful; a `let s = useSession(); s = other(); s.update(...)` reassignment
  must **escape** (the `const`-only boundary holds); M0 (import alias), M1 (`.then` callback
  parameter), and M2 (destructure-then-bare-call) must each be independently run against the
  implementation and confirmed to escape, not asserted from the design alone. Depth per ADR-008
  rule 6's **published-API** row (corrected from an earlier draft's misclassification under
  "internal check, fires once and stop" — see §Blast radius): guard the guard, not just the
  detector.

## Migration

None. New export, additive. Consumers opting in use it for new rules; nothing existing changes.
The exported factory joins the `calls()` predicate surface from `predicates/call.ts` and the
package's public API (a new additive row in `src/index.ts`/the `calls` export) — no widening of
any existing published type.

## Open questions for review

1. **The base-rate measurement — DONE 2026-08-10, and it splits the claim it was meant to test.**
   The value proposition rested on "the naive spelling is the accident." Measured against the
   originating corpus — 281 of this project's own source files (cmless `packages/*/src`), 1,635
   method calls on a local identifier receiver:

   | Class                                                           | Count   | Share     | `onResultOf`                                   |
   | --------------------------------------------------------------- | ------- | --------- | ---------------------------------------------- |
   | **M3** — receiver = direct `const/let` binding of a call result | **488** | **29.8%** | **caught** (97.7% same-function lexical scope) |
   | M1-class — receiver is a parameter                              | 353     | 21.6%     | escape                                         |
   | Unresolvable / other declarations                               | 294     | 18.0%     | out of scope                                   |
   | Destructured receiver (`BindingElement`)                        | 118     | 7.2%      | escape (plain-ish)                             |
   | M2 — object-destructure of a call result (separate scan)        | 131     | 8.0%      | escape                                         |
   | Import / alias                                                  | 46      | 2.8%      | escape                                         |

   **What the measurement clears:** M3 is the **largest single class** — 29.8% of all
   method-calls-on-locals, not a corner case, and almost entirely (97.7%) at the exact
   same-function lexical boundary the design draws. One additive predicate catches 30% of a real
   seam no existing surface can express. The gate "is the rot real and the primitive generic"
   passes on the weaker-but-sufficient claim: this is a frequent, plain, real spelling.

   **What the measurement refutes:** the proposal's own strong framing — "the naive spelling is
   _the_ accident." M3 is not a majority; the escape forms (M1 353 + destructured 118 + M2 131 ≈ 602) outnumber it. A mechanism rule built on `onResultOf` catches roughly a third of the
   corpus's real surface, not "the" pattern. So the honest claim is **"a frequent plain spelling,"
   not "the plain spelling."** A rule author must know the coverage ceiling (≈ the M3 share) or the
   green over-reads.

   The measurement therefore resolves open question 2's empirical test in a particular way: it is
   not false comfort (30% real coverage is not nothing), but it is **partial comfort** — the
   floor's job is done for the plain form, and the residual escapes (which outnumber it in total)
   are a stated, real ceiling, not an edge case.

2. **Is the plain-spelling boundary the right line, or is any boundary short of a taint tracker
   false comfort?** The class's counter-argument — "if you can't catch the adversarial case,
   you shouldn't catch the naive one either" — is the one this proposal must answer in review.
   The position stands, narrowed by the measurement (open question 1): mechanism invariants fail
   by _accident_ far more often than by contempt (the project's own `why-ts-archunit.md` premise:
   an agent optimises for green and has no reward signal for architecture, so it writes the plain
   form naturally, not the two-hop escape). The measured finding is that the plain form is the
   **largest single class at ~30%, not a majority** — so catching it is partial comfort, not
   false comfort, and the residual escapes (which together outnumber it) are a stated ceiling the
   author must be told about, not an edge case to elide.
3. **`await` elision:** §Design treats `await useSession(...)` + bind as one step (the await is
   beside the flow, not through it). Confirm that is the right line — the `.then(cb => cb(s))`
   form (M1) is already settled as residual, so the open question is only whether the _plain_
   `await`-then-bind should count, not whether the callback chain does.
4. **Predicate description as the finding identity — mechanism unverified, needs checking before
   implementation.** An earlier draft of this proposal asserted `identifyMatches` keys
   finding/baseline identity on a `.that()`-phase predicate's `description`; review found
   `identifyMatches` (`src/conditions/match-identity.ts`) actually operates on **matcher**
   descriptions inside body-analysis conditions, not on `.that()`-phase `Predicate<T>`
   descriptions narrowing the population — `onResultOf`'s contribution to a `notExist()`
   violation's identity more likely runs through `ArchCall.getName()`'s existing path instead
   (see §Design). Whichever mechanism is real, the new predicate's description (e.g.
   `"on result of 'useSession'"`) must be specified and stable, since a change orphans baselines
   — but the exact seam must be confirmed against `notExist()`'s actual identity derivation
   before the format is locked, not assumed.

## Appendix — the base-rate measurement (how it was run, and the traps found)

The numbers in §Open questions #1 came from a throwaway ts-morph script over the originating
corpus, and three classification traps had to be corrected before the table was trustworthy.
Recorded here so the measurement is reproducible and the numbers are believed:

**Corpus:** `cmless/packages/*/src/**/*.ts`, 281 files, excluding `*.test.ts`/`*.spec.ts`,
loaded via the cmless tsconfig (for symbol resolution) plus `skipAddingFilesFromTsConfig`.
**Scope:** every `CallExpression` whose callee is a `PropertyAccessExpression` whose receiver is
a bare `Identifier` (i.e. `s.update(...)` — a method call on a local). The 1,635 is that
population, not all calls.

**Classification traps (all three were hit, and each corrupts the number if missed):**

1. **Destructure must be checked BEFORE the call-initializer check.** `const { update } =
useSession()` has an object-binding name _and_ a call initializer; checking the initializer
   first misclassifies it as M3 (it is M2). The name-node pattern test must come first.
2. **M2-destructure-then-_bare_-call is invisible to a method-call scan by construction.** M2's
   call is `update({...})` — a bare call, not a `receiver.method` — so it never enters the 1,635.
   M2 had to be counted with a _separate_ scan over `VariableDeclaration`s whose name is an
   object binding pattern and whose initializer is a call. The 131 figure is that scan.
3. **Destructured receivers resolve to `BindingElement`, not `VariableDeclaration`.** A receiver
   bound via `const { client } = useSession()` (then `client.query()`) has a `BindingElement`
   declaration; an unguarded classifier lumps it into "other." It is separately counted (118) as
   its own escape class — plain-ish but out of the stated boundary.

**Reproduction sketch (ts-morph):**

```ts
import { Project, Node, SyntaxKind } from 'ts-morph'
import { globSync } from 'node:fs'

const files = globSync(
  '/Users/nps/Documents/Projects/NielsPeter/cmless/packages/*/src/**/*.ts',
).filter((f) => !/\.(test|spec)\.ts$/.test(f))
const project = new Project({
  tsConfigFilePath: '/Users/nps/Documents/Projects/NielsPeter/cmless/tsconfig.json',
  skipAddingFilesFromTsConfig: true,
})
for (const f of files) project.addSourceFileAtPath(f)

let total = 0,
  m3 = 0,
  sameFunction = 0,
  bindingElement = 0,
  aliasImport = 0,
  parameter = 0,
  otherDecl = 0
let m2Pattern = 0

for (const sf of project.getSourceFiles()) {
  // M2 base-rate: separate scan — destructure-of-a-call declarations
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer()
    let t = init
    if (init && Node.isAwaitExpression(init)) t = init.getExpression()
    if (t && Node.isCallExpression(t) && Node.isObjectBindingPattern(vd.getNameNode())) m2Pattern++
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (!expr || !Node.isPropertyAccessExpression(expr)) continue
    const receiver = expr.getExpression()
    if (!Node.isIdentifier(receiver)) continue
    total++
    const sym = receiver.getSymbol()
    if (!sym) {
      otherDecl++
      continue
    }
    const decls = sym.getDeclarations()
    if (decls.length !== 1) {
      otherDecl++
      continue
    }
    const decl = decls[0]
    if (Node.isImportSpecifier(decl) || Node.isNamespaceImport(decl) || Node.isImportClause(decl)) {
      aliasImport++
      continue
    }
    if (Node.isParameterDeclaration(decl)) {
      parameter++
      continue
    }
    if (Node.isBindingElement(decl)) {
      bindingElement++
      continue
    }
    if (Node.isVariableDeclaration(decl)) {
      const nameNode = decl.getNameNode()
      if (Node.isObjectBindingPattern(nameNode) || Node.isArrayBindingPattern(nameNode)) continue
      const init = decl.getInitializer()
      let target = init
      if (init && Node.isAwaitExpression(init)) target = init.getExpression()
      if (target && Node.isCallExpression(target)) {
        const callFn =
          call.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ??
          call.getFirstAncestorByKind(SyntaxKind.FunctionExpression)
        const declFn =
          decl.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ??
          decl.getFirstAncestorByKind(SyntaxKind.FunctionExpression)
        m3++
        if (callFn === declFn) sameFunction++
      }
      continue
    }
    otherDecl++
  }
}
```

`sameFunction` (97.7% of M3) is the honest-boundary check: the design's lexical-scope claim
holds for the overwhelming majority of the M3 population. Note `Node.isParameterDeclaration` is
the guard in the installed ts-morph (not `Node.isParameter`, which does not exist there).

**What the measurement is NOT:** it is not a count of mechanism-rule _violations_ — it is a
count of the _spelling distribution_ of one seam (method calls on local receivers) across a real
corpus. The transfer to "how much of a real mechanism rule's surface `onResultOf` catches"
assumes violations distribute like the general seam does; that is the residual, stated
assumption. A future re-measurement against an actual mechanism rule's violations would tighten
it, and the consumer repo (when available) is the natural second corpus.

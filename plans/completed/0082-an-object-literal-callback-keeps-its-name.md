# Plan 0082 — an object-literal callback keeps its name

**Status:** **DONE, 2026-08-04 (v0.46.0).** Filed 2026-08-03 out of
[plan 0079](./0079-triage-the-cardinality-only-assertions.md)'s Phase 2, and **rewritten
the same day** after an architecture review found the first draft aimed at the wrong layer. That
draft is recorded below, because the mistake is the useful part — and the rewritten version was a
one-line change where the draft would have been a new field plus a new predicate.
**Priority:** Low-medium. No false green today — but the rule an adopter would write is _writable
and selects nothing_, which is the vacuous-selection shape ADR-008 exists for, caught only because
plan 0074's empty-selection gate reds it.
**Effort:** Small. One call site changed to pass through data it already has.
**Blast radius:** **Published API, and NOT additive.** `ArchFunction.getName()` goes from
`undefined` to `'handler'` for object-literal callbacks, which changes `element` and message text on
every `within(...)` violation over one — and therefore changes **baseline hashes**, since
`hashViolation` is sha256(rule + element + message) (`src/helpers/baseline.ts:138`). Per
[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6 that is the top row: it needs a
`docs/upgrading.md` row telling adopters their baseline entries for these violations will need
regenerating, and a test that pins the hash change deliberately rather than discovering it.

## Problem

`extractCallbacks` throws the name away one line from where it is produced.
`src/helpers/callback-extractor.ts:61`:

```ts
return collectObjectLiteralFunctions(arg).map((olf) => ({
  fn: callbackArchFunction(olf.node), // olf.keyPath dropped here
  callSite,
  argIndex,
}))
```

`callbackArchFunction` routes arrows to `fromArrowExpression`, which hard-codes
`getName: () => undefined` (`arch-function.ts:114`). Meanwhile `fromObjectLiteralFunction(node, keyPath)`
(`arch-function.ts:277`) already exists, is already exported from `src/index.ts:142`, and already
computes the name via `qualifiedName(keyPath)` (`:304`).

Measured on

```ts
app.post('/multi', {
  preHandler: (req) => authenticate(req),
  handler: (req) => validateInput(req),
})
```

| Call                                                     | Result                          |
| -------------------------------------------------------- | ------------------------------- |
| `extractCallbacks(...)` → `fn.getName()`                 | `[undefined, undefined]`        |
| `extractCallbacks(...)` → `argIndex`                     | `[1, 1]` — the object's index   |
| `collectObjectLiteralFunctions(arg)` → `keyPath`         | `[['preHandler'], ['handler']]` |
| `fromObjectLiteralFunction(node, keyPath)` → `getName()` | `['preHandler', 'handler']`     |

So the data exists, the function that reads it exists, and the callback path does not call it.

**Consequence for an adopter.** This is _writable_:

```ts
within(calls(p).that().withMethod('post'))
  .functions()
  .that()
  .haveNameMatching(/^handler$/)
  .should()
  .notContain(call('db.query'))
```

and it selects **nothing**, because every callback is anonymous. Not "inexpressible" — worse:
expressible, plausible, and empty. It reds today only because plan 0074 made an empty selection a
finding; before that it was a silent pass.

## Phase 1 — stop dropping `keyPath`

```ts
return collectObjectLiteralFunctions(arg).map((olf) => ({
  fn: fromObjectLiteralFunction(olf.node, olf.keyPath),
  callSite,
  argIndex,
}))
```

`callbackArchFunction` keeps handling the **positional** path, where anonymity is correct.

**No new field, and no new predicate.** `ArchFunction.getName()` is the identity channel the
pipeline already reads — every condition in `src/conditions/function.ts` and
`body-analysis-function.ts` does `fn.getName() ?? '<anonymous>'`, and every name predicate keys on
it. `ScopedFunctionRuleBuilder extends FunctionRuleBuilder`, `haveNameMatching` is phase-aware
(`function-rule-builder.ts:130`), so `not()`/`or()`/`satisfy()` compose for free from
`core/combinators.ts`.

**Naming convention: dotted, matching `fromObjectLiteralFunction`.** A nested `hooks.onRequest`
becomes `'hooks.onRequest'`, because that is what `qualifiedName()` already produces at the other
call site. The first draft of this plan proposed pinning the bare `onRequest` and calling a later
change to dotted paths "a visible decision" — that would have made two surfaces disagree about one
node's identity and made `.excluding()` patterns depend on which surface produced the violation.

## Phase 2 — the baseline consequence, deliberately

Not optional and not a follow-up: it is the reason this is a published-API change.

1. A `within(...)` violation over an object-literal callback changes `element` from `<anonymous>`
   to the callback name, so its baseline hash changes. Pin the new hash, and assert the **old** one
   no longer matches, so the migration is a measured fact rather than a hope.
2. A `docs/upgrading.md` row: adopters with a baseline covering these violations regenerate it.
   State which shapes are affected — object-literal callbacks only; positional ones are unchanged.

## Test inventory

1. Two callbacks on one object literal are distinguishable by `getName()` — `['handler', 'preHandler']`.
   The case that motivated the plan.
2. A **positional** callback still reports `getName() === undefined`, and is identified by
   `argIndex`. The absent case asserted, not assumed. Two existing tests already pin this
   (`callback-extractor.test.ts:130, 341`) and must stay green — they are the guard that Phase 1 did
   not over-reach.
3. A method shorthand (`{ handler(req) {} }`) carries the name too.
4. Nested carries the **dotted** path, `'hooks.onRequest'`. _Shipped as a literal pin, not as the
   cross-surface comparison this row promised_ — the pin does catch a bare-vs-dotted regression
   (measured), so the coverage is real, but the write-up should say pin.
5. The motivating rule, end to end: `within(calls(...)).functions().that().haveNameMatching(/^handler$/)`
   selects exactly the handler and **not** `preHandler`. Without this the plan proves a field is
   populated and not that the gap is closed.
6. Vacuity: the fixture really produces two callbacks, or rows 1, 4 and 5 pass over nothing.
7. `callback-extractor.test.ts`'s local `identify()` helper is **deleted** and the tests read
   `getName()`. If it survives, the API did not close the gap it was written around.

## What the first draft got wrong, and why it is recorded

The first draft added `name?: string` to `ExtractedCallback`. Three faults, all found by review:

- **Inert.** The only in-library consumer of `ExtractedCallback` is
  `scoped-function-rule-builder.ts:30`, which does `.map((ec) => ec.fn)` and discards the rest. A
  `name` field would have been visible only to someone calling `extractCallbacks()` directly.
- **It would have needed a second identity path.** The draft's Phase 2 was "make it reachable from a
  rule", deliberately vague. That vagueness was not hiding the hard part — it _was_ the hard part,
  invented by solving the problem in the wrong place. Populating `getName()` deletes that phase.
- **The blast-radius line was optimised instead of the design.** `name?: string` is additive, and
  choosing it _because_ it is additive is how the real consequence — changed baseline hashes —
  stayed out of the header. The honest header is above.

## Out of scope

- **Resolving named references** (`app.get('/x', myHandler)`). Still deferred, still needs
  type-checker lookups, documented at `callback-extractor.ts:25`.
- **Renaming `argIndex`.** It stays, and stays the identity for positional callbacks.
- **A finding naming its sub-element generally.** Review noted that eight of plan 0079's conversions
  recover identity by regex over message prose (`/property "(\w+)"/`, `/at line (\d+)/`), which is
  this same gap at eight times the scale. That is a bigger plan and needs its own filing; this one
  is the narrow instance with a one-line fix.

## Related

- [Plan 0079](./0079-triage-the-cardinality-only-assertions.md) — found it, holds the measurement.
- `src/models/arch-function.ts:277` — `fromObjectLiteralFunction`, the function already written.
- `src/helpers/baseline.ts:138` — `hashViolation`, why this is not additive.

---

# What shipped

One line, as the rewritten plan predicted: `collectObjectLiteralFunctions(arg)` now passes
`olf.keyPath` to `fromObjectLiteralFunction` instead of discarding it. No new field, no new
predicate, and the motivating rule composes through `haveNameMatching` exactly as the plan argued.

**Two things the plan did not foresee:**

- **`fromObjectLiteralFunction` returns `ArchFunction | undefined`.** It falls back to the previous
  wrapper rather than filtering, because dropping an unrecognised node would turn an _anonymous_
  callback into a **missing** one — a silent under-report, strictly worse than the anonymity being
  fixed. `tsc` enforces this: removing the fallback is a type error, so the invariant is held by the
  compiler rather than by a comment.
- **The dotted-path decision cost two test updates**, and both were the plan being right. A test
  pinned the bare `onRequest`; the shipped behaviour is `hooks.onRequest`, matching what
  `fromObjectLiteralFunction` already produced at the other call site. The plan chose that
  deliberately — two surfaces disagreeing about one node's identity would make `.excluding()`
  patterns depend on which surface reported the violation.

**Test inventory row 7 was the real check.** `callback-extractor.test.ts`'s local `identify()`
helper — which walked `fn.getNode().getParent()` to recover a name the API would not give — is
deleted, and the tests read `getName()`. A test reaching around an API is the signal that the API is
missing something; the helper surviving would have meant the gap was still there.

**Sabotage, both arms:**

| Revert                                              | Result                               |
| --------------------------------------------------- | ------------------------------------ |
| `keyPath` discarded again (the defect)              | CAUGHT — names come back `undefined` |
| The `?? callbackArchFunction(...)` fallback removed | CAUGHT at compile time               |

**Blast radius, as declared:** `getName()` changes from `undefined` to the callback's name for
object-literal callbacks, which changes `element` and message text on `within(...)` violations over
them — and therefore their baseline hashes. That is in `docs/upgrading.md` as a minor-version note.
Positional callbacks are unchanged and still anonymous, which is asserted rather than assumed.

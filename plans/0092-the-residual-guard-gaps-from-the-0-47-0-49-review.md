# Plan 0092 — the residual guard gaps from the v0.47–0.49 review

**Status:** Open, not started. Filed 2026-08-04. These are the items from the five-persona review of
v0.47.0–v0.49.0 that were **triaged and deliberately not done** in v0.49.2, recorded so the deferral is a
decision rather than an omission.
**Priority:** Low-medium. Each is a guard that could be stronger; none is a live defect, and I verified
that individually before deferring each one.
**Effort:** Small. Five independent items, none coupled to the others.
**Blast radius:** **An internal check over a corpus we control** — our own test suite. Per
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 that is the bottom row: prove each detector
fires once and stop. Do not build machinery for these.

## Why this is a plan and not eight more bugs

v0.49.2 fixed the six review findings that were _reachable from a user's rule_ or _provably vacuous_. What
remains is a different class: guards that work, whose evidence is weaker than it could be. Filing each as
a bug would overstate them; leaving them in a reviewer's message would lose them.

## The five items

### 1. The independent derivation is sitting one row away and they never meet

`tests/conditions/re-export-edges.test.ts` asserts `new Set(lines).size === lines.length` — distinctness
without a churn-sensitive total, which is right. The _next_ row counts re-export lines with a regex. Neither
compares against the other, so the whole thing is self-consistency: the implementation agreeing with itself.

**Do not compare line sets.** Measured by the reviewer: 57 violation lines against 52 single-line regex
matches, and the five extras are **prettier-wrapped multi-line `export { … } from` statements**, where the
graph reports the statement's start line and `/^export .*from '/gm` misses it entirely. Naive equality
would false-red on formatting.

Compare **specifier sets** instead — `/from '(\.\/(?:core|helpers)\/[^']+)'/g` over the file text, against
the resolved `importPath` set. Text versus compiler resolution is two kinds of evidence, which is what rule
5 asks for.

### 2. `export type * as N from` has no cycle-path row

It is in the per-form classification table and behaves correctly on the graph path — measured: erased by
default, reported under `{ ignoreTypeImports: false }`. It is the only entry of the emit table whose
behaviour lives solely in the classification test. One row in the cycle file closes it.

### 3. The `edgeStream`/`edgesOf` agreement row is in-memory only

Low risk — both go through one `makeEdge`, so `resolvedPath` and `line` share a code path. But the row
exists _because_ the cold path is unobservable through its only consumer, and on-disk resolution is the one
input it never exercises. One extra loop over `project(ON)`'s files.

### 4. A comment overstates what its row proves

`CONTROL a nested arrow does not inherit the outer docstring` in `tests/conditions/stubs.test.ts`. The
reviewer could not construct a mutation this row catches: making `triviaRoot` reach the enclosing
`FunctionDeclaration` — literally the over-reach the comment names — is a **semantic no-op**, because trivia
dedup is keyed by comment position. Making it return the whole `SourceFile` **is** caught, but by
`tests/helpers/comment-matcher-reports-every-hit.test.ts` and `tests/presets/agent-guardrails.test.ts`,
never by this row.

Harmless, and the comment should say what it does: it pins current behaviour, and the over-reach it names is
guarded elsewhere. A comment claiming a guard that is not there is the same class as the prose v0.49.1 spent
a release correcting.

### 5. The cycle exclusion becomes a stale warning when bug 0054 is fixed

`tests/archunit/arch-rules.test.ts`' `.excluding('[builders, conditions, helpers, predicates]')` is
fail-closed if the cycle's _shape_ changes, as claimed. But when
[bug 0054](../bugs/fixed/0054-within-makes-helpers-depend-on-builders.md) is **fixed**, the exclusion goes stale
and the only signal is a `writeStderr` "Unused exclusion" line: a warning, green build, for a finding whose
remedy — delete the line — is not optional.

Pre-existing mechanism; this release is what put a `.check()` rule behind it. The general fix is
[plan 0090](./0090-a-warn-that-expires.md)'s territory; the specific one is to delete the exclusion in the
same commit that fixes 0054, which belongs in 0054's own test inventory. Add it there rather than solving it
here.

## Also verified sound, recorded so nobody re-checks

- **Mutating `verbatimModuleSyntax` after `edgesOf` has cached a file returns the new answer**, because
  ts-morph replaces the source files and `onModified` fires. Measured twice, independently, by two
  reviewers. Untested, and it would go stale silently if ts-morph changed — but adding a test for a
  third-party invalidation guarantee is the wrong shape. A comment at the cache is enough, and v0.49.1 has
  one.
- **`comment(STUB_PATTERNS)` through the `modules()` entry point** is the same regex over the same matcher,
  so it cannot diverge from the `functions()` path. Noted for completeness, not a gap.
- **Three `erasesRequest` branches are unreachable** (`dynamic` and `require` are never `typeOnly`).
  Reverting them is a semantic no-op. If a future matrix lists them, mark them **unreachable** rather than
  uncaught — the distinction is the point of ADR-008 rule 5's new corollary.

## Test inventory

One row per item above, except item 5, which moves to bug 0054's inventory. Each must be verified to fail
against the specific mutation it targets — the standard v0.49.2 held itself to, and the reason three of
these are worth doing at all.

## Out of scope

- **Converting the rest of the suite to identities.** `stubs.test.ts` was the offender and is done. A sweep
  for the sake of a sweep is how a number gets moved instead of a risk.
- **Anything reachable from a user's rule.** That was v0.49.2, and if something in this class turns out to be
  reachable it becomes a bug rather than an item here.

## Related

- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5 — the bundled-revert corollary this review
  produced, and rule 6, which is why these are one small plan rather than eight bugs.
- [Bug 0054](../bugs/fixed/0054-within-makes-helpers-depend-on-builders.md) — item 5 belongs to its inventory.
- [Plan 0090](./0090-a-warn-that-expires.md) — item 5's general form.

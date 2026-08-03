# Plan 0081 — a condition declares discovery-diagnosis ownership, not its builder

**Status:** **DONE, 2026-08-04 (v0.46.0).** Filed 2026-08-03 from the architecture review of
v0.44.0/v0.45.0. Shipped as specified — one module-private symbol, three tagged conditions, the
builder reading the tag, and the four Phase 2 rows including the one that pins the untagged default.
**Priority:** Medium. Nothing is broken today — v0.45.1 closed the hole this granularity gap
exposed — so this is hardening a seam whose failure mode has already fired once.
**Effort:** Small. One module-private symbol, three tagged conditions, one predicate body, and the
tests that pin the untagged default.
**Blast radius:** Internal seam with a **published** consequence. `ownsDiscoveryDiagnosis()` is on
`TerminalBuilder`, which `docs/api-reference.md` documents as externally subclassable, so the
default behaviour for an untagged condition is user-visible. Per
[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6 that puts it above "internal check
over a corpus we control": the default must be proven, not argued.

## Problem

`ownsDiscoveryDiagnosis()` is declared **per builder**. Ownership is really **per condition**.

`PairFinalBuilder` returns `true` because the three cross-layer conditions produce a finding that
names the dead layer, which beats the gate's generic message. But the declaration covers the
builder, so it suppresses the gate for _every_ condition reachable through that builder —
including one that does not produce the finding.

That is not hypothetical. At v0.45.0 `PairFinalBuilder` returned `true` while the docstring at
`cross-layer-builder.ts:215` claimed "All three now produce a finding naming the layer", and that
claim was **false**: `haveMatchingCounterpart` checked for empty layers inside its pair loop, so a
dead **final** layer produced no configuration finding at all. The coarse declaration suppressed
the gate for exactly the case its declared owner did not handle. Measured: 0 configuration
findings and 2 ordinary "has no matching counterpart in layer ghost" violations, advice that
cannot work.

v0.45.1 fixed the condition, so today all three do own it and the declaration is true again. The
granularity gap is what let a false claim in a docstring become a silent gap in the gate — and it
will do so again for the next condition added to that builder, because nothing forces the new
condition to say anything.

## The shape to copy already exists

`src/core/cardinality.ts:25`:

```ts
export const ASSERTS_CARDINALITY: unique symbol = Symbol('ts-archunit.assertsCardinality')
```

Module-private, deliberately **not** re-exported from `src/index.ts`, so a user condition cannot
set it and permanently exempt itself from a gate. That is the same problem — "a condition declares
a capability the gate must respect" — with rule 3's by-construction protection already reasoned
out. Reuse the reasoning rather than inventing a second mechanism (the ADR-006 lesson, and the
`.excluding()`/`not()` duplication lesson from the proposal-review skill).

## Phase 1 — the symbol

```ts
// src/core/owns-empty-discovery.ts — NOT re-exported from src/index.ts
/**
 * A condition that reports a dead discovery population ITSELF, better than the
 * gate can. Module-private for the same reason as ASSERTS_CARDINALITY: a user
 * condition that could set this would exempt itself from the gate permanently,
 * with no signal that it had.
 */
export const OWNS_EMPTY_DISCOVERY: unique symbol = Symbol('ts-archunit.ownsEmptyDiscovery')
```

Tag the three cross-layer conditions. Then:

```ts
// PairFinalBuilder
protected override ownsDiscoveryDiagnosis(): boolean {
  return OWNS_EMPTY_DISCOVERY in this.condition
}
```

`SliceRuleBuilder` keeps its builder-level `true`. Its ownership genuinely **is** per-builder — a
property of `assignedFrom`'s fan-out, not of any condition — and that difference is the argument
for keeping both granularities rather than converting everything.

**The load-bearing property:** an untagged condition does not own it, so the gate covers it. Under
that shape the v0.45.0 hole degrades to a generic message instead of silence, and a generic
message is recoverable — an agent reading "this glob matched nothing" fixes the glob. Silence
sends it to write files into a layer that will never match.

## Phase 2 — prove the default

Rule 6 puts the default above the "prove each detector fires" floor, because it is what an
external subclass gets without doing anything.

1. A pair condition with no tag, on a dead layer → the **gate's** finding fires, one finding, not
   silence. This is the row that fails if the default ever flips to exempt.
2. All three shipped conditions tagged → their own finding fires, and the gate's does not, so the
   better message is not lost. Assert on `element`, not a count — the layer name is the thing that
   makes it better.
3. `OWNS_EMPTY_DISCOVERY` is **not** exported from `src/index.ts`. Same test shape as the existing
   one for `ASSERTS_CARDINALITY`; without it, "module-private" is a comment rather than a fact.
4. Vacuity: the untagged-condition fixture really does resolve a dead layer, or rows 1 and 2 both
   pass over nothing.

## Files changed

| File                                             | Change                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/owns-empty-discovery.ts`               | New. The symbol and its reasoning.                                                                                                                      |
| `src/conditions/cross-layer.ts`                  | Tag all three conditions.                                                                                                                               |
| `src/builders/cross-layer-builder.ts`            | `ownsDiscoveryDiagnosis()` reads the tag; fix `:215`'s docstring claim to describe the mechanism rather than assert a fact about three implementations. |
| `src/core/terminal-builder.ts`                   | Document that the default is `false` and why.                                                                                                           |
| `docs/api-reference.md`                          | The `ownsDiscoveryDiagnosis()` row gains the per-condition detail.                                                                                      |
| `tests/core/a-dead-discovery-glob-fails.test.ts` | Phase 2's four rows.                                                                                                                                    |

## Out of scope

- **Converting `SliceRuleBuilder`.** Its ownership is per-builder and correctly so.
- **Re-exporting the symbol.** That is the whole protection.
- **The `{ selector, discovery }` return shape.** Review proposed
  `readonly { finding: ArchViolation; position: GlobPosition }[]` instead, to keep policy out of
  the data type. Declined: the two buckets make the precedence explicit at the one call site that
  decides it, and the alternative moves that decision into a caller that would have to re-derive
  it. Revisit only if a third position needs precedence.

## Related

- [Bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md) — the defect whose final-layer half this granularity gap concealed.
- [Plan 0080](./0080-admit-discovery-globs-to-the-dead-glob-gate.md) — introduced `ownsDiscoveryDiagnosis()` at builder granularity.
- `src/core/cardinality.ts` — the precedent being copied.

---

# What shipped

Exactly the plan, with one thing worth recording that the plan did not anticipate.

**The default is the deliverable.** `OWNS_EMPTY_DISCOVERY in this.condition` replaced `return true`,
so an untagged condition — an external one, or the next one added to this builder — is **covered by
the gate** rather than silently exempt. Under the old blanket declaration, v0.45.0's hole produced
silence; under this shape the worst case is the gate's generic message, which an agent can act on.

**Sabotage, 3 of 3, baseline green before each and restored after:**

| Revert                                                 | Result |
| ------------------------------------------------------ | ------ |
| `ownsDiscoveryDiagnosis()` back to a blanket `true`    | CAUGHT |
| One of the three conditions untagged                   | CAUGHT |
| `OWNS_EMPTY_DISCOVERY` re-exported from `src/index.ts` | CAUGHT |

The third row is the one that makes "module-private" a fact rather than a comment. Without it the
symbol could be exported in a later refactor and become the one-line silent opt-out that
`ASSERTS_CARDINALITY` was reshaped to prevent.

**What the plan got right and why:** it insisted the ownership question was per-condition, and the
evidence was already in the repo — the builder's own docstring asserted a fact about three
implementations, and that fact had been false for one of them for two releases. A prose claim about
N implementations is a hand-maintained list; the tag is a derivation.

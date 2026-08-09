# Proposal 027 — A Rule That Cannot Fire Says So

**Status:** Proposed.
**Priority:** High — this is the mechanical half of
[bug 0077](../bugs/0077-a-non-empty-examined-count-proves-neither-falsifiability-nor-scope.md)A, which
is today filed as review-enforced residue. Every guard we own is green on the failure it describes.
**Affects:** the families that can cheaply know they are inert — `smells.inconsistentSiblings` first,
then `correspondence` and `crossLayer`. New configuration-finding causes; no new public API required
for the first family.
**Related:** [ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md) (whose evidence standard this
extends), [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 1 and rule 2,
[plan 0099](../plans/completed/0099-the-floor-no-family-can-be-born-below.md) (the floor this sits one
level above), [proposal 026](./026-sabotage-is-a-command-not-a-ritual.md) (the other half — 026
mechanises _checking_ falsifiability, this mechanises _reporting_ it).
**Evidence:** measured 2026-08-09 while writing `tests/archunit/dogfood.test.ts`. One rule, one
measurement, and it is the whole argument.

> **`examined: 11`, `violations: 0`, and no possible corpus makes it fail.** The floor asks whether a
> rule examined anything. It did — everything in the folder. What it could never do is produce a
> finding, and the rule had already computed the number that proves it.

## Problem

### 1. The measurement

```ts
smells.inconsistentSiblings(p).inFolder('**/src/builders/**').forPattern(call('copy'))
// examined: 11   violations: 0
```

`inconsistentSiblings` reports a **minority diverging from its siblings** — its own message is
`"5 of 7 files in <dir> use call to 'X'"`. Only 4 of the 11 builders call `copy()`, so there is no
majority for anyone to diverge from, and the rule is structurally incapable of a finding.

Every mechanical guard passes it:

| Guard              | Verdict                                            |
| ------------------ | -------------------------------------------------- |
| The floor (0099)   | passes — `examined` is 11, not 0                   |
| The vacuity matrix | passes — the cell reports a finding when it should |
| The compiler       | passes — evidence present, sited at the right seam |
| `diagnose()`       | silent — the glob is alive and matches 11 files    |

It shipped green in a test file whose entire subject is that green must mean something, and was found
only because someone asked which corpus edit would turn it red.

### 2. The rule already knows

This is what makes it worth doing rather than filing as residue. `inconsistentSiblings` computes the
majority/minority split to build its message. At the moment it decides "no minority to report", it is
holding the two numbers that prove it could not have reported anything: **4 of 11 hold the pattern, so
no file can diverge from a majority that does not exist.**

The information is present, at the right seam, at the right time. It is discarded.

### 3. The user-facing cost

An author writing that rule gets silence, and reads silence as "my builders are consistent". They are
not — the rule never asked. This is the 0.18.0-era failure mode ("the tool failed open") displaced one
level: not _"the selector matched nothing"_ but _"the selector matched everything and the condition
cannot speak"_.

## The honesty line — measured vs estimated

**Measured:** the `examined: 11 / violations: 0` case and the 4-of-11 split; that all four guards above
pass it; that `inconsistentSiblings` computes the split it would need.

**Estimated, and flagged because the whole proposal turns on it:** that `correspondence` and
`crossLayer` have comparably cheap inert conditions. Plausible — a `correspondence` whose two sides
share **no** key namespace can never be incomplete, and a `crossLayer` whose mapping yields pairs but
whose condition is trivially satisfiable is the same shape — but **not measured**, and the design below
is deliberately staged so that the first family can ship without committing to the others.

## Design

A fourth cause for the configuration finding the floor already emits, raised **by the family** rather
than at the root — the same inversion plan 0099 chose, and for the same reason: the root cannot
enumerate what "inert" means per family, and any list it holds will be missing the next one.

```
This rule examined 11 sibling files, but its pattern is held by 4 of them. It reports a
file that diverges from what its siblings do, so with no majority present it cannot
produce a finding as written today. Either widen the folder so a majority forms, or
choose a pattern the siblings already share — `validateOverrides` is held by 5 of 7 in
src/presets. This finding cannot be suppressed …
```

Three properties it must have, each from an existing standard:

- **`bypassFilters: true`** — it reports that the rule enforces nothing, which is not a severity the
  author gets to grade (ADR-008 rule 1, and the class `checkAll` already dedupes).
- **A remedy verified to remediate** (rule 2). "Widen the folder" and "choose a shared pattern" are
  both checkable by applying them — the second is exactly the edit that turned the dogfood rule from
  worthless to sabotage-CAUGHT.
- **Per-family, opt-in by implementation.** A family that cannot cheaply answer "could I have fired?"
  answers nothing and is unchanged. Silence is the default; this adds no cost to families that do not
  implement it.

Staging:

1. `smells.inconsistentSiblings` — the measured case, and the only one this proposal claims.
2. `correspondence`, `crossLayer` — after measuring whether an inert condition is cheaply detectable.
   If it is not, they stay out and the proposal is still worth its cost.

## Why it fits

- It converts bug 0077A from _"review-enforced residue"_ into a mechanical answer **for the cases where
  the rule already holds the evidence** — which is the only honest scope for it. Falsifiability in
  general is a property of semantics against a corpus and cannot be typed; falsifiability of _this
  detector, on this corpus, right now_ is a number it already has.
- It follows the floor's own ruling: ask the builder, do not enumerate at the root. The four vacuity
  waves before 0099 each closed an enumeration and were followed by a family outside it.
- It is the shape of the findings that already work. Three configuration findings caught API misuse in
  a single session — `inFolder('src')` matching nothing, a patternless detector, a boundary glob
  needing `**/` — each naming the exact fix. This adds a fourth to that family.

## Non-goals / risks

- **Not general falsifiability.** No claim is made about rule families that cannot cheaply self-assess,
  and none about user-written conditions via `defineCondition` — already named as residue in ADR-009
  part 1.
- **Not a replacement for sabotage.** [Proposal 026](./026-sabotage-is-a-command-not-a-ritual.md) is
  the general method; this catches one species at runtime, cheaply, before anyone thinks to sabotage.
- **False positives are the real risk.** A rule that _could_ fire on a corpus that merely does not
  today must stay silent, or this becomes noise and gets turned off — the fate of
  [bug 0076](../bugs/0076-duplicate-body-similarity-erases-identifiers-so-every-wither-pairs.md)'s
  detector. The test is **structural impossibility given the current corpus**, not improbability. If
  that line cannot be drawn crisply for a family, that family does not get the finding.
- **It changes `check()` behaviour** for rules that pass today, so it is a minor release with an
  upgrading row, on the 0.59.0 pattern.

## Acceptance

- The measured case fails, with the numbers in the message: `smells.inconsistentSiblings(p)
.inFolder('**/src/builders/**').forPattern(call('copy'))` reports the finding rather than passing.
- The replacement rule that **can** fire — `forPattern(call('validateOverrides'))` over `src/presets`,
  with `index.ts` and `shared.ts` ignored — stays green.
- Deleting `validateOverrides` from one preset still turns that rule red (the existing sabotage must
  not be masked by the new finding).
- A vacuity-matrix row for the new cause, and the finding is `error` under `.warn()`.

## Open questions for review

1. **Is "no majority" the right predicate**, or should it be the weaker "no possible single-file edit
   produces a finding"? The latter is more honest and more expensive; the former is what the family
   already computes.
2. **Does this belong to the family or to `SmellBuilder`?** If `correspondence` and `crossLayer` turn
   out to have the same shape, a shared `cannotFire(): string | undefined` hook on `TerminalBuilder`
   is the natural home — but designing that hook from one instance is the mistake ADR-009's Context
   table documents four times.
3. **Severity.** Rule 1 says a finding the reader must judge should warn. Is "your rule cannot fire"
   a judgement call, or is it the non-optional class the floor already treats as `error`? The draft
   assumes the latter; it is the most contestable claim here.

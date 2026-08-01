# Plan 0079 — Triage the cardinality-only assertions

**Status:** Open, not started. Filed 2026-08-01 out of the ADR-008 compliance audit, which
produced the number but deliberately did not act on it.
**Priority:** Low. Nothing here is a known defect — it is an unexamined population that may
contain some.
**Effort:** Small to start. Sampling 30 is an hour; what follows depends on what the sample says.
**Blast radius:** Internal test quality over a corpus we control. Rule 6's floor: sample, decide,
stop. This does not earn a second round.

## Problem

[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5's third corollary: _counting is the
shortcut. Compare identities — sets of `file:line`, sets of names — not integers._ A test that
asserts `toHaveLength(3)` passes when a change loses one finding and gains another.

A scan over the suite found **215 of 2 791 `it()` blocks (8%)** that assert a **non-zero**
cardinality with no identity assertion anywhere in the block. `toHaveLength(0)` was excluded —
the empty set _is_ an identity.

Concentrations: `callback-extractor` (13), `descendant-cache` (8),
`typescript-function-module` (8), `dependency` (7), `structural` (7),
`held-builder-is-immutable` (7), `matchers-typescript` (6), `load-rules` (5).

## What this number is, and is not

**It is an upper bound from a heuristic scan, and it has known false positives.** A spot-check
found legitimate members immediately: `complexity.test.ts` counts decision points, where the
count _is_ the value under test, and a metric assertion is an identity assertion. The scan's
identity signals are a regex over method names, so anything asserting identity through an unusual
idiom is miscounted.

Publishing the 215 as a defect list would be the shape this project spends its guards avoiding —
a number standing in for an examination nobody did. Hence a plan to _look_, not a plan to fix.

## Phase 1 — sample thirty, decide

Draw 30 at random from the 215, seeded and recorded so the sample is reproducible. Classify each:

| Class | Meaning                                                                                        | Action                    |
| ----- | ---------------------------------------------------------------------------------------------- | ------------------------- |
| **A** | Count is the value under test (metrics, complexity, caches)                                    | None. Correct as written. |
| **B** | Count is a proxy, but the block is a unit test of a pure function whose output has no identity | None. Record why.         |
| **C** | Count stands in for identity, and the test would pass on a swap                                | Fix.                      |

The decision rule, before looking: **if class C is under ~15% of the sample, stop and close this
plan with the measurement.** The population is then mostly A and B, and converting 215 blocks to
satisfy a rule that does not apply to them is churn. If C is above that, Phase 2.

## Phase 2 — fix class C, by concentration

Only if Phase 1 warrants it. Work the concentrated files first: a file with seven such blocks
usually shares one helper, so one fix converts several. Prefer the shape the rest of the suite
already uses — `expect(names.sort()).toEqual([...])` over `expect(names).toHaveLength(n)`.

## Test inventory

None of its own. This plan changes tests; the guard that it changed them correctly is that each
converted test must **fail on a swap** — losing one element and gaining another. Demonstrate that
on two converted tests, per rule 6's floor, and record it.

## Out of scope

- **The scan itself becoming a lint rule.** Tempting and wrong: the false-positive rate is the
  whole problem, so a rule enforcing this would red on classes A and B forever. If Phase 1 finds
  the population is mostly C, revisit.
- **`toHaveLength(0)` assertions.** The empty set is an identity.

## Related

- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5, "counting is the shortcut".
- [Bug 0028](../bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — what
  a cardinality-vs-identity confusion costs when it reaches production: 8 colliding pairs of 47.

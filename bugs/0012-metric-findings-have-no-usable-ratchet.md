# Bug 0012: Improving a metric turns the build red

**Reported:** 2026-07-25
**Found in:** all versions through v0.18.1 (and unchanged by the bug 0010 spike)
**Severity:** High — it makes the entire size/concentration rule family unadoptable on any codebase that already exceeds a threshold, which is the only kind of codebase that needs them.

## Description

Metric conditions write the **measured value** into the message:

```
Big has 10 methods (max: 5) — consider splitting into focused classes
```

`hashViolation` identifies a violation by its message, so the identity changes
whenever the measurement changes — in **either** direction. Baseline a class at
10 methods and delete two, and the finding is reported as new.

## Reproduction

`classes(p).should().satisfy(maxMethods(5))`, baselined at 10 methods:

| change                     | should be | actually is |
| -------------------------- | --------- | ----------- |
| 10 → 10 methods, unchanged | green     | green       |
| 10 → 12, **worse**         | red       | red         |
| 10 → 8, **better**         | green     | **RED**     |
| 10 → 5, at the threshold   | green     | green       |

The third row is the defect: **paying down the debt fails CI**, and it keeps
failing on every incremental step until the class drops under the threshold
entirely. A team that splits four methods out of an 87-method service gets a red
build for their trouble.

## Affected conditions — the full set

Enumerated mechanically rather than by memory (the first draft of this report
cited only `rules/metrics.ts`, which was one corner of it):

| Site                                | Message shape                                     |
| ----------------------------------- | ------------------------------------------------- |
| `src/rules/metrics.ts:94`           | `has N lines (max: M)`                            |
| `src/rules/metrics.ts:127`          | `has N lines (max: M)` — per member               |
| `src/rules/metrics.ts:162`          | `has N methods (max: M)`                          |
| `src/rules/metrics.ts:197`          | `has N parameters (max: M)` — per member          |
| `src/rules/metrics-function.ts:65`  | `has N lines (max: M)`                            |
| `src/rules/metrics-function.ts:101` | `has N parameters (max: M)`                       |
| `src/conditions/members.ts:268`     | `has N properties, max allowed is M`              |
| `src/conditions/exports.ts:97`      | `has N named export(s), exceeding the limit of M` |

**Eight sites, two of them outside `rules/metrics.ts` entirely.** Any fix has to
be a shared mechanism rather than eight message edits — which is the argument
for the threshold ratchet below rather than for scrubbing the numbers out of
each string.

## Why the bug 0010 fix does not cover this

0010 added `ArchViolation.identity` for exactly this class — a message that
states a derived population rather than a fact about the element. Applying it
naively here makes things **worse**:

| identity contains | improving to 8 | regressing to 12 |
| ----------------- | -------------- | ---------------- |
| the count (today) | **red** ✗      | red ✓            |
| no count          | green ✓        | **green** ✗      |

Dropping the count turns the baseline into a mute button: once accepted, a class
may grow without limit and stay green. Neither choice is right, because identity
matching answers "is this the same finding?" and a metric needs "is it worse
than what we accepted?" — a comparison, not an equality.

## Suggested fix

A **per-element threshold ratchet**: the baseline records the accepted
measurement, and the finding fires only when the current value exceeds it.
Sketch:

- give the violation a stable identity (element + metric, no value) so the entry
  can be found across runs, and
- store the measured value in the baseline entry, and
- fail when `current > accepted`, not when `current !== accepted`.

Note this is a **per-element** comparison, which is a different thing from the
global violation budget rejected in
[proposal 018](../proposals/018-adoptable-discovery-surface.md). That rejection
stands and is unrelated: a global count cannot say which finding got worse,
whereas this comparison is anchored to one element and one metric. ADR-008 rule
5 objects to cardinality standing in for identity; here identity selects the
entry and the number is the thing being ratcheted, which is the point of a
metric.

Open question for the design: what happens when the accepted value should be
lowered? A ratchet that only ever loosens on regeneration is a ratchet in name
only, so `baseline` regeneration probably needs to tighten accepted values
automatically while refusing to loosen them without an explicit flag.

## Notes

Found by checking the bug 0010 spike against the external coverage audit that
motivated it. That audit recommends adopting the size/concentration metrics
"behind a ratchet (accept today's god objects, block new regressions)" and notes
they sit at **zero uses** because they fail loudly on day-one legacy. The
measurement above is a better explanation for the zero: the ratchet they were
told to use does not work for them, and the failure mode punishes exactly the
cleanup the rules exist to encourage.

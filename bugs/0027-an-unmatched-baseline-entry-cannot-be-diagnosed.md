# Bug 0027: an unmatched baseline entry cannot be diagnosed unless _every_ entry is unmatched

**Reported:** 2026-07-29
**Found in:** all versions through v0.23.0
**Severity:** Medium — an already-accepted violation is reported as **new**, with no
indication that the baseline is the reason. The reader sees what looks like fresh rot in
application code. The finding whose entire purpose is to explain this exists and is
correct; it just cannot fire in the common case.

## Description

`Baseline.filterNew` counts matches and asks `unmatchedBaselineFinding` for a meta-finding.
That finding returns `undefined` unless `matched === 0` (`src/helpers/baseline.ts:316`).

The `matched === 0` gate is deliberate and well argued in its own docstring: an earlier cut
fired whenever the file's `hashVersion` was older, which was a false red for the majority
of users, because the hash function is byte-identical across versions for any violation whose
fields contain no path. Gating on the measurement rather than on the version label was the
right correction.

But it leaves the **partial** miss undiagnosed, and a partial miss is what every real cause
except a wholesale root change produces:

- v0.23.0's accumulate change lengthens the rule description — which is hashed — for rules
  derived off a held rule and for a `satisfy(condition)` written before `.should()`. Those
  entries stop matching; the rest keep matching.
- Any edit to a rule's predicates or conditions changes its description, so the entries for
  that one rule stop matching while every other rule's entries are fine.

In all of these, `matched > 0`, the finding is silent, and the unmatched entries surface as
new violations.

## What makes this hard, and why the obvious fix is wrong

A baseline entry that stops matching because **the violation was fixed** is the normal,
healthy case — that is what a ratchet is for. So "some entries did not match" is not
evidence of anything by itself, and a finding on that would red the most common good
workflow. Any fix has to distinguish:

| Entry did not match because…             | Correct response          |
| ---------------------------------------- | ------------------------- |
| the violation was fixed                  | silence (this is success) |
| the rule's **description** changed       | say so; regenerate        |
| the baseline was written elsewhere/older | say so; regenerate        |

`matched === 0` is currently the only signal that can tell "something is systematically
wrong" from "you fixed things", which is why it was chosen.

## Suggested fix

Store enough beside each hash to tell the three cases apart. `BaselineEntry` already carries
`rule` (`src/helpers/baseline.ts:40`) — that is the differently-derived value this needs.
A description-change miss is then detectable without guessing:

> an entry whose `rule` string appears in this run under a **different** hash

That is a rule whose identity changed, not a violation that was fixed, and it can be reported
per entry with the rule named. A missing `rule` string with no counterpart in the run is a
fixed violation, and stays silent.

Do not reintroduce a version-label trigger. The v2→v3 attempt in plan 0070's 0.23.0 draft was
withdrawn precisely because the label cannot distinguish these cases: `hashViolation()` never
reads it, so it carries no information about whether hashing changed.

## Guard this needs

- A baseline where one entry's rule description changed and one entry still matches: the
  finding fires, names the rule whose description changed, and the matching entry is still
  filtered out.
- A baseline where one entry's violation was **fixed** and the rest match: **no finding** —
  this is the false-red case, and it is the one the guard exists to pin.
- A wholesale root mismatch still produces today's `matched === 0` finding with today's
  root-mismatch cause text.
- The three causes' texts are asserted to be distinct, and each one's remedy is verified to
  remediate (ADR-008 rule 2's behavioural corollary): apply the stated fix, assert the finding
  clears.

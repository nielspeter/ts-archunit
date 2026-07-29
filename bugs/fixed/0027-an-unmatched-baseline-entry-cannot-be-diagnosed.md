# Bug 0027: an unmatched baseline entry cannot be diagnosed unless _every_ entry is unmatched

**Reported:** 2026-07-29
**Fixed:** 2026-07-29 (v0.24.0)
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

## How it was fixed

**v0.24.0 — and not by the mechanism this report suggested.**

The suggestion above was to report "an entry whose `rule` string appears in this run under a
different hash". That cannot work, and it was measured before anything was built: **the rule string
is precisely what changed.** A description change alters `rule` and leaves `element` and `message`
untouched, so comparing rule strings finds nothing.

What survives is the violation's **subject**. `hashSubject(violation, root)` hashes
`element::message` — identity without the rule description — and `BaselineEntry.subject` records it
alongside the full hash. Then the three cases separate cleanly:

| entry did not match because…   | subject present in the run? | response                        |
| ------------------------------ | --------------------------- | ------------------------------- |
| the violation was fixed        | no                          | silence — this is success       |
| the rule's description changed | yes, under a different hash | name both spellings; regenerate |
| the baseline is wholly wrong   | (`matched === 0`)           | the pre-existing finding        |

`subject` is optional, so a baseline written before 0.24.0 still loads and simply cannot be
diagnosed. That is honest degradation; guessing a cause is what the withdrawn `HASH_VERSION` bump
did.

**The specific diagnosis supersedes the generic one, and disproves it.** `unmatchedBaselineFinding`
fires on `matched === 0` and, in the same-version case, tells the reader the likely cause is a
differently-resolved repository root. But a detected description change means a stored _subject_
matched — and subjects are scrubbed with the same root as hashes — so the root is demonstrably
resolving consistently and that explanation is false. Reporting both would put two contradictory
causes in one run.

That interaction was found by three of the new tests failing: with a single-entry baseline
`matched === 0`, so they selected the generic finding by index and saw the root-mismatch text.

## Also corrected here

- The false-red case is the first test in the file, and everything else is only safe because it
  holds: an entry that stops matching is _normally success_, which is why the pre-existing finding
  was gated on `matched === 0` in the first place.
- One assertion of mine measured the wrong thing — `RULE_AFTER` contains `RULE_BEFORE` as a prefix,
  so counting the description text counts the overlap rather than the grouping. It counts the
  `was:` marker instead.
- The remedy names its `<your-rule-files>` argument, so the command it prints runs.

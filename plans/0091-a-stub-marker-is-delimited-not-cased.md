# Plan 0091 — a stub marker is delimited, not cased

**Status:** Open, not started. Filed 2026-08-04 from the v0.47.0–v0.49.0 review.
**Priority:** Medium. A false-negative direction on a rule that ships at `error` in the preset aimed at
generated code — so nothing tells the user.
**Effort:** Small-medium. One regex; the work is the corpus it is calibrated against.
**Blast radius:** **Published API, and it ADDS findings.** Widening the pattern reds builds that are green,
which is the same shape as plan 0085 and needs the same migration care — plus
[bug 0060](../bugs/fixed/0060-a-pattern-change-silently-invalidates-every-baselined-finding.md) means it moves
every baselined stub finding's hash.

## Problem

[Bug 0053](../bugs/fixed/0053-the-stub-rule-matched-prose-about-stubs.md) fixed a real defect: the stub
pattern matched prose _about_ stubs, including this library's own documentation of it. The fix was two
narrowings — anchor markers to a comment-line start, and make them **case-sensitive**.

The anchoring is right and uncontroversial. The **casing** is the part to revisit, and the reason is in bug
0053's own evidence: anchoring alone left two false positives, both of them a _wrapped JSDoc line_ that put
`stub,` or `deferred.` at the start of a continuation line. The response gave up case-insensitivity for
every user, to reject two artifacts of line-wrapping in one unusually marker-dense repository.

What that costs, measured:

| comment                      | pre-0.47 | now      |
| ---------------------------- | -------- | -------- |
| `// todo: implement refunds` | match    | **miss** |
| `// NOT IMPLEMENTED`         | match    | **miss** |
| `// COMING SOON`             | match    | **miss** |

`// todo:` is the default spelling of VS Code's TODO Tree and of ESLint's `no-warning-comments`. And the
all-caps phrase miss is [bug 0061](../bugs/fixed/0061-an-all-caps-stub-marker-no-longer-matches.md) — shipped
against a docstring that claimed the opposite.

Reviewers also reported these, **unverified here and to be measured before acting**, since anchoring and
casing are tangled and it matters which is responsible:

`// Stub: not implemented yet` · `// Placeholder implementation - replace with real logic` ·
`// hack: bypass validation` · `// For now, return an empty array (not implemented)` ·
`/** @todo implement caching */` · a bulleted `* - TODO: wire this up`

## The idea

**A marker is identified by its delimiter, not its casing.** A real marker is followed by `:`, `(`, or the
end of the line:

```
// TODO: x        marker
// todo: x        marker
// FIXME         marker (end of line)
// @todo x        marker
"…the todo list below"                 not a marker — no delimiter
" * stub, which the compiler could…"   not a marker — comma, mid-sentence
" * deferred."                         not a marker — full stop, mid-sentence
```

That rejects both of bug 0053's wrapped-prose survivors _by their punctuation_ while keeping every casing —
which is the trade bug 0053 wanted and reached for casing to get.

**Verify that claim first.** It is the plan's premise and it is one grep over the five prose forms in bug
0053's table plus the corpus below. If the delimiter rule does not reject them, the plan is wrong and should
be closed rather than adjusted.

## Measured input from bug 0061, which changes this plan's scope

[Bug 0061](../bugs/fixed/0061-an-all-caps-stub-marker-no-longer-matches.md) classified every reported row
as anchor, casing or intended. Two results matter here:

**The casing rows this plan is about** are `// Stub:`, `// Placeholder implementation`, `// hack:` and
`// todo:` — all real stub spellings with a delimiter, all rejected only by the casing rule. That is the
plan's premise and it holds.

**But three rows are the ANCHOR's doing, not the casing's**, and this plan did not cover them:

| comment                                               | why it misses                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| ` * - TODO: wire this up`                             | the `-` sits between the `*` and the word, so the anchor does not reach |
| `/** @todo implement caching */`                      | the `@` intervenes the same way                                         |
| `// For now, return an empty array (not implemented)` | the phrase is mid-line                                                  |

**A bulleted `- TODO:` inside a JSDoc list is an extremely common real marker**, and the first two are
false negatives on a build-failing rule with nothing to tell the reader. That widens this plan: the anchor
needs to permit list punctuation and `@` between the comment opener and the word, which is a separate
change from the delimiter rule and should be sabotaged separately.

The third is the honest hard case — a mid-line phrase is exactly what the anchor exists to reject, and
"return an empty array (not implemented)" is exactly what it should catch. Do not fix it by dropping the
anchor; that is bug 0053 reopened. It may have no good answer, in which case say so.

## Phase 1 — a corpus that is not just us

Bug 0053's calibration set was five sites in `src/`, four of which were commentary _about_ markers. That is
not a representative sample of stub comments; it is a representative sample of _this repository's
docstrings_, which are unusual.

Build a fixture corpus with both classes explicitly labelled — real markers in every casing and comment
style (`//`, `/* */`, JSDoc, bulleted JSDoc continuation), and prose mentioning markers in the shapes that
actually occur (this library's own docs, changelog entries, bug reports). Label each row with which class it
belongs to, so the test asserts _classification_ rather than a count.

## Phase 2 — the pattern, and what it must not lose

Rebuild on the delimiter rule, keeping the line-start anchor. Every row of bug 0053's "detected" and
"correctly rejected" tables must hold — that fix was right and this must not regress it.

Then decide the marker/phrase asymmetry deliberately: markers (`TODO`, `FIXME`) have a delimiter; phrases
(`not implemented`, `coming soon`) usually do not, and are the ones the casing rule broke. They may need
different rules, and if so, say why where a reader will find it.

## Phase 3 — migration, which is the expensive half

Widening reds green builds. Worse, per bug 0060, the pattern is interpolated into the rule description and
therefore into the baseline hash — so **every** baselined stub finding moves whether or not its text
changed. Two consequences:

- The upgrade note must say both things: new findings, and baselines to regenerate.
- Prefer landing this **after** bug 0060's diagnostic fix, so a user seeing "0 of N matched" is told the
  pattern changed rather than being sent after their repository root.

## Test inventory

1. **The premise:** every prose form from bug 0053's table is rejected by the delimiter rule alone, with
   casing restored. If this row fails, close the plan.
2. **Every casing of every marker matches** — `TODO`, `todo`, `ToDo` — with a delimiter.
3. **The all-caps phrases match** (bug 0061).
4. **`// todo:` matches** — the ESLint/VS Code default spelling.
5. **Bug 0053's rejected prose stays rejected**, every row. The anti-regression row.
6. **The labelled corpus classifies correctly**, asserted by identity per row rather than by a total, so a
   pattern that matches everything cannot pass.
7. **Baseline migration measured**, before and after, through the real `hashViolation`.
8. **VACUITY: the corpus fixture parses to the comment shapes it claims.** Bug 0053's own guard fixture was
   malformed — an inner `*/` closed a JSDoc early, so the row passed because nothing parsed. Do not repeat
   it.

## Out of scope

- **The anchoring.** It is right; only the casing is under review.
- **Making the message readable.** The violation currently prints the whole 200-character regex twice, which
  is its own small defect and does not need this plan.

## Related

- [Bug 0053](../bugs/fixed/0053-the-stub-rule-matched-prose-about-stubs.md) — the fix this revisits, and the
  source of the anti-regression rows.
- [Bug 0061](../bugs/fixed/0061-an-all-caps-stub-marker-no-longer-matches.md) — the narrow fix; this is the
  redesign.
- [Bug 0060](../bugs/fixed/0060-a-pattern-change-silently-invalidates-every-baselined-finding.md) — why the
  migration is worse than it looks.
- `src/helpers/matchers.ts`, `src/rules/hygiene.ts`.
